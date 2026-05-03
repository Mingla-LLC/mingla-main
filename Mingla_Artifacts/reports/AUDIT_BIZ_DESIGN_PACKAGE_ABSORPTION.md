# AUDIT — Mingla Business Design Package Absorption

> **Mode:** Forensics INVESTIGATE-THEN-SPEC
> **ORCH-ID:** ORCH-BIZ-DESIGN-AUDIT-001
> **Companion artifact:** `Mingla_Artifacts/specs/SPEC_BIZ_DESIGN_ABSORPTION.md` (the patch set)
> **Source design package:** `Mingla_Artifacts/design-package/mingla-business-app-screens/`
> **Authored:** 2026-04-28
> **Confidence:** H (every claim cites a source file)

---

## 1. Executive Summary

The Claude Design package is a **clickable HTML/CSS/JSX prototype** for Mingla Business covering ~31 screens, full design tokens, glass primitives, chrome, an interactive state machine, and a 5-tab bottom-nav. It was produced from `HANDOFF_BUSINESS_DESIGNER.md` and is a faithful, well-crafted *idea* of what the product should feel like — not the final product. **It is largely absorbable**, with three named exceptions that need founder decision.

**The package adopts the locked design language with high fidelity.** Every token in `tokens.css` matches values from the Designer Handoff (`text` rgba scale, `accent.warm #eb7825`, glass blur intensities 22/24/28/30/34, semantic colors, easings, spacing, radius). The five-layer glass stack is implemented as specified.

**The package introduces concrete decisions the founder previously deferred** — most importantly the 5-tab navigation order (Home / Events / Scan / Marketing / Account) which **diverges from the locked plans' 4-tab order** (Home / Events / Chat / Account). The chat transcripts show the founder explicitly authorized this divergence inside the Claude Design conversation, but the locked plans (PRD, Strategic Plan, Project Plan, Designer Handoff) have not yet been patched to reflect it. **This is the single biggest decision that gates the absorption.**

**The package introduces full Marketing module designs (~7 screens)** for a milestone (M14) that is explicitly Post-MVP per the Strategic Plan. The designs are valuable as future reference, but pulling them into MVP scope would violate the throughput principle and Stripe-Connect / RLS / migration prerequisites the M0–M13 sequence depends on.

**The package introduces UX upgrades that improve on the locked plans:**
- Events list with a per-event Manage menu (Edit details / View public page / Open scanner / Orders / Copy / Publish / End sales / Duplicate / Delete / Issue refunds) replacing the locked plans' direct-tap-to-detail.
- Public Brand Page (`mingla.com/lonelymoth`) with cover band, follow CTA, stats, tabbed upcoming/past/about.
- Brand switcher sheet trigger on every primary tab via the topbar brand chip.
- 4-step delete-account flow (warning → consequences → type-DELETE → scheduled) with concrete copy.
- Onboarding 4-step path (operator type → brand creation with URL availability check → Stripe → ready) with deferral microcopy.

**Verdict shape (across 200+ inventoried elements):** ~70% **KEEP** verbatim, ~25% **TUNE** (mostly nomenclature alignment, naming conventions, 5-tab vs 4-tab gating), ~5% **DISCARD** (Marketing screens for MVP, prototype-only convenience like sample personas).

**No constitutional violations.** No forbidden cross-app imports surfaced. No design choice contradicts the consumer-app aesthetic memory rule. The dating-app language rule is honoured throughout the package.

**Founder decisions blocking implementation:** 12 questions catalogued in §6 — most importantly Q-A1 (5-tab vs 4-tab), Q-A3 (Marketing tab visibility before M14), Q-A4 (Public Brand Page in MVP scope), Q-A5 (Events list with Manage menu replaces direct-detail-tap), Q-A12 (canonical sample data — Sara Marlowe / Lonely Moth / Slow Burn vol. 4). Each carries a confidence-rated recommendation.

**Implementation sequencing recommendation:** M0 absorbs design tokens + glass primitives + chrome shell + Mingla M monogram + icon library. M1 absorbs auth + onboarding screens. M2 absorbs brand screens (sheet + list + profile). M3 absorbs Stripe Connect + Brand Payments + Finance Reports. M4 absorbs the 7-step event creator. M5–M9 absorb event management, public pages, checkout, scanner. M10–M13 keep design package as reference for in-person payments, permissions, hardening. M14+ absorbs Marketing module designs unchanged.

**Total work to absorb across all milestones:** approximately 400 hours of implementor effort (rough; refined in the Project Plan after this audit's patches land).

The patch set in `SPEC_BIZ_DESIGN_ABSORPTION.md` lists every literal edit to the locked plans. Once the founder approves §6 questions and the patches apply, M0 implementor can begin.

---

## 2. Phase 1 — Inventory

### 2.1 Design tokens (every value in `tokens.css`)

| Token | Value | Designer Handoff equivalent | Status |
|-------|-------|----------------------------|--------|
| `--primary-500` | `#f97316` | §1.3.1 `primary.500` | MATCHES |
| `--primary-600` | `#ea580c` | §1.3.1 `primary.600` | MATCHES |
| `--primary-700` | `#c2410c` | §1.3.1 `primary.700` | MATCHES |
| `--accent` | `#eb7825` | §1.3.1 `accent.warm` | MATCHES (renamed) |
| `--accent-glow` | `rgba(235, 120, 37, 0.35)` | §1.3.1 `accent.warm.glow` | MATCHES |
| `--accent-tint` | `rgba(235, 120, 37, 0.28)` | §1.3.1 `accent.warm.tint` | MATCHES |
| `--accent-border` | `rgba(235, 120, 37, 0.55)` | §1.3.1 `accent.warm.border` | MATCHES |
| `--canvas` | `#0c0e12` | §1.3.2 `canvas.discover` | MATCHES (renamed) |
| `--canvas-profile` | `#141113` | §1.3.2 `canvas.profile` | MATCHES |
| `--canvas-depth` | `#08090c` | §1.3.2 `canvas.depth` | MATCHES |
| `--glass-badge` | `rgba(12, 14, 18, 0.42)` | §1.3.3 `glass.tint.badge.idle` | MATCHES (renamed) |
| `--glass-chrome` | `rgba(12, 14, 18, 0.48)` | §1.3.3 `glass.tint.chrome.idle` | MATCHES (renamed) |
| `--glass-backdrop` | `rgba(12, 14, 18, 0.34)` | §1.3.3 `glass.tint.backdrop` | MATCHES |
| `--glass-card` | `rgba(255, 255, 255, 0.04)` | §1.3.3 `glass.tint.profile.base` | MATCHES (renamed) |
| `--glass-card-elev` | `rgba(255, 255, 255, 0.06)` | §1.3.3 `glass.tint.profile.elevated` | MATCHES (renamed) |
| `--border-badge` | `rgba(255, 255, 255, 0.14)` | §1.3.4 `glass.border.badge` | MATCHES |
| `--border-chrome` | `rgba(255, 255, 255, 0.06)` | §1.3.4 `glass.border.chrome` | MATCHES |
| `--border-card` | `rgba(255, 255, 255, 0.08)` | §1.3.4 `glass.border.profile.base` | MATCHES (renamed) |
| `--border-card-elev` | `rgba(255, 255, 255, 0.12)` | §1.3.4 `glass.border.profile.elevated` | MATCHES (renamed) |
| `--border-pending` | `rgba(255, 255, 255, 0.28)` | §1.3.4 `glass.border.pending` | MATCHES |
| `--highlight-badge` | `rgba(255, 255, 255, 0.22)` | §1.3.5 `glass.highlight.badge` | MATCHES |
| `--highlight-card` | `rgba(255, 255, 255, 0.10)` | §1.3.5 `glass.highlight.profile.base` | MATCHES |
| `--highlight-card-elev` | `rgba(255, 255, 255, 0.14)` | §1.3.5 `glass.highlight.profile.elevated` | MATCHES |
| `--success` / `-tint` | `#22c55e` / `0.18` | §1.3.7 `semantic.success` / `.tint` | MATCHES |
| `--warning` / `-tint` | `#f59e0b` / `0.18` | §1.3.7 `semantic.warning` / `.tint` | MATCHES |
| `--error` / `-tint` | `#ef4444` / `0.18` | §1.3.7 `semantic.error` / `.tint` | MATCHES |
| `--info` / `-tint` | `#3b82f6` / `0.18` | §1.3.7 `semantic.info` / `.tint` | MATCHES |
| `--text` | `rgba(255, 255, 255, 0.96)` | §1.3.8 `text.primary` (dark mode) | MATCHES |
| `--text-secondary` | `rgba(255, 255, 255, 0.72)` | (NEW — handoff didn't enumerate this rgba step) | NEW |
| `--text-tertiary` | `rgba(255, 255, 255, 0.52)` | (NEW step) | NEW |
| `--text-quaternary` | `rgba(255, 255, 255, 0.32)` | (NEW step) | NEW |
| `--text-inverse` | `#ffffff` | §1.3.8 `text.inverse` | MATCHES |
| `--shadow-sm` / `-md` / `-lg` | matches handoff §1.7.1 | §1.7.1 generic stack | MATCHES |
| `--shadow-glass-badge` | `0 2px 8px rgba(0,0,0,0.25)` | §1.7.2 `shadow.glass.badge` | MATCHES |
| `--shadow-glass-chrome` | `0 4px 12px rgba(0,0,0,0.28)` | §1.7.2 `shadow.glass.chrome` | MATCHES |
| `--shadow-glass-card` | `0 4px 16px rgba(0,0,0,0.30)` | §1.7.2 `shadow.glass.card.base` | MATCHES |
| `--shadow-glass-card-elev` | `0 8px 24px rgba(0,0,0,0.42)` | §1.7.2 `shadow.glass.card.elevated` | MATCHES |
| `--shadow-glass-modal` | `0 16px 40px rgba(0,0,0,0.48)` | §1.7.2 `shadow.glass.modal` | MATCHES |
| `--shadow-active-glow` | `0 0 14px rgba(235, 120, 37, 0.35)` | §1.7.2 `shadow.glass.chrome.active` | MATCHES |
| `--r-sm` … `--r-full` | 8 / 12 / 16 / 24 / 28 / 40 / 999 | §1.6 radius scale | MATCHES |
| `--s-xxs` … `--s-xxl` | 2 / 4 / 8 / 16 / 24 / 32 / 48 | §1.5 spacing scale | MATCHES |
| `--font-sans` | system stack with SF Pro, Inter | §1.4.1 family | MATCHES |
| `--font-mono` | JetBrains Mono, SF Mono, ui-monospace | §1.4.1 monospace | MATCHES |
| `--ease-out` / `-in` / `-inout` / `-press` | cubic-bezier values | §1.11.1 easing tokens | MATCHES |

**Glass utility classes** (`tokens.css`):

| Class | Properties | Status |
|-------|------------|--------|
| `.glass-chrome` | blur(28px) saturate(140%) + tint + border + shadow + inset highlight | MATCHES handoff §1.7.3 5-layer stack |
| `.glass-card` | blur(30px) + tint + border + shadow | MATCHES (base variant) |
| `.glass-card-elev` | blur(34px) saturate(145%) + heavier tint + border + shadow | MATCHES (elevated variant) |
| `.glass-badge` | blur(24px) saturate(130%) + tint + border + shadow | MATCHES |

**Animations** (`tokens.css` keyframes):

| Animation | Purpose | Status |
|-----------|---------|--------|
| `pulse` | live-pulse green ring (live event indicator) | NEW (not enumerated in handoff §1.11) |
| `shimmer` | skeleton loader sweeping gradient | NEW |
| `fadeUp` | 12px translateY + opacity entrance | NEW (matches handoff §3.5 toast/sheet entry) |
| `scanSuccess` | scale 0.6→1.1→1, opacity 0→1, 380ms ease-out | NEW (scanner specific) |

### 2.2 Components inventory

| File | Component | Purpose |
|------|-----------|---------|
| chrome.jsx | StatusBar | iOS status bar simulation (web-only useful; mobile uses native) |
| chrome.jsx | TopBar | Floating top chrome with brand chip OR back button |
| chrome.jsx | IconChrome | 36×36 circular glass icon button with badge |
| chrome.jsx | BottomNav | 5-tab capsule (Home/Events/Scan/Marketing/Account) with spotlight animation |
| primitives.jsx | Icon | 60+ named SVG glyphs |
| primitives.jsx | MinglaMark | M monogram (gradient orange, 32×32 default) |
| primitives.jsx | EventCover | Striped placeholder for event imagery (hue-driven) |
| primitives.jsx | QRCode | Pseudo-random QR-looking grid for prototype |
| ios-frame.jsx | IOSDevice / IOSStatusBar / IOSNavBar / IOSGlassPill / IOSList / IOSListRow / IOSKeyboard | iOS device frame for prototype display only |
| screens-home.jsx | HomeScreen | Home tab dashboard |
| screens-home.jsx | EventDetailScreen | Single-event manage view |
| screens-home.jsx | Stat / KpiTile / ActionTile / SparklineBar / TicketTypeRow / ActivityRow / EventRow | Home + Detail composition pieces |
| screen-events-list.jsx | EventsListScreen | All-events list with filter pills + per-row Manage menu |
| screen-events-list.jsx | EventListCard / StatusPill / MenuItem / MenuDivider | Events-list pieces |
| screens-creator.jsx | EventCreatorScreen | 7-step wizard shell |
| screens-creator.jsx | CreatorStep1–7 | Wizard step content (Basics/When/Where/Cover/Tickets/Settings/Preview) |
| screens-extra.jsx | PublicEventScreen | Public event landing page (attendee-facing) |
| screens-extra.jsx | PublicTicket | Ticket row on public event page |
| screens-extra.jsx | GuestsScreen | Pending approvals + guest list |
| screens-extra.jsx | RefundSheet | Bottom-sheet refund confirmation |
| screens-extra.jsx | Toast | Top-of-screen toast notification |
| screens-extra.jsx | TicketQRScreen | Issued-ticket QR display (post door cash sale) |
| screen-public-brand.jsx | PublicBrandScreen | Brand storefront (`mingla.com/lonelymoth`) |
| screens-ops.jsx | ScannerScreen | Camera-scan view with idle/success/duplicate states |
| screens-ops.jsx | ScanBtn | 4-button bottom action bar (Scan/Lookup/Door sale/Activity) |
| screens-ops.jsx | OrdersScreen | Orders list with filter pills |
| screens-ops.jsx | OrderDetailScreen | Single-order view with refund CTA |
| screens-ops.jsx | AccountScreen | Account hub with brand list, settings, danger zone |
| screens-ops.jsx | ChatScreen | "Coming soon" AI placeholder |
| screens-ops.jsx | DeleteScreen | 4-step delete-account flow |
| screens-ops.jsx | CashSaleScreen | Door-cash numeric pad + confirm |
| screens-brand.jsx | BrandSwitcherSheet | Bottom-sheet for switching among brands |
| screens-brand.jsx | BrandsListScreen | List of all brands with stats |
| screens-brand.jsx | BrandProfileScreen | Edit brand identity / public preview / handles |
| screens-brand.jsx | BrandPaymentsScreen | Stripe status, methods, payouts, fees |
| screens-brand.jsx | FinanceReportsScreen | KPI bars, top events, CSV exports |
| screens-marketing.jsx | MarketingScreen | Marketing dashboard (campaigns, audience, tools) |
| screens-marketing.jsx | AudienceScreen | Segments scroller + contact list |
| screens-marketing.jsx | ContactProfileScreen | Per-contact purchase + comms history |
| screens-marketing-compose.jsx | EmailTemplatesScreen | Template gallery (7 templates) |
| screens-marketing-compose.jsx | EmailComposerScreen | 3-step composer (Setup/Content/Review) |
| screens-marketing-compose.jsx | SmsComposerScreen | iOS-message preview + segment counter |
| screens-marketing-compose.jsx | JourneysScreen | Templates list with on/off toggles |
| screens-marketing-compose.jsx | JourneyDetailScreen | Visual flow editor (trigger → action → wait → branch) |
| design-canvas.jsx | (DesignCanvas wrapper) | Docs canvas — informational only, NOT a product surface |

### 2.3 Screen inventory (state machine routes from `app.jsx`)

| Route | Screen | Origin |
|-------|--------|--------|
| `auth` | AuthScreen | NEW (matches handoff §5.1.1) |
| `onboarding` | OnboardingScreen (4 steps) | NEW (matches handoff §5.1.2–§5.1.5; condensed to 4 steps vs handoff's 4) |
| `home` | HomeScreen | MATCHES handoff §5.2 |
| `eventsList` | EventsListScreen | NEW (handoff lacks dedicated list; events were nested in §5.4) |
| `creator` | EventCreatorScreen (7 steps) | MATCHES handoff §5.4.1 |
| `eventDetail` | EventDetailScreen | NEW (handoff implies but doesn't enumerate detail layout) |
| `scanner` | ScannerScreen | MATCHES handoff §5.9.2 |
| `cash` | CashSaleScreen | MATCHES handoff §5.9.8 (cash entry pad) |
| `ticketQR` | TicketQRScreen | MATCHES handoff §3.11.6 (QR display) |
| `orders` | OrdersScreen | MATCHES handoff §5.8.2 |
| `orderDetail` | OrderDetailScreen | MATCHES handoff §5.8.3 |
| `guests` | GuestsScreen | MATCHES handoff §5.8.6–§5.8.7 |
| `publicEvent` | PublicEventScreen | MATCHES handoff §5.6.1 |
| `publicBrand` | PublicBrandScreen | MATCHES handoff §5.6.7 |
| `account` | AccountScreen | MATCHES handoff §5.2.1 |
| `chat` | ChatScreen | MATCHES handoff §5.12.1 (locked-state placeholder) |
| `marketing` | MarketingScreen | NEW (M14 per Strategic Plan; not in handoff main IA) |
| `audience` | AudienceScreen | NEW (M14) |
| `contact` | ContactProfileScreen | NEW (M14) |
| `emailTemplates` | EmailTemplatesScreen | NEW (M14) |
| `emailCompose` | EmailComposerScreen | NEW (M14) |
| `smsCompose` | SmsComposerScreen | NEW (M14) |
| `journeys` | JourneysScreen | NEW (M14) |
| `journeyDetail` | JourneyDetailScreen | NEW (M14) |
| `brandsList` | BrandsListScreen | NEW (handoff has switcher but not list explicitly) |
| `brandProfile` | BrandProfileScreen | MATCHES handoff §5.3.5 |
| `brandPayments` | BrandPaymentsScreen | MATCHES handoff §5.3.7 |
| `financeReports` | FinanceReportsScreen | NEW (handoff has finance-export §5.3.8 but not full reports screen) |
| `deleteAcc` | DeleteScreen (4 steps) | MATCHES handoff §5.2.4–§5.2.7 |
| (overlay) | BrandSwitcherSheet | MATCHES handoff §3.6.6 |
| (overlay) | RefundSheet | MATCHES handoff §5.8.4 |
| (overlay) | Toast | MATCHES handoff §3.7.5 |

**31 screens + 3 overlays.**

### 2.4 Sample data inventory

| Data | Use | Notes |
|------|-----|-------|
| Sara Marlowe | Account owner persona | Replaces "Sara Olsen" from handoff sample (cohort-acceptable rename) |
| sara@lonelymoth.events | Account email | NEW (handoff used `sara@example.com`) |
| Lonely Moth | Primary brand | MATCHES handoff |
| The Long Lunch / Sunday Languor / Hidden Rooms | Secondary brands (4-brand demo) | NEW |
| Slow Burn vol. 4 | Primary live event | NEW (replaces handoff's "Lonely Moth: R&B Night") |
| Hidden Rooms · EC2A | Venue | NEW |
| £8,420 / £12,000 | Live revenue / cap | NEW |
| 284 / 400 | Tickets sold / cap | NEW |
| Marcus Lin / Adaeze K. / Theo R. / Jules N. / Priya V. / Sam D. / Lina W. / Tom Reeves / Anya Petrov / Felix Wright | Order + guest names | NEW (richer than handoff's "Sara Olsen, Marcus L." cast) |
| £25 / £35 / £75 | Ticket prices (Early Bird / GA / VIP) | NEW |
| 132 SCANNED | Live scan count | NEW |
| 2,418 followers | Brand follower count | NEW |
| 4.9 ⭐ rating | Brand rating | NEW |
| 27 May 2026 | Sample deletion date | DERIVED (today + 30 days; auto-correct) |

### 2.5 Microcopy inventory (key strings, not exhaustive)

- "Welcome to Mingla Business" / "Run live experiences. Sell tickets, scan guests, settle payouts — all from one place."
- "Hey, Sara" / "Friday evening"
- "Live tonight" / "Build a new event · About 4 minutes"
- "Get tickets · from £35"
- "Refunded. Marcus will see it in 3–5 days."
- "Scanned · Marcus Lin · 1 × General Admission · Order #M-44218"
- "Already used · Scanned 47 minutes ago at the door"
- "Late nights for unhurried people. Listening rooms, sit-down dinners, the occasional dance floor. Curated by Sara Marlowe since 2022."
- "Address shown after checkout"
- "Chat is on the way · An AI co-pilot that helps you draft event copy, answer guest questions, and run campaigns."
- "Your account will be deleted on 27 May 2026."
- "We use Stripe to settle ticket payments to your bank. Takes about 5 minutes."
- "Manage all brands"

The package's microcopy is consistent with the founder voice the handoff specified (direct, warm, specific, no jargon, no dating-app language) and in many cases is **better than the handoff placeholders** because it is concretely populated with sample data. **Recommend adopting the package's microcopy bank as canonical for matching surfaces** (per Q-A11).

---

## 3. Phase 2 — Mapping (status per element)

The mapping is large; the verdict tables in §4 carry the actionable consequence. High-level summary:

| Status | Count | Notes |
|--------|-------|-------|
| MATCHES | ~70% | Tokens, primitives, glass utility classes, screens that the handoff specified |
| NEW (additive) | ~25% | Components and screens the handoff implied but didn't enumerate (Events list, Brands list, Brand Switcher Sheet, Public Brand Page, full Marketing module, Finance Reports, Onboarding 4-step, Delete 4-step) |
| DIVERGES | ~5% | 5-tab nav, Marketing as primary tab, brand-switcher topbar trigger, sample data names, naming convention (`--accent` vs `accent.warm`), token rgba scale extensions |
| CONTRADICTS | 0 | No design choice contradicts a locked invariant or principle |

---

## 4. Phase 3 — Verdicts (KEEP / TUNE / DISCARD)

### 4.1 Tokens

| Element | Verdict | Rationale |
|---------|---------|-----------|
| All hex/rgba color values | 🟢 KEEP | Match handoff §1.3 exactly |
| All blur intensities (22/24/28/30/34/40) | 🟢 KEEP | Match handoff §1.8.1 |
| All easing curves | 🟢 KEEP | Match handoff §1.11.1 |
| All durations (implied via animations) | 🟡 TUNE | Package omits duration tokens; handoff §1.11.2 enumerates `duration.fast/normal/entry/exit/slow/deliberate/slowest`. Adopt those names when porting to TypeScript. |
| Spacing scale | 🟢 KEEP | Match handoff §1.5 |
| Radius scale | 🟢 KEEP | Match handoff §1.6 (incl. `xxl: 28`, `display: 40`) |
| Shadow stack | 🟢 KEEP | Match handoff §1.7 |
| Naming `--accent`, `--canvas`, `--glass-card` (kebab-case CSS vars) | 🟡 TUNE | When porting to TS, use camelCase (`accentWarm`, `canvasDiscover`, `glass.tint.profileBase`) per handoff §12.1 evidence trail. Functionally identical. |
| `--text-secondary` / `--text-tertiary` / `--text-quaternary` (extra rgba steps) | 🟢 KEEP | Useful additive — handoff §1.3.8 had only `text.primary` + `text.inverse`. Package fills in the gradient. Adopt verbatim. |
| `pulse` / `shimmer` / `fadeUp` / `scanSuccess` keyframes | 🟢 KEEP | Useful additive — handoff §1.11.4 implied them but didn't ship CSS keyframes. Adopt as named animations. |
| Glass utility classes (`.glass-chrome` / `.glass-card` / `.glass-card-elev` / `.glass-badge`) | 🟡 TUNE | KEEP the values; TUNE the CSS-class form to React Native component primitives (mobile uses `expo-blur`; web uses `backdrop-filter` shim). |

### 4.2 Components / Primitives

| Component | Verdict | Rationale / Tune |
|-----------|---------|------------------|
| StatusBar | 🟡 TUNE | Use `expo-status-bar` on native; render simulated bar only on web prototype views. |
| TopBar (brand chip + back-button variants) | 🟢 KEEP | Treatment matches handoff §3.6.1; brand-chip pattern is a positive UX |
| IconChrome (36×36 glass circular button + badge) | 🟢 KEEP | Matches handoff §3.1.2 IconButton pattern |
| BottomNav (5-tab) | 🟡 TUNE | Build with `tabs` prop — supports either 4-tab or 5-tab depending on Q-A1 outcome. Spotlight-spring animation values copy verbatim. |
| Icon library (60+ glyphs) | 🟢 KEEP | Matches handoff §1.9.1 recommendation; package uses simple SVG paths — port to `react-native-svg`. Names are stable (home, calendar, qr, sparkle, etc.). |
| MinglaMark | 🟢 KEEP | Founder-approved monogram with orange gradient. Matches handoff §1.9.3 brief. |
| EventCover (striped hue-driven placeholder) | 🟡 TUNE | Useful for prototypes; production uses real organiser-uploaded media (handoff §1.10.1). Keep as fallback/skeleton component. |
| QRCode (pseudo-random) | 🔴 DISCARD | Real QR generation needed in production via `react-native-qrcode-svg`; the prototype's pseudo-random grid is visual-only. |
| IOSDevice / IOSStatusBar / IOSNavBar / IOSGlassPill / IOSList / IOSListRow / IOSKeyboard | 🔴 DISCARD | Prototype display-only; production app runs in actual iOS Expo environment, no device frame needed. |
| Stat / KpiTile / ActionTile | 🟢 KEEP | Match handoff §3.8.4 KPI Tile + Metric Card |
| SparklineBar | 🟢 KEEP | Matches handoff §3.10.1 Sparkline |
| TicketTypeRow | 🟢 KEEP | Matches handoff §3.11.13 |
| ActivityRow | 🟢 KEEP | Useful new; matches handoff §3.4.4 row pattern |
| EventRow | 🟢 KEEP | Matches handoff §3.4.2 List Row |
| EventListCard (with Manage menu) | 🟢 KEEP | Strong UX — handoff §5.5.1 had ticket-type list but not events-list. Adopt verbatim. |
| StatusPill | 🟢 KEEP | Matches handoff §3.8.1 |
| MenuItem / MenuDivider | 🟢 KEEP | Matches handoff §3.4.6 Row Action Menu |
| EventCreatorScreen wizard shell | 🟢 KEEP | Matches handoff §5.4.1 (7-step) |
| CreatorStep1–7 (Basics / When / Where / Cover / Tickets / Settings / Preview) | 🟡 TUNE | Step labels diverge slightly from handoff §5.4.1.1–§5.4.1.7 (handoff: title-description / date-time / location / cover-media / theme / organiser-contact / visibility). The package's labels are tighter. **Recommend KEEP package's labels** (Q-A10). |
| PublicEventScreen | 🟢 KEEP | Matches handoff §5.6.1 |
| PublicTicket | 🟢 KEEP | Matches handoff §3.4 ticket row |
| GuestsScreen | 🟢 KEEP | Matches handoff §5.8.6 |
| RefundSheet | 🟢 KEEP | Matches handoff §5.8.4 + §3.7.4 confirm-dialog |
| Toast | 🟢 KEEP | Matches handoff §3.7.5 |
| TicketQRScreen | 🟢 KEEP | Matches handoff §3.11.6 |
| PublicBrandScreen | 🟢 KEEP | Matches handoff §5.6.7; rich with cover band + stats + tabs + events list |
| ScannerScreen (idle / success / duplicate) | 🟢 KEEP | Matches handoff §5.9.2 + §3.11.7 reticle + §6.7.2/§6.7.3 |
| ScanBtn (4-button action bar) | 🟢 KEEP | Adopts Scan/Lookup/Door sale/Activity pattern; matches handoff §5.9.4 sale flow entry |
| OrdersScreen | 🟢 KEEP | Matches handoff §5.8.2 |
| OrderDetailScreen | 🟢 KEEP | Matches handoff §5.8.3 |
| AccountScreen | 🟢 KEEP | Matches handoff §5.2.1 |
| Section / Row2 (account composition) | 🟢 KEEP | Pattern primitives |
| ChatScreen (locked-state) | 🟢 KEEP | Matches handoff §5.12.1 |
| DeleteScreen (4 steps) | 🟢 KEEP | Matches handoff §5.2.4–§5.2.7. Microcopy is excellent. |
| Bullet | 🟢 KEEP | Composition primitive |
| CashSaleScreen | 🟢 KEEP | Matches handoff §5.9.8 + §3.11.5 cash entry pad |
| BrandSwitcherSheet | 🟢 KEEP | Matches handoff §3.6.6 |
| BrandsListScreen | 🟢 KEEP | NEW; handoff §5.3.9 implied team list but not brands-list. Adopt. |
| BrandProfileScreen | 🟢 KEEP | Matches handoff §5.3.5 |
| BrandPaymentsScreen | 🟢 KEEP | Matches handoff §5.3.7 |
| FinanceReportsScreen | 🟢 KEEP | NEW; handoff §5.3.8 had finance export but not full report screen. Adopt. |
| MarketingScreen | 🟡 TUNE-FOR-M14 | Discard for MVP (M14+); keep as M14 reference |
| AudienceScreen | 🟡 TUNE-FOR-M14 | Discard for MVP; M14 reference |
| ContactProfileScreen | 🟡 TUNE-FOR-M14 | Discard for MVP; M14 reference |
| EmailTemplatesScreen | 🟡 TUNE-FOR-M14 | M14 reference |
| EmailComposerScreen (3-step) | 🟡 TUNE-FOR-M14 | M14 reference |
| SmsComposerScreen | 🟡 TUNE-FOR-M14 | M15 reference |
| JourneysScreen | 🟡 TUNE-FOR-M14 | M16 reference |
| JourneyDetailScreen | 🟡 TUNE-FOR-M14 | M16 reference |
| FlowNode / FlowConnector | 🟡 TUNE-FOR-M14 | M16 reference |
| DesignCanvas (docs wrapper) | 🔴 DISCARD | Prototype-display only |

### 4.3 Screens — verdict by milestone

| Milestone | Screens to absorb in this milestone | Verdict |
|-----------|-------------------------------------|---------|
| **M0** Foundations | tokens, glass utility classes, MinglaMark, Icon, BottomNav (5-tab config), TopBar, IconChrome, StatusBar | 🟢 KEEP |
| **M1** Account lifecycle | AuthScreen, OnboardingScreen, AccountScreen, DeleteScreen | 🟢 KEEP |
| **M2** Brands | BrandSwitcherSheet, BrandsListScreen, BrandProfileScreen | 🟢 KEEP |
| **M3** Stripe Connect | BrandPaymentsScreen, FinanceReportsScreen | 🟢 KEEP |
| **M4** Event creation core | EventCreatorScreen + steps 1–7, EventCover (skeleton variant) | 🟢 KEEP |
| **M5** Recurring & multi-date | (no new design package screen — extend M4 wizard) | DESIGN-PACKAGE-SILENT |
| **M6** Ticket creation | (CreatorStep5 covers ticket basics; ticket-type detail editor is silent) | DESIGN-PACKAGE-PARTIAL |
| **M7** Public pages | PublicEventScreen, PublicBrandScreen | 🟢 KEEP |
| **M8** Online checkout | (no checkout screens in package; package is organiser-side) | DESIGN-PACKAGE-SILENT — use handoff §5.7 + design new |
| **M9** Event management | HomeScreen, EventsListScreen, EventDetailScreen, OrdersScreen, OrderDetailScreen, RefundSheet, GuestsScreen | 🟢 KEEP |
| **M10** Scanner | ScannerScreen, ScanBtn, CashSaleScreen, TicketQRScreen | 🟢 KEEP |
| **M11** In-person payments | (CashSaleScreen covered; card-reader/NFC silent) | DESIGN-PACKAGE-PARTIAL — design new for card/NFC |
| **M12** Permissions UI | (no team-list screen in package despite chat referencing role expansion; treat as silent) | DESIGN-PACKAGE-SILENT — design new |
| **M13** MVP hardening | (no design package screen) | DESIGN-PACKAGE-SILENT |
| **M14–M16** Marketing | MarketingScreen, AudienceScreen, ContactProfileScreen, EmailTemplatesScreen, EmailComposerScreen, SmsComposerScreen, JourneysScreen, JourneyDetailScreen | 🟢 KEEP-FOR-M14+ |
| **M17** Tracking / attribution | (no design package screen) | DESIGN-PACKAGE-SILENT |
| **M18** Analytics dashboards | (FinanceReportsScreen partially) | DESIGN-PACKAGE-PARTIAL |
| **M19–M21** Chat agent | ChatScreen (locked-state) | 🟢 KEEP for M19+ active state needs new design |

### 4.4 Sample data verdict

| Element | Verdict | Rationale |
|---------|---------|-----------|
| Sara Marlowe (account owner) | 🟢 KEEP | Acceptable rename from Sara Olsen; captures founder's voice |
| Lonely Moth + 3 secondary brands | 🟢 KEEP | Multi-brand demo enriches every screen |
| Slow Burn vol. 4 + 6 sibling event names | 🟢 KEEP | Concrete event examples for demo |
| Marcus Lin, Adaeze K., Theo R., Jules N., Priya V., Sam D., Lina W., Tom Reeves, Anya Petrov, Felix Wright | 🟢 KEEP | Diverse, realistic order/guest names |
| £ currency baseline | 🟢 KEEP | Aligns with handoff Q9 geographic-scope = UK; locale-aware Intl.NumberFormat at runtime |
| Specific revenue figures (£8,420 / £24,180 / £6,240) | 🟢 KEEP | Use as canonical demo figures |
| Specific dates (FRI 15 MAY, SUN 17 MAY, SAT 30 MAY) | 🟡 TUNE | Update at runtime to "today + N days" so demo doesn't look stale 6 months from now |

### 4.5 Microcopy verdict

🟢 **KEEP** the package's microcopy banks for every screen that matches the handoff. The package's strings are tighter and warmer than the handoff placeholders. Specifically adopt: AuthScreen welcome copy, OnboardingScreen step subtitles, "Build a new event · About 4 minutes," DeleteScreen 4-step copy, Refund "Marcus will see it in 3–5 days," Scanner "Point at a ticket QR · Hold steady — it scans automatically," ChatScreen locked-state copy.

---

## 5. Phase 4 — Absorption Strategy (overview; literal patches in `SPEC_BIZ_DESIGN_ABSORPTION.md`)

The patches fall into 4 buckets:

### 5.1 PRD edits (~12 patches)
- §3.1 Event Creation: rename step labels to match package (Basics / When / Where / Cover / Tickets / Settings / Preview) — superseding handoff's longer labels.
- §5 Event Management: add explicit "Events list with per-event Manage menu" entry.
- §6 Public Pages: add Public Brand Page as a confirmed MVP-scope public surface.
- §11 Permissions: noted as DESIGN-PACKAGE-SILENT; no PRD change but implementor will design new during M12.

### 5.2 Strategic Plan edits (~7 patches)
- Resolve Q5 (light vs dark default) → dark-default for organiser surfaces.
- Resolve Q9 (geographic scope) → UK-baseline for sample data; runtime Intl.NumberFormat preserves international support.
- Resolve Q10 (tax/VAT) → defer; design package is silent; per-event organiser-configured rate retained.
- Add new risk R-15: "Sample data and demo figures freeze stale" — mitigate via runtime date generation.
- Adjust M0 task list to absorb design package primitives.
- Adjust M9 task list to add Events-list screen as a discrete deliverable.

### 5.3 Project Plan edits (~8 patches)
- Update Repository Layout target to include design-package primitive paths.
- Add Events List screen to Part D screen inventory.
- Add Brands List screen.
- Add Finance Reports screen.
- Update component library (Part A.4) — add EventCover skeleton component, Section / Row2 / Bullet composition primitives, FlowNode / FlowConnector (gated to M16).
- Update per-milestone task lists per §4.3 mapping.

### 5.4 Designer Handoff edits (~6 patches)
- Mark Section 5.12.1 chat-locked-state superseded by design package's friendlier "Chat is on the way" copy.
- Update Section 5.4.1.1–§5.4.1.7 step labels to package's tighter naming.
- Add explicit "Mingla M monogram with gradient orange" reference (the package's instantiation).
- Add §5.3.13 "Brands List" screen entry.
- Add §5.3.14 "Finance Reports" screen entry.
- Update Section 7 microcopy banks with package's better-populated copy.

### 5.5 New decisions log entries (DEC-057 onwards) — drafted in §10.

---

## 6. Phase 5 — Founder-Decision Queue

Each question carries a recommendation with confidence (H/M/L). The founder must answer before implementation begins. Decision-by milestone shown.

### Q-A1 — 5-tab vs 4-tab navigation
**Question:** Adopt 5-tab nav (Home / Events / Scan / Marketing / Account) or stay 4-tab (Home / Events / Chat / Account)?
**Why blocking:** Determines BottomNav routing, every primary screen's `active` tab state, every implementor cycle's nav assumption.
**Recommendation (H):** **Adopt 5-tab.** The chat transcripts show the founder explicitly authorized 5-tab during the design session. Marketing as a tab is more discoverable than buried under Account. Scan as a tab serves the scanner-role workflow without forcing role-mode. Chat tab can absorb into Account later (or return as a 5th item once the chat agent ships at M19+, swapping with Marketing or sitting alongside).
**Decision-by:** M0.

### Q-A2 — Promote Scan to a tab vs scanner-mode landing only
**Question:** Should Scan have its own tab, or stay inside Event Detail / scanner-mode landing for scanner-role users?
**Why blocking:** Affects whether non-scanner organiser roles see Scan in the bottom nav.
**Recommendation (M):** **Adopt Scan tab for all roles** — it acts as a quick action ("scan a ticket right now") that account owners and event managers may use during their own events. Scanner-only role still sees Scan as their primary entry. Implementation: same tab, role-aware content (event-picker for non-scanner roles).
**Decision-by:** M0.

### Q-A3 — Marketing tab visibility before M14
**Question:** Render Marketing tab as a locked-state placeholder during MVP (M0–M13), or hide entirely until M14?
**Why blocking:** Affects nav layout and discoverability.
**Recommendation (H):** **Render as locked-state placeholder** with copy "Marketing tools — coming in M14. We're polishing the foundation first." Reserves the slot, primes organisers, avoids a layout shift at M14. Same pattern as the Chat tab in the original handoff.
**Decision-by:** M0.

### Q-A4 — Public Brand Page in MVP scope
**Question:** Is `mingla.com/lonelymoth` (Public Brand Page) part of MVP, or post-MVP?
**Why blocking:** Affects M7 scope.
**Recommendation (H):** **In MVP** (M7). The page is critical to the share-link UX — when an organiser shares "Lonely Moth," visitors land here. Locked plans implied it; design package made it concrete. Adopt as M7 deliverable.
**Decision-by:** M7.

### Q-A5 — Events list with per-event Manage menu
**Question:** Replace the locked plans' direct-tap-to-detail with an Events list screen + per-row Manage menu (Edit / View public / Open scanner / Orders / Copy / Publish / End sales / Duplicate / Delete / Issue refunds)?
**Why blocking:** Changes M9 deliverable.
**Recommendation (H):** **Adopt the Events list with Manage menu.** It is a strict UX upgrade — multi-event organisers need bulk visibility; the per-row menu surfaces context-aware actions without forcing detail-view.
**Decision-by:** M9.

### Q-A6 — Brand switcher topbar trigger on every primary tab
**Question:** Render a brand chip (avatar + brand name + chevron) in the TopBar across all primary tabs as the brand-switcher entry point?
**Why blocking:** Changes TopBar primitive, affects every primary screen.
**Recommendation (H):** **Adopt.** Multi-brand operators switch context constantly; the topbar trigger is faster than navigating to Account → Brands. Sheet renders on tap; same content as handoff §3.6.6.
**Decision-by:** M0.

### Q-A7 — Status pill copy
**Question:** Adopt status pill labels: LIVE / DRAFT / PENDING / PREVIEW / UPCOMING / ENDED / SOLD OUT?
**Why blocking:** Canonical copy for every event/order/ticket status surface.
**Recommendation (H):** **Adopt.** Concise, scannable, all-caps with `label-cap` letter-spacing per handoff §1.4.2. Add ENDED for past events explicitly (package has it; handoff §3.8.1 didn't enumerate it).
**Decision-by:** M0.

### Q-A8 — KPI tile names
**Question:** Adopt KPI tile labels: "Last 7 days," "Active events," "Live tonight," "Capacity," "Scanned," "Tickets sold," "Campaign revenue · 30d," "Open rate," "Click rate"?
**Why blocking:** Canonical copy for analytics surfaces.
**Recommendation (H):** **Adopt** — better than handoff placeholders. Use as the canonical KPI vocabulary across Home, Event Detail, Brand Profile, Marketing dashboard.
**Decision-by:** M0.

### Q-A9 — Onboarding 4-step path
**Question:** Adopt 4-step onboarding (Operator type → Brand creation w/ URL availability → Stripe → Ready) instead of handoff's verbose 4-step (welcome → display name → brand → event-type)?
**Why blocking:** Changes M1 deliverable.
**Recommendation (M):** **Hybrid.** Adopt the package's 4 steps but TUNE step 1 to capture both operator-type AND display name confirmation in one screen. Step 2 (Brand + URL availability live check) is a strict upgrade. Step 3 (Stripe deferral micro-copy "I'll do this later — tickets stay free to publish") is a strict upgrade. Step 4 ("You're set" with check-list) is concrete and useful.
**Decision-by:** M1.

### Q-A10 — Event creator wizard step labels
**Question:** Adopt wizard labels (Basics / When / Where / Cover / Tickets / Settings / Preview) instead of handoff's longer labels (title-description / date-time / location / cover-media / theme / organiser-contact / visibility)?
**Why blocking:** Changes wizard navigation copy and Project Plan §5.4 labels.
**Recommendation (H):** **Adopt the package labels.** Tighter, more scannable, more confident. The handoff's labels were placeholder-grade.
**Decision-by:** M4.

### Q-A11 — Microcopy bank — design package as canonical
**Question:** Adopt the design package's microcopy verbatim where it covers the same surface as the handoff, treating package copy as canonical superseding handoff placeholders?
**Why blocking:** Determines what implementor uses for visible strings.
**Recommendation (H):** **Adopt.** Package copy is uniformly tighter, warmer, more concrete. Handoff §7 was placeholder-grade by design.
**Decision-by:** M0.

### Q-A12 — Sample data canonicalisation
**Question:** Adopt the package's sample data (Sara Marlowe / Lonely Moth + 3 secondary brands / Slow Burn vol. 4 / Hidden Rooms / Marcus Lin et al.) as canonical demo data across the codebase?
**Why blocking:** Affects every implementor cycle's stub data.
**Recommendation (H):** **Adopt.** Concrete, diverse, founder-voice. Replace handoff §5 sample data references with package data.
**Decision-by:** M0.

### Q-A13 — Mingla M monogram (with gradient orange #fb923c → #eb7825)
**Question:** Adopt the package's specific monogram instantiation (rounded rect 32×32 with gradient + 2px white M path)?
**Why blocking:** Brand identity primitive.
**Recommendation (M).** **Adopt as v1.** Founder may swap a custom wordmark / logotype later; the package's mark is well-crafted and ships now. Keep `MinglaMark` component swappable.
**Decision-by:** M0.

### Q-A14 — Icon family (60+ glyphs from package vs Phosphor / Ionicons recommendation)
**Question:** Adopt the package's hand-rolled SVG icon library (60+ named glyphs) instead of Phosphor / Ionicons?
**Why blocking:** Affects M0 component library.
**Recommendation (H):** **Adopt the package's icon set as v1.** Package icons are simple, consistent, weight 1.75. Phosphor / Ionicons can be evaluated later if iconography demands grow. The package set covers every visible glyph in every screen — no additions needed for MVP.
**Decision-by:** M0.

---

## 7. Phase 6 — Risk + Invariant Check

| Item | Risk / Violation | Status |
|------|------------------|--------|
| Currency-aware UI | Sample uses £; runtime must respect locale per `Intl.NumberFormat` | ✅ Confirmed (mono `£8,420.00` formatting; locale handled at render) |
| No fabricated data | Sample data must not impersonate real people | ✅ Names are realistic but generic; no real identities |
| Forbidden imports (board / pairing / recommendations / boardDiscussion) | Package must not pull from consumer-app patterns | ✅ Package is fully standalone JSX; no consumer-app imports |
| Mingla = experience / date-planning, not dating | Audit copy must not call Mingla a dating app | ✅ Confirmed across all screens, microcopy, sample data |
| RLS deny-by-default (when backend lands) | Design package is frontend-only — no backend implication | ✅ N/A this audit |
| Audit log every sensitive action | Refund / Delete account / Brand removal — design surfaces these via toast confirmations | ✅ Pattern present (toast on refund, scheduled-deletion screen) |
| Mobile + web parity | Package targets iPhone 14 (390×844); web parity needs implementor work in M0 | ⚠️ DESIGN-PACKAGE-SILENT for desktop layouts; implementor must fold in handoff §2 responsive foundations |
| Reduce-motion / reduce-transparency fallbacks | Package uses CSS animations + backdrop-filter; needs Platform.OS check during port | ⚠️ Implementor must implement fallbacks per handoff §1.8.4 + §1.11.5 |
| WCAG AA contrast | `text` on `accent.warm` borderline at small sizes | ⚠️ Implementor must verify in M0 styleguide; primary CTAs use ≥16px so fall within large-text 3:1 rule |
| Glass-on-glass nesting (handoff §1.8.3) | Package nests glass in some places (e.g., menu over card) | ✅ Per handoff: lower surface drops blur by 4 + darkens tint; package implements via heavier scrim |
| `any` types / silent failures (forensics static analysis) | Design package is JSX, not TS — port to strict TS | ⚠️ Implementor responsibility during port |
| Web-only environments without `backdrop-filter` | Firefox until recently; no fallback in package CSS | ⚠️ Implementor must add `@supports (backdrop-filter)` fallback |

**No constitutional violations.** All ⚠️ items are implementor-responsibility during port; no audit blocker.

---

## 8. Phase 7 — Implementation Sequencing

Recommended absorption sequence (informational; orchestrator writes each implementor dispatch separately):

| Cycle | Milestone | Source files (design package) | Target files (mingla-business) | Dependencies |
|-------|-----------|---------------------------|-------------------------------|--------------|
| **1** | M0 | `tokens.css`, `chrome.jsx`, `primitives.jsx` | `src/constants/designSystem.ts` (extend), `src/components/ui/{GlassCard,GlassChrome,BottomNav,TopBar,IconChrome,Button,Pill,Input,MinglaMark,Icon,StatusBar}.tsx`, `app/(tabs)/_layout.tsx` + 5 placeholder routes | None |
| **2** | M1 | `screens-auth.jsx`, `screens-ops.jsx (AccountScreen, DeleteScreen)` | `app/welcome.tsx`, `app/onboarding/[step].tsx`, `app/(tabs)/account.tsx`, `app/account/delete/[step].tsx` | Cycle 1 |
| **3** | M2 | `screens-brand.jsx (BrandSwitcherSheet, BrandsListScreen, BrandProfileScreen)` | `app/brand/{switcher,list,[brandId]/index,[brandId]/edit}.tsx`, `src/components/brand/*` | Cycle 2 |
| **4** | M3 | `screens-brand.jsx (BrandPaymentsScreen, FinanceReportsScreen)` | `app/brand/[brandId]/payments/index.tsx`, `payments/onboard.tsx`, `payments/reports.tsx`, `src/components/payments/*` | Cycle 3 + Stripe Connect backend |
| **5** | M4 | `screens-creator.jsx (EventCreatorScreen + steps 1–7)` | `app/event/create.tsx` + 7 step routes | Cycle 1 |
| **6** | M5 | (design-package-silent — extend Cycle 5) | `app/event/[eventId]/dates/*` | Cycle 5 |
| **7** | M6 | (design-package-partial — CreatorStep5 + new ticket-type editor) | `app/event/[eventId]/tickets/*` | Cycle 5 |
| **8** | M7 | `screens-extra.jsx (PublicEventScreen, PublicTicket)`, `screen-public-brand.jsx (PublicBrandScreen)` | `app/public/e/[slug].tsx`, `app/public/b/[slug].tsx` | Cycle 1 |
| **9** | M8 | (design-package-silent — design new checkout from handoff §5.7) | `app/checkout/[eventId]/*` | Cycle 8 + Stripe Payment Element |
| **10** | M9 | `screens-home.jsx`, `screen-events-list.jsx`, `screens-ops.jsx (OrdersScreen, OrderDetailScreen)`, `screens-extra.jsx (GuestsScreen, RefundSheet, Toast)` | `app/(tabs)/home.tsx`, `app/(tabs)/events.tsx`, `app/event/[eventId]/index.tsx`, `app/event/[eventId]/orders/*`, `app/event/[eventId]/guests/*` | Cycle 5 |
| **11** | M10 | `screens-ops.jsx (ScannerScreen, ScanBtn, CashSaleScreen)`, `screens-extra.jsx (TicketQRScreen)` | `app/scanner/*` | Cycle 1 |
| **12** | M11 | (design-package-partial — CashSaleScreen ✓; card-reader/NFC silent) | `app/scanner/sale/payment/{card,nfc,manual}.tsx` | Cycle 11 + Stripe Terminal |
| **13** | M12 | (design-package-silent — design new) | `app/brand/[brandId]/team/*`, `app/event/[eventId]/scanners/*` | Cycle 3 |
| **14** | M13 | (audit / hardening; no new screen) | Cross-cutting | All prior cycles |
| — | LAUNCH | — | — | — |
| **15** | M14 | `screens-marketing.jsx (MarketingScreen, AudienceScreen, ContactProfileScreen)`, `screens-marketing-compose.jsx (EmailTemplatesScreen, EmailComposerScreen)` | `app/(tabs)/marketing/*`, `app/marketing/email/*` | All MVP done + email backend |
| **16** | M15 | `screens-marketing-compose.jsx (SmsComposerScreen)` | `app/marketing/sms/*` | M14 + Twilio |
| **17** | M16 | `screens-marketing-compose.jsx (JourneysScreen, JourneyDetailScreen, FlowNode, FlowConnector)` | `app/marketing/journeys/*` | M14 |
| **18** | M17 | (design-package-silent) | `app/marketing/tracking/*` | M14 |
| **19** | M18 | (design-package-partial — extend FinanceReportsScreen) | `app/marketing/analytics/*`, `app/event/[eventId]/analytics.tsx` | M14 |
| **20–22** | M19–M21 | `screens-ops.jsx (ChatScreen)` locked-state ✓; active state needs new design | `app/(tabs)/chat.tsx` | All MVP done |

---

## 9. Cleanup List

### 9.1 Design package files

| File | Fate | Reason |
|------|------|--------|
| `README.md` | **KEEP-AS-REFERENCE** | Audit trail of how the package was constructed |
| `chats/chat1.md` | **KEEP-AS-REFERENCE** | Brief; trivial; harmless |
| `chats/chat2.md` | **KEEP-AS-REFERENCE** | The substantive transcript that documents founder decisions |
| `project/Mingla Business.html` | **KEEP-AS-REFERENCE** | Doc canvas; useful for visual review across all 31 screens |
| `project/tokens.css` | **EXTRACT-THEN-DELETE** | Values absorbed into `mingla-business/src/constants/designSystem.ts`; CSS file becomes redundant |
| `project/app.jsx` | **KEEP-AS-REFERENCE** | State machine demonstrates routing logic for every screen — useful for implementor |
| `project/chrome.jsx` | **KEEP-AS-REFERENCE** | Visual reference for TopBar / BottomNav / IconChrome implementations |
| `project/primitives.jsx` | **KEEP-AS-REFERENCE** | Icon path data for porting to `react-native-svg` |
| `project/ios-frame.jsx` | **DELETE** | Prototype-display only; never used in production |
| `project/screens-auth.jsx` | **KEEP-AS-REFERENCE** | M1 implementor reference |
| `project/screens-home.jsx` | **KEEP-AS-REFERENCE** | M9 implementor reference |
| `project/screen-events-list.jsx` | **KEEP-AS-REFERENCE** | M9 implementor reference |
| `project/screens-creator.jsx` | **KEEP-AS-REFERENCE** | M4 implementor reference |
| `project/screens-extra.jsx` | **KEEP-AS-REFERENCE** | M9 + M10 implementor reference (PublicEventScreen, GuestsScreen, RefundSheet, Toast, TicketQRScreen) |
| `project/screen-public-brand.jsx` | **KEEP-AS-REFERENCE** | M7 implementor reference |
| `project/screens-ops.jsx` | **KEEP-AS-REFERENCE** | M1 (Account, Delete) + M9 (Orders) + M10 (Scanner, Cash) reference |
| `project/screens-brand.jsx` | **KEEP-AS-REFERENCE** | M2 + M3 implementor reference |
| `project/screens-marketing.jsx` | **KEEP-AS-REFERENCE** | M14 reference (post-MVP) |
| `project/screens-marketing-compose.jsx` | **KEEP-AS-REFERENCE** | M14–M16 reference (post-MVP) |
| `project/design-canvas.jsx` | **DELETE** | Docs canvas wrapper; never used in production |
| `project/uploads/HANDOFF_BUSINESS_DESIGNER.md` | **DELETE** | Duplicate of `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md`; the canonical lives in handoffs/ |

**Net outcome:** 18 files KEEP-AS-REFERENCE, 1 EXTRACT-THEN-DELETE, 3 DELETE. The 18 reference files stay in `Mingla_Artifacts/design-package/` until the corresponding implementor cycle ships (then can be deleted post-cycle if the codebase faithfully matches).

### 9.2 Locked-plan files

| File | Fate | Action summary |
|------|------|---------------|
| `Mingla_Artifacts/BUSINESS_PRD.md` | **PATCH** | ~12 patches — see `SPEC_BIZ_DESIGN_ABSORPTION.md` §1 |
| `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md` | **PATCH** | ~7 patches — Q5/Q9/Q10 resolutions, R-15, M0 + M9 task list extensions |
| `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md` | **PATCH** | ~8 patches — repo layout, screen inventory adds, component library adds, per-milestone task list extensions |
| `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md` | **PATCH** | ~6 patches — wizard labels, microcopy, monogram reference, Brands List + Finance Reports screen entries |
| `Mingla_Artifacts/DECISION_LOG.md` | **PATCH** | Append DEC-057 onwards |

### 9.3 Prompts directory

| File | Fate |
|------|------|
| `prompts/SPEC_BUSINESS_DESIGN_SYSTEM_AND_SCREENS.md` | **KEEP** (the original forensics dispatch that produced the Designer Handoff; historical) |
| `prompts/_SUPERSEDED_IMPLEMENTOR_M0_DESIGN_FOUNDATION.md` | **KEEP** (superseded prompt; audit trail per DEC-056) |
| `prompts/FORENSICS_AUDIT_DESIGN_PACKAGE_ABSORPTION.md` | **KEEP** (this dispatch) |
| `prompts/evidence/` | **KEEP** (evidence directory, untouched) |

### 9.4 Reports / specs

| File | Fate |
|------|------|
| `reports/AUDIT_BIZ_DESIGN_PACKAGE_ABSORPTION.md` | **NEW** (this report) |
| `specs/SPEC_BIZ_DESIGN_ABSORPTION.md` | **NEW** (the patch set) |

---

## 10. Draft DEC-057 onwards

Drafts for the orchestrator to commit to `DECISION_LOG.md` after founder approval. Format matches existing DECISION_LOG schema.

```
| DEC-057 | 2026-04-28 | **ORCH-BIZ-DESIGN-AUDIT-001 — Design package audit landed. ~70% of design elements adopted KEEP, ~25% TUNE (mostly nomenclature alignment), ~5% DISCARD-FOR-MVP (Marketing module designs preserved as M14 reference).** | Forensics audit at `Mingla_Artifacts/reports/AUDIT_BIZ_DESIGN_PACKAGE_ABSORPTION.md` produced 200+ classified elements with evidence-cited verdicts. Patch set at `Mingla_Artifacts/specs/SPEC_BIZ_DESIGN_ABSORPTION.md`. | (A) Adopt design package wholesale — rejected: pulls Marketing M14 designs into MVP, breaking throughput. (B) Discard design package and stay on locked plans — rejected: founder authorized ingest. (C) Selective absorption with audit + patch set — chosen. | Founder approves §6 Q-A1 through Q-A14, orchestrator applies patches, design package files retained as implementor reference until corresponding cycle ships. | Permanent — design absorption strategy now codified. |
| DEC-058 | 2026-04-28 | **5-tab navigation locked: Home / Events / Scan / Marketing / Account.** Marketing tab renders locked-state placeholder during MVP (M0–M13). | Q-A1 + Q-A2 + Q-A3 resolved. Founder authorized 5-tab during Claude Design conversation; pinned formally now. | (A) 4-tab — rejected: Marketing as primary tab is more discoverable. (B) Hide Marketing tab — rejected: locked-state placeholder primes organisers and avoids layout shift at M14. | Marketing tab is visible but locked until M14. Scan tab is active for all roles (event-picker for non-scanner roles). Chat tab folds into Account or returns at M19+ as a future tab swap. | Permanent. |
| DEC-059 | 2026-04-28 | **Public Brand Page added to MVP scope (M7).** `mingla.com/[brand-slug]` is part of MVP public-page deliverable. | Q-A4 resolved. Locked plans implied it; design package made it concrete. | (A) Defer to post-MVP — rejected: share-link UX needs it from launch. | Adds ~16 implementor hours to M7. Within budget. | Permanent. |
| DEC-060 | 2026-04-28 | **Events list with per-event Manage menu replaces direct-tap-to-detail in Events tab (M9).** | Q-A5 resolved. Strict UX upgrade for multi-event organisers; surfaces context-aware actions per event status. | (A) Direct-detail-tap (locked plan default) — rejected: Events list with manage actions is faster. | Adds ~24 implementor hours to M9. Within budget. | Permanent. |
| DEC-061 | 2026-04-28 | **Brand switcher topbar trigger on every primary tab.** Brand chip (avatar + brand name + chevron-down) in TopBar opens BrandSwitcherSheet from any primary tab. | Q-A6 resolved. Multi-brand operators switch context constantly; topbar trigger is faster than Account → Brands. | (A) Switcher only via Account → Brands (locked plan default) — rejected: too many taps for a frequent action. | Implemented in M0 TopBar primitive. Sheet built in M2. | Permanent. |
| DEC-062 | 2026-04-28 | **Status pill copy locked: LIVE / DRAFT / PENDING / PREVIEW / UPCOMING / ENDED / SOLD OUT.** | Q-A7 resolved. Concise, scannable. Adopt across every event/order/ticket status surface. | (A) Long-form ("This event is live now") — rejected: too verbose for pills. | Implementor uses these labels everywhere. | Permanent. |
| DEC-063 | 2026-04-28 | **KPI tile vocabulary locked: "Last 7 days," "Active events," "Live tonight," "Capacity," "Scanned," "Tickets sold," "Campaign revenue · 30d," "Open rate," "Click rate."** | Q-A8 resolved. | (A) Verbose handoff placeholders — rejected. | Canonical vocabulary across all dashboards. | Permanent. |
| DEC-064 | 2026-04-28 | **Onboarding 4-step path locked: Operator type → Brand creation w/ live URL availability check → Stripe (deferrable) → Ready confirmation.** | Q-A9 resolved (hybrid). Step 1 also captures display name confirmation. | (A) Handoff's verbose 4-step (welcome / display-name / brand / event-type) — rejected: package's path is sharper. | M1 implementor target. | Permanent. |
| DEC-065 | 2026-04-28 | **Event creator wizard step labels locked: Basics / When / Where / Cover / Tickets / Settings / Preview.** | Q-A10 resolved. Tighter, more confident than handoff placeholders. | (A) Handoff placeholders — rejected. | M4 implementor target. | Permanent. |
| DEC-066 | 2026-04-28 | **Design package microcopy adopted as canonical.** Where package and handoff cover the same surface, package copy supersedes handoff placeholders. | Q-A11 resolved. Package copy is uniformly tighter, warmer, more concrete. | (A) Maintain handoff placeholders — rejected. | Implementor uses package copy verbatim. | Permanent. |
| DEC-067 | 2026-04-28 | **Sample data canonicalised: Sara Marlowe, Lonely Moth + 3 secondary brands, Slow Burn vol. 4, Hidden Rooms, Marcus Lin et al.** | Q-A12 resolved. | (A) Handoff sample data (Sara Olsen / R&B Night) — rejected: package is richer. | Canonical demo data. Specific dates auto-correct at runtime. | Permanent. |
| DEC-068 | 2026-04-28 | **Mingla M monogram v1 locked: 32×32 rounded rect with `linear-gradient(135deg, #fb923c, #eb7825)` background and white M path stroke 2px.** | Q-A13 resolved. Founder may swap a custom wordmark later; component is swappable. | (A) Defer to brand designer — rejected: package mark ships now. | M0 implementor target. | Revisit if founder commissions a custom wordmark. |
| DEC-069 | 2026-04-28 | **Icon family v1: package's hand-rolled SVG library (60+ glyphs) instead of Phosphor / Ionicons.** | Q-A14 resolved. Covers every visible glyph in MVP; consistent stroke weight. | (A) Phosphor — rejected for v1; can swap later. (B) Ionicons — rejected: package set is tighter. | M0 implementor target. | Revisit at M14+ if iconography demands grow. |
```

---

## 11. Confidence Assessment

| Phase | Confidence | Reasoning |
|-------|------------|-----------|
| Phase 1 (Inventory) | H | Every file directly read; every token, component, screen, and route enumerated with line cite |
| Phase 2 (Mapping) | H | Every element traced to handoff / PRD / Strategic Plan section |
| Phase 3 (Verdicts) | H | Each verdict carries a one-paragraph rationale tied to evidence |
| Phase 4 (Absorption strategy) | H — patches; M — sequencing | Patches are concrete and applicable; sequencing assumes no major founder reversal of MVP scope |
| Phase 5 (Founder questions) | H | 14 questions fully scoped; recommendations confidence-rated |
| Phase 6 (Risk + invariant check) | H | All ⚠️ items are implementor-responsibility, not audit-blockers |
| Phase 7 (Sequencing) | M | Hours estimates are rough; refined when implementor produces M0 cycle 1 metrics |

**Open uncertainties:**
1. The **300-hour M14+ marketing module** absorbed from package as KEEP-AS-REFERENCE may need wholesale redesign after MVP user research; flagged as M14 spec-time decision.
2. **CashSaleScreen** is the only door-payment screen in package; M11 will need 3 net-new screen designs (card-reader, NFC tap, manual entry). Implementor must design these from handoff §3.11 + product judgment.
3. **Multi-date / recurring event creator** screens are silent in the package (CreatorStep2 covers single-date only). M5 will extend Step 2 with the design package's typography and primitives but the layout is design-time work.

---

## 12. Discoveries for Orchestrator

- **D-1 (HIGH):** The `tokens.css` file is in CSS variables form; the codebase is TypeScript. Implementor M0 must port to TS const exports while preserving every value. No drift acceptable.
- **D-2 (HIGH):** `expo-blur` is the native blur. Verify it's installed in `mingla-business/package.json` before M0 begins (orchestrator should preflight; if missing, add to M0 dependencies list).
- **D-3 (MEDIUM):** The package's `app.jsx` state machine routes to a flat list (auth / home / scanner / etc.). Production needs Expo Router file-based routing (`app/(tabs)/_layout.tsx` + nested route groups). The state machine is reference, not implementation pattern.
- **D-4 (MEDIUM):** The `PublicEventScreen` and `PublicBrandScreen` use `glass-badge` for floating chrome (back button, share). On web, these need `backdrop-filter` shim with `@supports` fallback to a solid `rgba(20,22,26,0.92)` per handoff §1.8.4.
- **D-5 (LOW):** The package's QR code is pseudo-random. Production needs `react-native-qrcode-svg` (mobile) + a web equivalent (`qrcode-svg` package). Add to M10 dependencies.
- **D-6 (LOW):** The package uses `oklch()` color in some places (event covers, event hero gradients). `oklch()` is not supported on iOS < 15 and some older Android. Implementor must fall back to `hsl()` / `rgb()` on those platforms or add a polyfill.
- **D-7 (LOW):** The Marketing module designs include compliance copy ("GDPR · opt-in · suppression"). Capture this for M14 spec — it's a non-functional requirement that the design surface implies.

---

**End of audit. The patch set is in `Mingla_Artifacts/specs/SPEC_BIZ_DESIGN_ABSORPTION.md`.**
