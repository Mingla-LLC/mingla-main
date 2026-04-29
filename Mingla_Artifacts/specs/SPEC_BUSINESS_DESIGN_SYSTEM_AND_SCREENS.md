# Mingla Business — Complete Design Specification

> **Document type:** Design contract for external designer
> **Audience:** Product designer producing the entire Mingla Business mockup set
> **Companion document:** `SPEC_BUSINESS_USER_JOURNEYS.md` (Section 6 lives there)
> **Source planning trinity:** `BUSINESS_PRD.md`, `BUSINESS_STRATEGIC_PLAN.md`, `BUSINESS_PROJECT_PLAN.md`
> **Aesthetic inheritance:** Mingla consumer app (`app-mobile/`) — "floating glass + futuristic"
> **Status:** Draft v1, evidence-cited
> **Author:** Mingla Forensics

---

## How to read this document

This document is a contract. A designer with zero Mingla context must be able to produce pixel-accurate mockups by reading it cover to cover. Every value is concrete (hex codes, blur radii, ms durations, easing curves). No adjectives stand alone. Every claim about the consumer app cites a source file with line numbers — the appendix in Section 12 is the master evidence trail.

The deliverable mockup set is enumerated in Section 10. Until that checklist is satisfied, the designer's work is not done.

The product is **Mingla Business** — the partner-side surface where event organisers create, manage, market, and monetise events. Mingla itself is an experience / date-planning / social-experiences app; **never** describe Mingla as a dating app in any string, sample data, or rationale.

---

# Section 0 — Executive Brief

## What Mingla Business is

Mingla Business is the operating system for live experiences. It is the place where event organisers — independent promoters, brands, lifestyle operators, hospitality venues, ticket-issuing teams — run their entire event lifecycle on one mobile-first, web-accessible platform. They sign up, create a brand, build an event, sell tickets online and at the door, scan attendees in, and settle their payouts, all without leaving the product.

It is the partner-side counterpart to the Mingla consumer app, which serves attendees discovering experiences. The two apps share a Supabase backend, a visual language, and a brand promise. They are separate products with inverted needs: attendees want discovery and trust; organisers want power tools, financial control, audit trails, and team permissions.

## Who designs for whom

You are designing for organisers and the people they invite (brand admins, event managers, finance managers, marketing managers, scanners) — and for the attendees who land on public event pages, brand pages, and organiser pages they share to the open web.

Six personas in total drive every screen:
1. Account owner (the founder of an organising operation)
2. Brand admin (a teammate with full operational authority on a single brand)
3. Event manager (scoped to specific events)
4. Finance manager (scoped to financial views and refunds)
5. Scanner (door staff with QR-validation and optional door-payment authority)
6. Attendee (signed-out or signed-in user landing on a public page)

A marketing manager role exists in the PRD but is post-MVP.

## Why "floating glass + futuristic"

The Mingla consumer app uses a deliberately developed visual language: deep, muted dark surfaces; warm orange accent (`#eb7825`) used like a spotlight, never wallpaper; type that holds confidence without weight; and floating chrome — headers, pill bars, bottom nav — that hover above content with backdrop blur, hairline borders, subtle inner highlights, and shadow stacks. The system is calm, premium, and unmistakably current.

Mingla Business inherits this language unchanged for organiser-facing surfaces. The shared sensory baseline tells partners they are inside the same product family, and it differentiates Mingla Business from the chrome-heavy, bureaucratic UIs of incumbent partner platforms (Eventbrite, OpenTable Manager, Posh).

Where the consumer language does not transfer cleanly — finance tables, dense data grids, scanner UI, web desktop layouts — this spec proposes futuristic-aligned variants that preserve the language without forcing it into shapes it cannot hold.

## What "mobile + web parity" means

Every feature in MVP scope ships on both mobile (iOS / Android via Expo) and web (via React Native Web in a single codebase). Parity does not mean "identical pixels." It means **same capabilities, same outcomes, same trust, on every form factor.** A list on mobile can be a table on desktop web; a sheet on mobile can be a modal on desktop web; a 7-step wizard on mobile can be a single scrolling page on desktop web. The spec defines which screens diverge how.

## What MVP includes (and what it does not)

**MVP, in scope of this spec:**
- Authentication, onboarding, account management, account deletion (signed-in destruction with a 30-day undo window)
- Brands: create, profile, switch, settings, payments via Stripe Connect, team invitations and role assignment
- Events: full create/manage flow including single-date, recurring, multi-date; theming; visibility; preview; publish; edit-after-publish
- Tickets: every type and field in PRD §4 — paid, free, hidden, disabled, password-protected, approval-required, online-only, in-person-only, limited, unlimited, waitlist-enabled, transferable, non-transferable
- Public pages: event page, brand page, organiser page (each shareable, OG-tagged, mobile + web responsive)
- Online checkout: ticket selection, buyer details, Stripe Payment Element, Apple Pay / Google Pay, QR ticket, email + SMS confirmation, wallet add
- Event management: dashboard, orders, refunds, guest list, manual check-in, approval queue
- Scanner: scan, validate, dedupe, manual lookup, offline queue, activity log
- In-person payments: card reader, NFC tap-to-pay (gated), cash, manual; door receipts; reconciliation
- Permissions: role assignment UI; per-brand and per-event scopes; permission audit
- Cross-cutting: empty states, error states, loading states, offline indicators, force-update, suspended-account, network-down

**Explicitly out of MVP and represented in this spec only as locked/empty placeholders:**
- Marketing (email, SMS, CRM, nurturing, compliance)
- Tracking / attribution
- Analytics dashboards beyond minimal in-screen counters
- AI guest psychology, AI copy/ticket/campaign suggestions
- Chat agent in bottom nav (Tab 3 is a placeholder until M20)

## What the deliverable mockup set must contain

Section 10 is the binding checklist. At minimum: a complete style guide page; a complete component library page; the sitemap; every screen on mobile, tablet, desktop, and wide-desktop where layouts differ; every state per screen; every user journey diagram; production microcopy on every visible string; light-and-dark variants for every public-facing screen; accessibility annotation layers; and motion prototypes for the ten highest-traffic interactions.

## How this spec is structured

- **Sections 1–4** define the system: design language, responsive foundations, component library, information architecture.
- **Section 5** enumerates every screen with a per-screen template.
- **Section 6** (companion file `SPEC_BUSINESS_USER_JOURNEYS.md`) traces every user journey end-to-end.
- **Sections 7–9** layer in microcopy, accessibility, and motion.
- **Section 10** is the deliverable checklist.
- **Section 11** surfaces open design questions for founder decision.
- **Section 12** is the master evidence trail — every consumer-app citation with file path and line number.

The designer is expected to read the document linearly the first time, then use Section 5 as the working reference while producing mockups, with Sections 1–3 as the constant style-guide companion.

---

# Section 1 — The Floating Glass Futuristic Design Language

> Every value in this section is extracted from the consumer Mingla app source code (`app-mobile/`) or its design implementation reports. Citations live in Section 12. Where this spec proposes new tokens for Business surfaces (finance tables, scanner UI, desktop-web layouts), the divergence is called out and reasoned.

## 1.1 Brand essence

Mingla feels like late-evening city light: dark canvas, warm spotlight, glass that floats one layer above the world. Surfaces are calm and recede; chrome is precise and confident; motion is short, decisive, and never decorative. The product treats the user's attention as scarce — typography earns its size, color earns its saturation, motion earns its duration. Nothing is loud unless it has a job. The result is a tool that feels expensive without being decorated, futuristic without being cold, and serious without being clinical.

For Mingla Business, that essence carries forward and adds **operator confidence**: the partner must feel the platform is in control of their money, their guests, their schedule. Glass over chaos. Calm under load.

## 1.2 Core motifs

Six motifs make a Mingla screen recognisably Mingla. Every Business screen must use at least three of these in deliberate combination:

1. **Floating chrome.** Headers, pill bars, bottom nav, action shelves do not sit on top of content; they hover above it. They have their own depth via shadow, blur, and a hairline highlight. They intentionally let the content beneath them bleed through softly.
2. **Glass cards.** Content modules use a five-layer glass stack (blur backdrop → tint floor → top highlight → border hairline → drop shadow). Glass cards never use heavy fills; the depth comes from layering opacity and blur, not from solid color.
3. **Warm-orange spotlight.** The accent (`#eb7825`) is used where the user must look — active state, primary CTA, success affordance, and selected pill. Never as wallpaper. Never on body type. Never adjacent to itself.
4. **Generous spatial breathing.** Container padding is 16–24px on mobile, 32–48px on desktop. No element fights its neighbour for breathing room.
5. **Type that holds without shouting.** Hero typography is 26–32px at weight 700 with letter-spacing -0.2 to -0.4 (tightening); body is 14–16px at weight 400–500. The system rarely uses ALL CAPS — when it does, it is small (12px), letter-spaced (1.4), and reserved for category labels.
6. **Motion that has finished by the time you notice it.** Entry animations 220–280 ms with `easing.out(cubic)`. Exits 180 ms with `easing.in(cubic)`. Press feedback 100–120 ms. Springs are tuned damping 18 / stiffness 260 / mass 0.9 unless otherwise specified.

## 1.3 Color system

### 1.3.1 Brand & accent

| Token | Value | Use |
|-------|-------|-----|
| `primary.500` | `#f97316` | Core orange. Primary CTAs, sent message bubbles, subscription tier indicators |
| `primary.600` | `#ea580c` | Pressed-state primary CTA |
| `primary.700` | `#c2410c` | Deep-press primary CTA, heavy emphasis |
| `accent.warm` | `#eb7825` | The spotlight. Active selection, glow color, focus ring |
| `accent.warm.glow` | `rgba(235, 120, 37, 0.35)` | Default active-state glow shadow |
| `accent.warm.tint` | `rgba(235, 120, 37, 0.28)` | Active background fill on glass surfaces |
| `accent.warm.border` | `rgba(235, 120, 37, 0.55)` | Active border on glass surfaces |

### 1.3.2 Dark glass canvases (organiser surfaces, dark mode)

| Token | Value | Use |
|-------|-------|-----|
| `canvas.discover` | `rgba(12, 14, 18, 1)` | Default dark-canvas behind glass chrome |
| `canvas.profile` | `rgba(20, 17, 19, 1)` | Plum-charcoal canvas for profile-style screens |
| `canvas.depth` | `rgba(8, 9, 12, 1)` | Modal backdrop / scrim base |

### 1.3.3 Glass tint floors (Layer 2 of glass stack)

| Token | Value | Use |
|-------|-------|-----|
| `glass.tint.badge.idle` | `rgba(12, 14, 18, 0.42)` | Glass badge on imagery |
| `glass.tint.badge.pressed` | `rgba(12, 14, 18, 0.52)` | Glass badge pressed state |
| `glass.tint.chrome.idle` | `rgba(12, 14, 18, 0.48)` | Glass chrome (top bar, bottom nav, switcher) |
| `glass.tint.chrome.pressed` | `rgba(12, 14, 18, 0.58)` | Glass chrome pressed state |
| `glass.tint.backdrop` | `rgba(12, 14, 18, 0.34)` | Top-bar backdrop (lighter than chrome) |
| `glass.tint.profile.base` | `rgba(255, 255, 255, 0.04)` | Profile-card base (light glass on dark canvas) |
| `glass.tint.profile.elevated` | `rgba(255, 255, 255, 0.06)` | Profile-card elevated variant |
| `glass.tint.onboarding` | `rgba(255, 255, 255, 0.55)` | Light-mode glass surfaces (auth, public pages) |

### 1.3.4 Glass borders (Layer 4 of glass stack)

| Token | Value | Use |
|-------|-------|-----|
| `glass.border.badge` | `rgba(255, 255, 255, 0.14)` | Hairline on glass badges |
| `glass.border.chrome` | `rgba(255, 255, 255, 0.06)` | Hairline on glass chrome (lowered from 0.12 per consumer ORCH-0669) |
| `glass.border.profile.base` | `rgba(255, 255, 255, 0.08)` | Profile-card base hairline |
| `glass.border.profile.elevated` | `rgba(255, 255, 255, 0.12)` | Profile-card elevated hairline |
| `glass.border.pending` | `rgba(255, 255, 255, 0.28)` | Dashed border on pending/disabled glass elements |

### 1.3.5 Glass top-highlights (Layer 3 of glass stack)

| Token | Value | Use |
|-------|-------|-----|
| `glass.highlight.badge` | `rgba(255, 255, 255, 0.22)` | Top edge highlight on badges (1px line) |
| `glass.highlight.profile.base` | `rgba(255, 255, 255, 0.10)` | Top edge highlight on base profile cards |
| `glass.highlight.profile.elevated` | `rgba(255, 255, 255, 0.14)` | Top edge highlight on elevated profile cards |

### 1.3.6 Neutral grays (used sparingly on dark surfaces; primary on light surfaces)

| Token | Value | Use |
|-------|-------|-----|
| `gray.50` | `#f9fafb` | Lightest. Chat timestamp pills, light-mode background secondary |
| `gray.100` | `#f3f4f6` | Received message bubbles, light-mode surface |
| `gray.200` | `#e5e7eb` | Light-mode dividers, input borders |
| `gray.600` | `#4b5563` | Light-mode secondary text |
| `gray.700` | `#374151` | Light-mode tertiary text |
| `gray.800` | `#1f2937` | Light-mode strong text |
| `gray.900` | `#111827` | Light-mode primary text |

### 1.3.7 Semantic

| Token | Value | Light-mode use | Dark-mode use |
|-------|-------|---------------|---------------|
| `semantic.success` | `#22c55e` | Confirmed, paid, scanned successfully | Same; surrounds with `rgba(34, 197, 94, 0.18)` glass tint |
| `semantic.success.tint` | `rgba(34, 197, 94, 0.18)` | Toast/banner background | Same |
| `semantic.warning` | `#f59e0b` | Stripe onboarding incomplete, ticket sales window approaching | Same |
| `semantic.warning.tint` | `rgba(245, 158, 11, 0.18)` | Toast/banner background | Same |
| `semantic.error` | `#ef4444` | Refund, declined payment, scan failed | Same |
| `semantic.error.tint` | `rgba(239, 68, 68, 0.18)` | Toast/banner background | Same |
| `semantic.info` | `#3b82f6` | Info banner, neutral notification | Same |
| `semantic.info.tint` | `rgba(59, 130, 246, 0.18)` | Toast/banner background | Same |

### 1.3.8 Light-mode surfaces (auth, onboarding, public pages, brand-managed light themes)

| Token | Value | Use |
|-------|-------|-----|
| `bg.primary.light` | `#ffffff` | Light-mode background |
| `bg.secondary.light` | `#f9fafb` | Light-mode secondary surface |
| `bg.warm-glow` | `#fff9f5` | Auth gradient endpoint, warm off-white |
| `text.primary.light` | `#111827` | Light-mode primary text |
| `text.secondary.light` | `#4b5563` | Light-mode secondary text |
| `text.tertiary.light` | `#6b7280` | Light-mode tertiary text |
| `text.inverse` | `#ffffff` | Text over dark glass / orange CTAs |

### 1.3.9 Mode policy

- **Organiser-facing dashboard surfaces** (Home, Events, Account, Brand, Event detail, Scanner) are **dark-mode-default** to match the consumer aesthetic and to be eye-friendly during long event-night shifts.
- **Public-facing pages** (event, brand, organiser) ship in **both light and dark** modes, with brand theme accent overrides controlled per-event (PRD §3.1 "Choose a color preset / Input a custom event color"). Default is dark.
- **Auth and onboarding** ship in light + warm-glow gradient (existing pattern in `BusinessWelcomeScreen.tsx`).
- **Print/exports** (CSV, PDF receipts) are light-mode only.

### 1.3.10 Contrast budget (WCAG)

Every text/background pair documented below must hit at least WCAG AA (4.5:1 normal, 3:1 large). Spot checks the designer must perform:

| Pair | Contrast ratio target | Notes |
|------|----------------------|-------|
| `text.inverse` on `primary.500` | ≥ 4.5:1 | CTA button — verify `#ffffff` on `#f97316` |
| `text.inverse` on `accent.warm` | ≥ 4.5:1 | Active state |
| Body text on `canvas.discover` | ≥ 4.5:1 | Light text on near-black |
| Hairline borders on glass | not WCAG-bound but ≥ 1.5:1 | For visibility |
| Status colors on canvas | ≥ 3:1 large, ≥ 4.5:1 small | Error/warn/success/info |

## 1.4 Typography

### 1.4.1 Font families

- **Primary (mobile + web):** SF Pro on iOS, Roboto on Android, Inter on web. Weights 400/500/600/700.
- **Web fallback stack:** `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- **Monospace (for codes, IDs, QR fallback strings, finance figures in tables):** `"JetBrains Mono", "SF Mono", "Roboto Mono", monospace`. Weights 400/500.

If the founder elects to license a brand display face (e.g., Söhne, Inter Display) post-MVP, it slots into hero/h1/h2 only. The designer should leave a token slot `font.display` defaulting to Inter for now.

### 1.4.2 Type scale (px)

| Role | Size | Line height | Weight | Letter spacing | Use |
|------|------|-------------|--------|----------------|-----|
| display | 32 | 48 | 700 | -0.4 | Marketing/hero blocks on public organiser pages, splash splash-text |
| h1 | 26 | 32 | 700 | -0.2 | Profile/brand name, page hero |
| h2 | 24 | 36 | 700 | -0.2 | Section headers |
| h3 | 20 | 32 | 600 | 0 | Card titles, subsection headers |
| body-lg | 18 | 28 | 500 | 0 | Lead paragraphs, primary form labels |
| body | 16 | 24 | 400 | 0 | Default body |
| body-sm | 14 | 20 | 400 | 0 | Secondary body, dense lists |
| caption | 12 | 16 | 500 | 0.2 | Captions, helper text, microcopy |
| micro | 11 | 14 | 600 | 0.4 | Status pills, very small UI |
| label-cap | 12 | 16 | 600 | 1.4 | Uppercased category labels (sparingly) |
| button-lg | 16 | 24 | 600 | 0 | Primary button |
| button-md | 14 | 20 | 600 | 0.2 | Default button |
| stat-value | 26 | 32 | 700 | -0.4 | Big number tiles (revenue, scans) |
| mono-md | 14 | 20 | 500 | 0 | Mono digits in finance tables |

### 1.4.3 Typographic rules

- Never bold body text purely for emphasis — emphasis is achieved by color (orange) or container (callout).
- Never use italic on dark surfaces; legibility drops.
- Never letter-space lowercase headings.
- Never use ALL CAPS above 14px — it screams.
- Numbers in finance tables use `mono-md` and tabular-numerals (`font-variant-numeric: tabular-nums`) so columns align.
- Currency follows the user/brand locale; the symbol position, decimal separator, and thousands separator come from `Intl.NumberFormat`.

## 1.5 Spacing scale (px)

```
xxs  : 2     ultra-compact (message grouping, micro stack)
xs   : 4     icon-to-label, inline group
sm   : 8     adjacent grouped controls
md   : 16    default container padding, default vertical rhythm
lg   : 24    card padding, between sections
xl   : 32    page padding (mobile baseline)
xxl  : 48    page padding (desktop), large vertical separation
```

Rules:
- Mobile container outer padding: `xl` (32px) horizontal on hero, `lg` (24px) on dense screens, `md` (16px) on lists.
- Tablet: add 32px outer gutters either side of mobile layout.
- Desktop: max content width 1200px; everything beyond that becomes outer gutter; 64–96px gutters at xl breakpoint.
- Never use values outside the scale. If something needs 12px, use `md - xs` or commit to an in-scale value.

## 1.6 Radius scale (px)

```
sm    : 8     inputs, dense pills, small chips
md    : 12    standard buttons, secondary cards
lg    : 16    cards, default
xl    : 24    premium cards, modals on web, large surfaces
xxl   : 28    profile-card elevated variant
display : 40  swipe-card / hero card (matches device bezel curve)
full  : 999   fully rounded pills, avatars, FAB
```

Rules:
- Inputs and dense controls use `sm`.
- Buttons (default size) use `md` for square-ish buttons and `full` for pill buttons.
- Cards holding content use `lg` or `xl`.
- Avatars are always `full`.
- Bottom nav capsule is `full` against a height of 72 (Android 69), giving a 36 effective radius.

## 1.7 Shadows & elevation

### 1.7.1 Generic elevation stack (used on light-mode surfaces and as base for glass)

| Token | Color | Offset (x, y) | Blur | Opacity | Elevation (Android) |
|-------|-------|---------------|------|---------|---------------------|
| `shadow.sm` | `#000` | 0, 1 | 3 | 0.10 | 2 |
| `shadow.md` | `#000` | 0, 4 | 6 | 0.10 | 4 |
| `shadow.lg` | `#000` | 0, 10 | 15 | 0.10 | 8 |
| `shadow.xl` | `#000` | 0, 20 | 25 | 0.10 | 12 |

### 1.7.2 Glass-specific shadows

| Token | Color | Offset | Blur | Opacity | Elevation | Use |
|-------|-------|--------|------|---------|-----------|-----|
| `shadow.glass.badge` | `#000` | 0, 2 | 8 | 0.25 | 4 | Glass badges |
| `shadow.glass.chrome` | `#000` | 0, 4 | 12 | 0.28 | 6 | Top bar, bottom nav, pill switcher |
| `shadow.glass.chrome.active` | `#eb7825` | 0, 0 | 14 | 0.35 | 8 | Active spotlight glow on chrome |
| `shadow.glass.card.base` | `#000` | 0, 4 | 16 | 0.30 | 6 | Default glass card |
| `shadow.glass.card.elevated` | `#000` | 0, 8 | 24 | 0.42 | 10 | Hero/elevated glass card |
| `shadow.glass.modal` | `#000` | 0, 16 | 40 | 0.48 | 16 | Modal/sheet shadow |

### 1.7.3 Edge highlight + inner stroke (glass authenticity)

A glass surface always carries a 1px top edge highlight (a horizontal line at the top of the radius), stronger than its hairline border, set in `glass.highlight.*`. This is what reads as "glass catching light." The full layer order is:

1. **L1 — Backdrop blur (BlurView native; backdrop-filter on web)**
2. **L2 — Tint floor (rgba)**
3. **L3 — Top edge highlight (1px line at top of radius)**
4. **L4 — Hairline border (1px, all sides, color from `glass.border.*`)**
5. **L5 — Drop shadow (from `shadow.glass.*`)**

The order is non-negotiable. A glass element that omits any layer reads as "translucent panel," not "glass."

## 1.8 Backdrop blur & glass rules

### 1.8.1 Native (iOS / Android via Expo Blur)

| Surface | `intensity` | `tint` | Notes |
|---------|-------------|--------|-------|
| Glass badge | 24 | dark | Discovery card labels, status pills |
| Glass chrome (top bar / bottom nav / pill switcher) | 28 | dark | Floating chrome |
| Glass backdrop (above status bar) | 22 | dark | Lighter than chrome to let canvas bleed up |
| Glass profile card base | 30 | dark | Bento tiles |
| Glass profile card elevated | 34 | dark | Hero tiles |
| Glass modal | 40 | dark | Modal backdrops |
| Glass discover-card label | 22 | dark | Card metadata |
| Glass filter bar | 22 | dark | Sub-perceptible |

### 1.8.2 Web (CSS backdrop-filter)

For each native intensity, the web equivalent is `blur(Npx) saturate(M%)`:

| Native intensity | Web filter |
|------------------|------------|
| 22 | `blur(22px) saturate(120%)` |
| 24 | `blur(24px) saturate(130%)` |
| 28 | `blur(28px) saturate(140%)` |
| 30 | `blur(30px) saturate(140%)` |
| 34 | `blur(34px) saturate(145%)` |
| 40 | `blur(40px) saturate(150%)` |

Combined with the rgba layers above the blur, the result matches native within perceptible tolerance. The hairline border remains 1px solid; the top highlight remains 1px gradient; the shadow remains identical to native.

### 1.8.3 Glass-on-glass rule

Two glass surfaces may stack only when separated by at least 16px of canvas. When they overlap (a glass dropdown opening from a glass header):
- The lower surface's blur intensity drops by 4 (chrome 28 → 24 underneath).
- The upper surface gains a stronger shadow (`shadow.glass.modal`).
- The lower surface darkens its tint floor by 0.06 alpha.

Three glass surfaces never stack. If the design requires it, redesign — the system reads as muddy.

### 1.8.4 Reduce-Transparency / no-blur fallback

- iOS Reduce Transparency, Android < 12, low-end devices, and any web environment without `backdrop-filter` support fall back to a **solid surface**: `rgba(20, 22, 26, 0.92)` on dark, `rgba(255, 255, 255, 0.96)` on light.
- Border, shadow, edge highlight, content, and motion are preserved.
- The product is fully usable in fallback mode; only the perceived "glass" character softens.

### 1.8.5 Floating behavior

A glass surface "floats" by satisfying all of:
1. **Position** — fixed/sticky relative to its viewport, not flowing with content underneath.
2. **Shadow** — at least `shadow.glass.chrome`, never less.
3. **Bleed-through** — content beneath scrolls under it; the surface is partially transparent.
4. **Reactive shadow** — when content under it scrolls past the top of viewport, the shadow steps up by one level (`shadow.glass.chrome` → `shadow.glass.chrome.scrolled`, blur 16, opacity 0.34) over 200 ms with `easing.out(cubic)`.
5. **Show/hide motion** — when the surface enters or leaves (e.g., contextual header on a detail screen), it uses opacity 0→1 + translateY ±16 → 0; entry 260 ms `easing.out(cubic)`, exit 180 ms `easing.in(cubic)`.

## 1.9 Iconography

### 1.9.1 Primary icon family

The consumer app uses Expo Vector Icons (Material Community + Ionicons mix). For Mingla Business, **standardise on a single family for visual coherence**:

- **Recommended:** Phosphor Icons (regular weight default) — broad, modern, futuristic, well-licensed for both mobile and web. Sizes: 16 / 20 / 22 / 24 / 28 / 32 / 40.
- **Fallback acceptable:** Ionicons (already shipping in business `package.json`) for parity with consumer.

Until the founder elects, use Ionicons in mockups but include alternates from Phosphor on the style guide page so the swap is visible. (See Section 11 — Open Question.)

### 1.9.2 Icon style rules

- Stroke weight: 1.75–2px equivalent. Never hairline (0.5px reads thin on dark canvas).
- Container treatment: a glass circular container (`44 × 44`, radius `full`, blur 28, tint floor `glass.tint.chrome.idle`) when the icon is a button.
- Color rules: active = `text.inverse` over orange tint; inactive = `rgba(255, 255, 255, 0.65)`; hovered (web) = `rgba(255, 255, 255, 0.85)`; disabled = `rgba(255, 255, 255, 0.32)`.
- Sizes:
  - Icon-only button (chrome): 22px icon in 44px container.
  - Inline-text icon: 16–18px paired with body or button text.
  - Tab nav icon: 22px above 10px label in 72px capsule.
  - Status indicator icon: 14–16px inside status pill.

### 1.9.3 Custom icons

Mingla-specific icons (Mingla mark, scanner reticle, swipe-pile glyph) live in `mingla-business/src/components/ui/BrandIcons.tsx` (already exists with `AppleLogo`). Designer must produce, at minimum:
- **Mingla M monogram** — used as in-app brand mark, splash, OG card watermark.
- **Scanner reticle frame** — 280×280 viewfinder cutout.
- **Glass-drop favicon** — for web tab.
- **QR ticket badge** — for ticket QR display.
- **Tap-to-pay icon** — for NFC entry.
- **Curated-hand icon** — used on organiser-grade ribbon for verified brands.

## 1.10 Imagery & media

### 1.10.1 Photography style (organiser-supplied event covers)

Organisers upload event covers per PRD §3.1. The design system constrains how they render:

- **Aspect ratio enforced at upload:** 16:9 minimum on web hero; 4:5 portrait on swipe-deck rendering. The system stores both crops.
- **Bottom gradient overlay** (always applied for legibility): linear gradient from `rgba(0, 0, 0, 0)` at 50% to `rgba(0, 0, 0, 0.72)` at 100%. Title and ticket-CTA sit on the gradient region.
- **Top gradient overlay** (when chrome floats above): `rgba(0, 0, 0, 0.32)` at 0% to `rgba(0, 0, 0, 0)` at 30%.
- **Color treatment:** none. Organiser images render as-uploaded except for the gradients above.
- **Loading state:** skeleton with subtle shimmer (linear gradient sweeping `rgba(255, 255, 255, 0)` → `rgba(255, 255, 255, 0.06)` → `rgba(255, 255, 255, 0)` over 1400 ms, `easing.inOut(sin)`).
- **Failed-load state:** dark canvas with center-aligned `image.broken` icon at 40% opacity and microcopy "Image couldn't load."

### 1.10.2 Video covers

Organisers may upload short loops (PRD §3.1 "Upload a custom event video"). Design rules:
- **Max 12s, autoplay muted, loop on.**
- **Poster frame required** (auto-extracted at frame 1; organiser may override).
- **Play indicator:** small glass badge with mute/unmute toggle, bottom-right of hero, only visible when sound is available.
- **On reduce-motion:** show poster frame only; do not autoplay.

### 1.10.3 GIF library (PRD §3.1 "Choose an animated GIF from a built-in library")

Designer must produce a curated library of 36 looping GIFs spanning event genres: nightlife, brunch, comedy, music, theatre, sports, wellness, food, dance, art. Rules:
- **600×600 px square master, exported at 4:5 and 16:9 crops.**
- **Max 8s loop, max 1.5MB file size.**
- **Mood palette consistent with floating glass / futuristic — desaturated highlights, no neon overload.**
- **Library page:** a tap-to-select grid in the event creator (Step 4).

### 1.10.4 OG cards / share previews

Public-page share previews must present the brand consistently. Designer produces a single OG-card template:

- 1200×630 px.
- Layout: full-bleed event cover image, bottom 200 px overlay with `rgba(0, 0, 0, 0.78)` tint and Mingla M monogram + event title + brand name + date band.
- Twitter card (`summary_large_image`) uses the same template.
- Per-platform refinements: iMessage rich link, WhatsApp preview (square 600×600 fallback), Slack/Discord preview.

## 1.11 Motion & easing

### 1.11.1 Easing curves

| Token | Native (Easing) | CSS (cubic-bezier) | Use |
|-------|-----------------|--------------------|-----|
| `ease.out` | `Easing.out(Easing.cubic)` | `cubic-bezier(0.33, 1, 0.68, 1)` | Entry / show / appear |
| `ease.in` | `Easing.in(Easing.cubic)` | `cubic-bezier(0.32, 0, 0.67, 0)` | Exit / hide / dismiss |
| `ease.inout` | `Easing.inOut(Easing.cubic)` | `cubic-bezier(0.65, 0, 0.35, 1)` | Repositioning / morphing |
| `ease.press` | `Easing.out(Easing.ease)` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | Press / tap feedback |
| `ease.sine` | `Easing.inOut(Easing.sin)` | `cubic-bezier(0.37, 0, 0.63, 1)` | Breathing / pulse / shimmer |

### 1.11.2 Durations

| Token | ms | Use |
|-------|----|-----|
| `duration.instant` | 80 | Hover state on web, immediate feedback |
| `duration.fast` | 120 | Press / tap / pill pulse |
| `duration.normal` | 200 | Modal/sheet open, surface morph |
| `duration.entry` | 260 | Glass chrome show, route push |
| `duration.exit` | 180 | Glass chrome hide, route pop |
| `duration.slow` | 320 | Sheet open from bottom, large surface entrance |
| `duration.deliberate` | 400 | Onboarding step transitions, hero morphs |
| `duration.slowest` | 800 | Profile level-ring count-up, large stat pulse |

### 1.11.3 Spring configs

| Token | damping | stiffness | mass | Use |
|-------|---------|-----------|------|-----|
| `spring.bottom-nav` | 18 | 260 | 0.9 | Spotlight on active tab |
| `spring.save-bounce` | 12 | 280 | 1.0 | Bookmark/save/like ping |
| `spring.gentle` | 22 | 200 | 1.0 | Default sheet open |
| `spring.snappy` | 16 | 320 | 0.85 | Drag-to-dismiss release |

### 1.11.4 Motion catalog (system-level)

| Behavior | Duration | Easing | Notes |
|----------|----------|--------|-------|
| Route push | 320 | `ease.out` | Slide from right; elevation rises by `shadow.glass.modal` |
| Route pop | 240 | `ease.in` | Slide back; elevation drops |
| Modal open (web) | 200 | `ease.out` | Scrim fades 0→0.6, content scales 0.96→1, opacity 0→1 |
| Sheet open (mobile) | 320 | `spring.gentle` | Translates from bottom; scrim fades 0→0.5 |
| Toast enter | 220 | `ease.out` | Slide-down + opacity 0→1 |
| Toast exit | 160 | `ease.in` | Slide-up + opacity 1→0 |
| Skeleton shimmer | 1400 | `ease.sine` | Continuous loop |
| Press feedback | 120 | `ease.press` | Scale 0.96, opacity 0.92 |
| Sticky-header shadow step-up | 200 | `ease.out` | Triggered when content scrolls past top |
| Save / bookmark ping | 280 | `spring.save-bounce` | Scale 1 → 1.15 → 1 |
| Realtime new-row insert | 240 | `ease.out` | Slide-down + bg-flash from `accent.warm.tint` (260 ms hold) → fade |
| Tab spotlight slide | spring | `spring.bottom-nav` | Animates left/width to active tab |
| Glass active morph | 200 | `ease.inout` | Tint and border morph between idle/active |
| Page transition (web) | 200 | `ease.out` | Fade-only, no slide on web |

### 1.11.5 Reduce motion behavior

- All translate/scale animations collapse to opacity-only.
- Spring animations linearise to `duration.normal` with `ease.inout`.
- Shimmer becomes static skeleton.
- Pulse / breathing motion stops entirely.
- Route transitions cross-fade.
- The product remains fully usable; nothing depends on motion to convey state.

## 1.12 Sound & haptics

### 1.12.1 Haptics (mobile only)

| Event | Type | Notes |
|-------|------|-------|
| Tap on glass chrome button | `Haptics.ImpactFeedbackStyle.Light` | Default press feedback |
| Successful scan | `Haptics.NotificationFeedbackType.Success` | Door scanner success |
| Duplicate scan | `Haptics.NotificationFeedbackType.Warning` | Already used |
| Failed scan / declined payment | `Haptics.NotificationFeedbackType.Error` | Always paired with visual error |
| Drag-to-dismiss release | `Haptics.ImpactFeedbackStyle.Medium` | Sheet snap |
| Long-press to confirm | `Haptics.ImpactFeedbackStyle.Heavy` | Type-to-confirm + hold variant |

### 1.12.2 Sound

- The product ships **silent by default**. No interaction sounds.
- Optional: scanner mode may play a 200 ms confirm chirp on successful scan if the organiser enables "audible scan" in scanner settings. Designer specifies the toggle; engineering supplies the audio asset (240 Hz–880 Hz quick chime, normalised to -20 LUFS).
- Web: no sound.

## 1.13 Tone of voice

Mingla Business writes in the **founder voice**: direct, warm, specific. The tone treats the organiser as a peer who is busy and competent. Copy never:

- Uses generic CTA verbs ("Submit", "Click here", "Continue").
- Promises with words it can't keep ("Effortless", "Magical", "Seamlessly").
- Apologises in passive voice ("There seems to have been an issue").
- Names the agent in 3rd person ("The system").
- Uses dating-app language. Mingla is an experience / date-planning / social-experiences app, never a dating app.
- Includes emoji unless the founder explicitly approves (default: none).

Copy always:
- Names the action with the verb that matches it ("Publish event", "Refund order", "Scan ticket").
- Uses contractions ("you're", "it'll").
- Tells the user what just happened ("Refund sent. Stripe will settle in 3–5 days.").
- Names money in the buyer's currency ("£12.50", "$45.00", with `Intl.NumberFormat`).
- States consequences before destructive actions ("Deleting this brand will void 217 unsold tickets and disconnect Stripe. This cannot be undone.").

Sample microcopy:

| Surface | Copy |
|---------|------|
| Default empty state, Events tab | "No events yet. Build the first one — it takes about 4 minutes." |
| Loading toast on publish | "Publishing event…" |
| Success toast on publish | "Live. Share this link: minlga.com/e/lonelymoth" |
| Failure toast on publish | "Couldn't publish. Stripe needs one more thing — tap to fix." |
| Confirm refund | "Refund £45.00 to Sara Olsen?" |
| After refund | "Refunded. Sara will see it on her card in 3–5 days." |
| Empty scan log | "No scans yet. Open the camera to start checking guests in." |
| Account deletion warning | "You're about to delete your account. We'll keep your data for 30 days in case you change your mind. After that, it's gone." |

## 1.14 Consumer ↔ Business divergence map

Most of the consumer language transfers directly. The table below lists every notable divergence.

| Motif | Consumer use | Business use | Divergence type |
|-------|--------------|--------------|-----------------|
| Glass badge (24 blur, 0.42 tint) | Discovery card labels | Status pills (event status, ticket status, scan status) | TRANSFER unchanged |
| Glass chrome (28 blur) | Top bar, bottom nav, session switcher | Top bar, bottom nav, brand switcher | TRANSFER unchanged |
| Glass card base (30 blur) | Profile bento tiles | Dashboard KPI tiles, event overview cards | TRANSFER unchanged |
| Glass card elevated (34 blur) | Hero profile tile | Event hero card, brand hero card | TRANSFER unchanged |
| Floating top bar with show/hide motion | Swipe page chrome | Event detail screens (header collapses on scroll) | TRANSFER unchanged |
| Bottom nav capsule (radius 36) | 5 tabs | 4 tabs (Home / Events / Chat / Account) | ADAPT — fewer tabs, wider per-tab footprint, same capsule |
| Pill switcher (session selector) | Solo / Collab sessions | Brand switcher | ADAPT — same chrome, same scroll-edges, different content |
| Active orange spotlight | Selected pill, primary CTA | Selected pill, primary CTA, "live event" indicator | TRANSFER unchanged |
| Swipe deck cards (radius 40) | Curated date deck | Public event page hero (mobile) | ADAPT — same radius and shadow, different content shape |
| Card stack with horizontal pan | Discovery deck | Multi-date event date selector (mobile) | ADAPT — same physics, smaller stack |
| Coach mark / tooltip glass | Onboarding nudges | Permission/Stripe tooltips | TRANSFER unchanged |
| Profile glass refresh patterns | Profile screen | Account screen | TRANSFER unchanged |
| (Not in consumer) Data table | — | Orders, payouts, refunds, finance export, audit log | NEW — Section 3.4 defines it |
| (Not in consumer) Wizard / stepper | — | Event creator (7 steps), onboarding | NEW — Section 3.5 defines it |
| (Not in consumer) Sidebar nav (web) | — | Web desktop layout | NEW — Section 2 defines it |
| (Not in consumer) Camera scanner reticle | — | Scanner mode | NEW — Section 3.6 defines it |
| (Not in consumer) Cash entry pad | — | In-person scanner payment | NEW — Section 3.7 defines it |
| (Not in consumer) Stripe Payment Element wrapper | — | Checkout, Connect onboarding | NEW — Section 3.8 defines it |
| (Not in consumer) NFC tap indicator | — | In-person tap-to-pay | NEW — Section 3.9 defines it |
| (Not in consumer) QR ticket display | — | Attendee ticket | NEW — Section 3.10 defines it |
| (Not in consumer) Audit log row | — | Permission audit | NEW — Section 3.11 defines it |
| (Not in consumer) Permission matrix | — | Brand team management | NEW — Section 3.12 defines it |
| Pairing context, deck/recommendations engine, board lifecycle | Heavy use | **FORBIDDEN** | DO NOT TRANSFER — these are dating-domain (per memory) |

---

# Section 2 — Responsive Foundations

## 2.1 Breakpoints

| Token | px range | Form factor | Container max | Outer gutter | Columns |
|-------|----------|-------------|---------------|--------------|---------|
| `xs` | 320–375 | Small mobile / scanner phones | 100% | 16 | 4 |
| `sm` | 376–480 | Mobile baseline (most phones) | 100% | 20 | 4 |
| `md` | 481–768 | Large mobile / portrait tablet | 720 | 32 | 8 |
| `lg` | 769–1024 | Landscape tablet / small desktop | 960 | 40 | 12 |
| `xl` | 1025–1440 | Desktop | 1200 | 64 | 12 |
| `xxl` | 1441+ | Wide desktop | 1320 | 96 | 12 |

Type scale shifts: at `lg+`, hero / display sizes increase 4 px (display 32 → 36, h1 26 → 30) and line heights scale proportionally.

## 2.2 Layout primitives across breakpoints

### 2.2.1 Bottom navigation behavior

| Breakpoint | Behavior |
|------------|----------|
| `xs`–`md` | Floating glass bottom nav capsule, 4 tabs (Home / Events / Chat / Account), 72 px tall (Android 69), centred above safe-area inset, max width 420 px, sides clamp to viewport edges with 8 px margin on small screens |
| `lg` | Bottom nav persists as floating capsule but slimmer (60 px) and content above gains side margins |
| `xl`–`xxl` | Bottom nav **migrates to left sidebar**: 256 px wide, glass chrome (blur 28, tint floor `glass.tint.chrome.idle`), full-height. Tabs become vertical rows with 22 px icon + 14 px label, 56 px row height. Active state uses the same orange spotlight with horizontal pill shape |

### 2.2.2 Header / chrome behavior

| Breakpoint | Behavior |
|------------|----------|
| `xs`–`md` | Floating top bar, full width minus 16–20 px gutter, height 56 px + safe-area top, scroll-reactive shadow |
| `lg` | Top bar height grows to 64 px; brand switcher and notifications icon-button gain text labels |
| `xl`–`xxl` | Top bar collapses into the left sidebar header (account avatar + brand switcher) and a thin contextual sticky header above content (page title + page-level actions) |

### 2.2.3 Content layout

| Breakpoint | Default layout |
|------------|---------------|
| `xs`–`sm` | Single column, 16–20 px gutters, full-bleed cards |
| `md` | Single column max 720 px, centred |
| `lg` | Two-column with 24 px gap (main + side rail for context — used on Event detail, Brand profile) |
| `xl`–`xxl` | Three-region layout: left sidebar (256 px) + main content (flex) + optional right inspector (320 px, used on Event detail for selected order/guest) |

### 2.2.4 Modals and sheets

| Breakpoint | Behavior |
|------------|----------|
| `xs`–`md` | Bottom sheet from bottom edge, drag-to-dismiss, max 92% viewport height, snaps at 50% / full |
| `lg` | Centred modal, 480 px wide, max 80% viewport height, scrim fades to 0.5 |
| `xl`–`xxl` | Centred modal, 560 px wide; large modals (event preview, ticket type editor) gain 720 px width |

### 2.2.5 Tables vs cards

| Breakpoint | Pattern |
|------------|---------|
| `xs`–`md` | Lists of cards. Each row is a glass-chrome card with the most important fields visible and a tap → detail sheet for full info |
| `lg`–`xxl` | Data tables with columns. Glass background, hairline row dividers, hover row gains `rgba(255, 255, 255, 0.04)` background, click row opens right inspector |

## 2.3 Form-factor parity rules

The following must be identical across mobile and web (capability and outcome, not pixel-identical):
- Every action that mutates data is reachable via UI on both platforms.
- Every public page renders correctly on both.
- Every confirmation, error, and success state appears on both.
- Every role-based access decision yields the same result.
- Every keyboard shortcut on web has a touch equivalent (button or menu) on mobile.

The following may legitimately differ:
- Density: tables on web vs cards on mobile.
- Modal vs sheet container.
- Wizard step layout: mobile = step-per-screen + back button; desktop = single-page form with sticky preview pane on the right.
- Camera scanning: mobile-only (web uses manual-lookup fallback).
- NFC tap-to-pay: mobile-only (web shows feature-unavailable copy).

## 2.4 Density modes

- **Comfortable** — default. Spacing scales above. Touch targets 44 × 44 minimum.
- **Compact** — opt-in on web, used in dense data screens (orders table at `lg+`). Row height drops from 56 px to 44 px; type drops one rank (body 16 → 14); padding halves. Toggled via a density switch in table header.

## 2.5 Touch & cursor targets

- **Mobile minimum touch target:** 44 × 44 pt (Apple HIG; Android 48 dp).
- **Web minimum cursor target:** 32 × 32 px with hover affordance (background tint + cursor: pointer).
- **Cursor styles:** `pointer` for buttons/links; `text` for inputs; `not-allowed` for disabled; `grab` / `grabbing` for drag handles; `crosshair` for map picker.
- **Focus ring on web:** 2 px solid `accent.warm` + 2 px transparent offset, never ring-removed without keyboard alternative.

---

# Section 3 — Component Library

> Each component is specified with: **Anatomy** (parts) → **Variants** → **Sizes** → **States** → **Mobile / Web divergence** → **Glass treatment** → **Microinteraction** → **Accessibility** → **Edge cases**. Where a component already exists in the consumer app and transfers as-is, the consumer source is cited; the designer may reuse the visual treatment without redesign.
>
> Components are grouped: 3.1 Foundation inputs · 3.2 Specialised inputs · 3.3 Filters / pagination / tabs · 3.4 Tables and lists · 3.5 Wizards and steppers · 3.6 Chrome and navigation · 3.7 Sheets / modals / overlays · 3.8 Feedback and status · 3.9 Identity (avatars, badges, brand) · 3.10 Data viz primitives · 3.11 Specialised business components.

## 3.1 Foundation inputs

### 3.1.1 Button

**Anatomy:** [optional leading icon] [label] [optional trailing icon]. Single rounded container.

**Variants:**
- **Primary** — solid orange (`primary.500`) with `text.inverse`. Hover/press shifts to `primary.600` / `primary.700`.
- **Secondary** — glass chrome (blur 28, tint floor `glass.tint.chrome.idle`, border `glass.border.chrome`, label `text.inverse`).
- **Tertiary / Ghost** — transparent fill, label `accent.warm`, no border. Hover (web) gains `rgba(255,255,255,0.06)` background.
- **Destructive** — solid `semantic.error` with `text.inverse`. Confirms before firing.
- **Link** — text only, no padding, label `accent.warm`, underline on hover (web).
- **Loading** — spinner replaces leading icon; label remains.

**Sizes (height × paddingH × text):**
- `sm` — 36 × 16 × button-md
- `md` — 44 × 20 × button-md (default)
- `lg` — 52 × 24 × button-lg

**Radius:** `md` for square buttons (default), `full` for pill buttons (CTAs in heroes).

**States:** default · hover (web only, +6% bg lightness or +0.06 alpha) · pressed (`scale 0.96`, `duration.fast`, `ease.press`) · focused (web: 2 px `accent.warm` ring + 2 px transparent offset) · loading (spinner, label dimmed) · disabled (opacity 0.32, no interaction) · error (red ring 2 px, shake 200 ms `ease.inout`).

**Mobile / Web:** mobile uses haptic light tap on press. Web uses hover state and focus ring. Web supports `Enter` and `Space` keypress.

**Microinteraction:** scale 0.96 on press, 120 ms `ease.press`. Loading state crossfades icon → spinner over 160 ms.

**Accessibility:** role `button`, accessible name from label. If icon-only, `aria-label` required. Disabled state announces "disabled."

**Edge cases:** very long label truncates with ellipsis at button edge (mobile) or wraps to 2 lines max (web). Trailing icon never truncates.

### 3.1.2 Icon Button

**Anatomy:** glass chrome circular container + icon (22 px default).

**Variants:** chrome (default), filled (orange spotlight), ghost (transparent), tonal (`rgba(255,255,255,0.08)`).

**Sizes:** 36 / 40 / 44 (default) / 52.

**States:** identical to Button. **Active variant** uses `accent.warm.tint` fill, `accent.warm.border` border, `shadow.glass.chrome.active` glow.

**Glass treatment:** L1–L5 stack from §1.7.3 applied at 44 × 44 with radius `full`. Inherits from consumer `GlassIconButton.tsx`.

**Microinteraction:** scale 0.96 on press, 120 ms. Active state morphs tint/border over 200 ms.

**Accessibility:** `aria-label` mandatory. Touch target 44 × 44 minimum. If badge present, badge count is included in label ("Notifications, 3 unread").

**Edge cases:** badge overflow (`99+`) at counts > 99. Icon swap on active state must crossfade, not pop.

### 3.1.3 Link

Inline text element. Label `accent.warm`, no underline by default; underline on hover (web). Visited state uses `accent.warm` darkened 8%. External links carry a 12 px arrow-up-right trailing glyph at 60% opacity.

### 3.1.4 Input (text / number / phone / email)

**Anatomy:** [floating label] [container with leading icon · field · trailing icon · clear button] [helper or error].

**Container:** background `rgba(255, 255, 255, 0.04)` on dark, `#ffffff` on light. Border `rgba(255, 255, 255, 0.12)` on dark, `gray.200` on light. Radius `sm`. Height 48. PaddingH 14.

**States:**
- Default
- Focused — border `accent.warm`, 1.5 px, label tightens to 12 px and rises (Material-style float)
- Filled (with valid value) — border stays default, label remains floated
- Error — border `semantic.error`, helper text `semantic.error`, leading icon (alert) appears
- Success — brief 1.2 s `semantic.success` border pulse on async-validated fields
- Disabled — opacity 0.32

**Variants:**
- text, number (numeric keyboard, tabular-nums display), phone (intl format with country flag prefix), email (inline format check), password (mask + reveal trailing icon), search (leading magnifier icon, clear-button on right)

**Mobile:** native keyboard variant per type; phone uses `keyboardType="phone-pad"`. Web: `inputmode` attr.

**Microinteraction:** label float on focus 200 ms `ease.out`. Error state shake 8 px horizontal × 3 cycles, 240 ms total.

**Accessibility:** `<label for="">` association. Error text uses `aria-describedby`. Required fields marked with asterisk in label; not relied upon as sole signal.

**Edge cases:** very long input value scrolls horizontally inside container. Paste with newlines (textarea) preserves; paste in single-line input strips.

### 3.1.5 Textarea

**Anatomy:** Identical to Input but min-height 96, autosizes to content up to max 240, then scrolls.

**States:** identical to Input plus character counter (bottom-right, body-sm, color shifts to `semantic.warning` at 90%, `semantic.error` at 100%).

**Edge cases:** rich-text variant (event description) is a separate component (§3.11.13). Plain textarea must support paragraph breaks (Enter), shift-Enter line breaks.

### 3.1.6 Select

**Anatomy:** Container styled like Input + chevron-down trailing + opens dropdown menu.

**Variants:** single-select (default), with-search (when options > 8), groupable (sectioned).

**States:** default, focused, open, with-value, disabled, error.

**Dropdown menu (mobile):** opens as bottom sheet (snap to 50%), search field at top if applicable, list of options with checkmark on selected.

**Dropdown menu (web):** opens as glass panel below the input, max-height 320, scrollable, keyboard-navigable (Up/Down arrows, Enter to select, Escape to close).

**Microinteraction:** chevron rotates 180° on open, 200 ms `ease.out`. Selected option flashes `accent.warm.tint` for 240 ms.

**Accessibility:** ARIA combobox pattern. Selected option announced.

**Edge cases:** very long option text truncates in input but wraps in dropdown. No-results empty state ("No matches") for search variant.

### 3.1.7 Multi-Select

Like Select but value renders as chips inside the container. Each chip dismissible with × button. "Clear all" button at far right when ≥ 2 chips. Dropdown remains open between selections.

**Sizes:** Container minimum height 48, expands as chips wrap.

**Edge cases:** maximum-N enforced (e.g., max 5 tags) — disables further selection with copy "Maximum 5 reached."

### 3.1.8 Combobox

Combination of Input (typeable) + Select (dropdown). User can type to filter or paste a value not in the list (creates new entry). Used for: tags, custom social platforms, custom event categories.

### 3.1.9 Date Picker

**Variants:** single date, date range, date + time.

**Anatomy:** trigger looks like an Input with calendar leading icon. Tap opens picker.

**Mobile picker:** bottom sheet with native iOS wheel / Android calendar grid. Confirm button at bottom.

**Web picker:** glass panel popover with calendar grid. Today highlighted (`accent.warm` 1 px ring). Selected date filled `accent.warm`. Hover any date in range previews range fill `accent.warm.tint`.

**Edge cases:** disable past dates by default for event-creator usage. Allow opt-in past dates for filters and analytics. Honour the brand's timezone (user can override per event).

### 3.1.10 Time Picker

24-hour internal storage; display per locale (12-hr AM/PM en-US, 24-hr en-GB).

Mobile: native iOS wheel / Android time picker. Web: hour + minute combobox at 5-minute granularity by default; 1-minute granularity available behind a "precise time" toggle.

### 3.1.11 Date + Time Picker

Combined picker. Mobile: two-step sheet (date → time). Web: side-by-side panels.

### 3.1.12 Recurrence Rule Picker

**Anatomy:** Select for frequency (Once / Daily / Weekly / Monthly / Custom RRULE).
- Daily: "Every N day(s)" stepper.
- Weekly: day-of-week chips (S M T W T F S) + "Every N week(s)" stepper.
- Monthly: "On day N" or "On the [first/second/third/fourth/last] [weekday]" radio.
- Custom RRULE: power-user mode with raw RFC 5545 input + live human-readable preview.

**Output:** RFC 5545 RRULE string, plus a generated list of upcoming dates (preview, max 12).

**States:** preview chips below picker showing the next N occurrences.

### 3.1.13 Toggle

**Anatomy:** Track 36 × 22, knob 18 × 18.
- Off: track `rgba(255, 255, 255, 0.16)`, knob `#ffffff`.
- On: track `accent.warm`, knob `#ffffff`.
- Disabled: opacity 0.32.

**Microinteraction:** knob slides 14 px in 200 ms `ease.out`. Haptic light tap on toggle.

**Accessibility:** role `switch`, `aria-checked`. Label always paired (left of toggle on web; toggle right of label on mobile, full-row tappable).

### 3.1.14 Checkbox

20 × 20, radius 4. Off: 1 px `rgba(255, 255, 255, 0.32)` border. On: filled `accent.warm` with white check. Indeterminate: filled with white horizontal bar.

### 3.1.15 Radio Group

20 × 20 circle. Off: 1.5 px `rgba(255, 255, 255, 0.32)` border. On: 6 px filled inner circle in `accent.warm`. Vertical stacking with 12 px between rows; horizontal acceptable for ≤ 3 short options.

### 3.1.16 Slider

Track 4 px tall, full-width by default. Filled portion `accent.warm`, unfilled `rgba(255, 255, 255, 0.16)`. Thumb 22 × 22 white circle, glass shadow `shadow.glass.chrome`.

**Variants:** single value, range (two thumbs). Step support, label-on-thumb during drag, value badge below thumb at rest if `showValue` enabled.

## 3.2 Specialised inputs

### 3.2.1 File Upload

**Trigger:** dashed-border container or button.
- Container variant: 320 × 180 dashed border `rgba(255, 255, 255, 0.18)`, radius `lg`, drop-here icon center, label "Drop file or browse." Hover (web) brightens border to `accent.warm`. Drop event highlights with `accent.warm.tint` fill.
- Button variant: glass secondary button "Upload file" with paperclip icon.

**On select:** validates type and size. Errors shown inline. Successful upload shows progress bar, then renders file row (icon + name + size + remove ×).

### 3.2.2 Image Upload (single)

**Anatomy:** square or 16:9 container at requested aspect; default empty shows camera + photos icon and label "Add photo." Tapped → action sheet [Camera, Photo Library, Remove (if exists)].

**On select:** crop UI (mobile sheet or web modal) with aspect lock per use-site. Confirm → upload progress overlay. Final renders the cropped image inside the container. Hover/long-press shows "Replace" and "Remove" overlay buttons.

**Edge cases:** EXIF rotation respected. HEIC converted to JPEG on iOS via the upload service. Upload failure preserves selection and shows retry.

### 3.2.3 Image Upload (gallery, max N)

Like single but renders a grid of thumbnails with [+] tile to add more. Reorder by drag (web) or hold-and-drag (mobile). Max enforced at component level.

### 3.2.4 Video Upload

Similar to Image Upload, but selects video. Validates max duration (12 s for event covers), shows compression progress, extracts poster frame for preview.

### 3.2.5 GIF Picker

Modal/sheet with curated GIF library (36 GIFs, §1.10.3). Search bar at top filters by tag. Tapping a GIF previews full size at center, with "Use this GIF" CTA.

### 3.2.6 Color Picker

**Anatomy:** preset palette (12 swatches in 3 rows × 4 cols, accent + brand colors) + "Custom" tile that opens HSL picker.

**Custom mode:** Hue slider, Saturation/Lightness 2D pad, Hex input, RGB input, A11y warning if color contrast against expected background drops below WCAG AA.

### 3.2.7 Font Picker

Limited set (5 system fonts: Inter Display, Söhne, Playfair Display, JetBrains Mono, Inter). Each preview renders the name in its own face. Selected gets `accent.warm` ring.

### 3.2.8 Currency Input

Combobox-style: currency code prefix (3-letter ISO with flag), then numeric input. Currency persisted at brand-level; per-event override available.

Display always uses `Intl.NumberFormat` for consistency. Decimals controlled by currency (most 2; JPY 0).

### 3.2.9 Tag Input

Multi-select Combobox, but every value is a free-form string. Pressing comma or Enter creates a tag. Tags removable via × button. Used for: customer tags, search tags on event creator.

### 3.2.10 Search Input

Leading magnifier icon + text input + clearing × on right. Optional "Search…" label. Submit on Enter (web) or "Search" keyboard return (mobile).

**Variants:** inline (in headers), prominent (centered hero on Discover-like screens), filterable (with `Filters` button trailing).

## 3.3 Filters, pagination, tabs

### 3.3.1 Filter Chip

Pill-shaped, radius `full`, height 32, paddingH 12, label `body-sm`. Inactive: glass chrome. Active: `accent.warm.tint` background, `accent.warm.border`, label `text.inverse`. Removable variant has × on right; static variant does not.

### 3.3.2 Sort Control

Dropdown with current sort field; arrow toggles ascending/descending. Label format: "Sorted by Date · Newest first." Tap reveals options + direction toggle.

### 3.3.3 Pagination

**Mobile:** infinite scroll with bottom sentinel. Loading row shows three skeleton lines.

**Web:** numbered pagination with `‹ 1 2 3 … 12 ›`. Items-per-page selector (10 / 25 / 50). Pagination state preserved in URL query.

### 3.3.4 Tabs

**Anatomy:** horizontal row of tab triggers, each with label (and optional count badge). Active tab has 2 px `accent.warm` underline + label `text.inverse` weight 600. Inactive `rgba(255, 255, 255, 0.6)` weight 500.

**Mobile:** scrollable horizontally if overflow. Active tab auto-centers on tab change (240 ms).

**Web:** wrap or scroll based on width. Keyboard arrow Left/Right to switch.

**Microinteraction:** underline slides between tabs over 240 ms `ease.inout` (shared layout id technique).

### 3.3.5 Segmented Control

Two-to-four equal segments inside a glass chrome capsule. Active segment overlay: `accent.warm.tint` fill that animates between segments via spring `spring.bottom-nav`. Used for short toggles (e.g., "Online / In-Person", "Upcoming / Past").

## 3.4 Tables and lists

### 3.4.1 Data Table (web; collapses to list on mobile)

**Anatomy:** column headers (sticky on scroll) + rows + footer (pagination + summary count + density toggle + export button).

**Header:** `body-sm` weight 600, `rgba(255, 255, 255, 0.7)`. Sortable columns show chevron on hover and current sort. Row height 56 (comfortable) / 44 (compact).

**Row:** glass card row with hairline divider `rgba(255, 255, 255, 0.06)` between rows. Hover (web) `rgba(255, 255, 255, 0.04)` fill. Selected (multi-select) checked checkbox left + `accent.warm.tint` row fill.

**Cell types:** text, number (tabular-nums right-aligned), money (mono, right-aligned), date (display per locale), status pill, chips, avatar, action menu (overflow ⋯).

**Empty state:** centered illustration + headline + CTA. Never an empty grid.

**Loading state:** 8 skeleton rows by default.

**Error state:** retry button + "Couldn't load — tap to try again."

**Bulk actions:** when ≥ 1 row selected, sticky `Bulk Action Bar` slides down from below table header with "{n} selected · [Refund] [Cancel] [Export] [Clear]".

### 3.4.2 List Row (mobile equivalent of a Data Table row)

A glass card per row with: leading visual (avatar / icon / cover) + primary text + secondary text + trailing meta (status pill / chevron / amount). Tapped → opens detail (right inspector on web at `xl+`, full-screen on mobile).

### 3.4.3 Order Row

List Row variant with: avatar of buyer (initial fallback) + "Sara Olsen" + "Got 2 × General Admission · £50.00" secondary line + status pill (Paid / Pending / Refunded / Failed) trailing.

### 3.4.4 Guest Row

List Row variant with: avatar + name + ticket type + check-in status (Pending / Approved / Checked-in) trailing. Swipe-action on mobile (swipe right → check in; swipe left → reject).

### 3.4.5 Audit Log Row

Compact List Row: timestamp · actor (avatar + name) · action (verb + target). Expandable to show before/after diff. Mono for IDs.

### 3.4.6 Row Action Menu

Overflow ⋯ icon button opens menu with 3–6 actions. Destructive actions ("Delete", "Refund all") at bottom in `semantic.error`. Keyboard navigable.

### 3.4.7 Bulk Action Bar

Sticky bar at top of table when selection > 0. "{n} selected" count + actions + "Clear selection" right. Background `glass.tint.chrome.idle` with stronger shadow.

## 3.5 Wizards and steppers

### 3.5.1 Wizard Indicator

**Anatomy:** horizontal row of N step dots (mobile) or N labelled steps (web).

- Mobile: dots 8 × 8, current `accent.warm`, completed `text.inverse`, future `rgba(255, 255, 255, 0.32)`. Optional "Step 3 of 7" caption above.
- Web: numbered circles + label, with hairline connector between. Completed: filled circle with check icon. Current: ring `accent.warm`, number bold. Future: faded.

**Interaction:** completed steps are clickable to revisit; current and future steps are not unless skipping is explicitly allowed. Animation: connector fills `accent.warm` left-to-right over 280 ms when a step is completed.

### 3.5.2 Stepper (numeric quantity)

`[−] N [+]` triple. Container 120 × 44, glass chrome. Buttons 36 × 36. Numeric field readonly center, tabular-nums. Used for ticket quantity selection.

### 3.5.3 Onboarding Step Card

A full-bleed card with: visual (illustration or screenshot) + headline + body + action footer (back / next / skip). Header has step indicator. Mobile step transitions slide horizontally (320 ms); web cross-fades.

## 3.6 Chrome and navigation

### 3.6.1 Top App Bar / Floating Header

Inherits consumer `GlassTopBar`. Layers: backdrop (full blur, 22 intensity, fade 20 px) + row 56–64 px tall with [back/menu icon] · [page title or brand switcher] · [trailing actions].

**Variants:**
- Default — page title centered (mobile) or left-aligned (web).
- Brand-switcher — replaces title with brand chip (avatar + name + chevron).
- Contextual detail — back button + truncated entity name + actions.

**Scroll behavior:** initial transparent backdrop; at scroll-y > 8 px, backdrop fades to 100% blur and `shadow.glass.chrome` appears (200 ms `ease.out`).

### 3.6.2 Bottom Tab Bar (mobile + lg)

Glass chrome capsule, height 72 (Android 69), max width 420, radius 36 (full). Four tabs: Home · Events · Chat · Account. Each tab: 22 px icon over 10 px label (weight 500). Active tab: spotlight overlay `accent.warm.tint` + `accent.warm.border` + glow `shadow.glass.chrome.active`, label weight 600.

**Spotlight motion:** spring `spring.bottom-nav` slides between tabs.

**Per-tab badge:** unread count, top-right offset −2/−2, bg `accent.warm`, white text.

### 3.6.3 Sidebar (web `xl+`)

256 px wide, full-height, glass chrome. Layout top-to-bottom:
1. Brand switcher chip (clickable, opens brand-switcher menu)
2. Primary nav rows (Home, Events, Chat, Account)
3. Spacer
4. Account row (avatar + name) bottom

**Active row:** horizontal pill `accent.warm.tint` fill + `accent.warm.border` + 2 px `accent.warm` left bar.

**Hover row (web):** `rgba(255, 255, 255, 0.04)` fill.

**Collapsed mode:** at viewport width < 1280, sidebar collapses to 64 px (icon-only); user can pin-expand via toggle at bottom.

### 3.6.4 Drawer (mobile, hamburger-driven menus on small screens that need depth)

Side sheet from left, 80% viewport width, glass chrome. Used sparingly — primary nav is bottom tabs.

### 3.6.5 Floating Action Button (FAB)

56 × 56, radius `full`, primary fill `accent.warm`, icon white, glass shadow `shadow.glass.chrome.active`. Bottom-right of viewport, 24 px from edges, above bottom tabs (mobile) or bottom-right of main content (web).

**Used on:** Events tab (create event), Brand team (invite), Orders tab (create door sale).

**States:** default · pressed (`scale 0.92`, 120 ms) · disabled · expanded (long-press reveals 2–4 sub-actions stacked above main FAB, each labelled).

### 3.6.6 Brand Switcher

**Mobile sheet:** opens from top-bar tap. Lists all brands user has access to (avatar + name + role + last-active timestamp). Active brand has `accent.warm.tint` row fill. "+ Create new brand" row at bottom.

**Web dropdown:** opens below brand chip in top bar / sidebar header. Same content, panel format.

### 3.6.7 Account Switcher

Used only when a user is signed into multiple accounts (rare; design for completeness). Same pattern as Brand Switcher but lists accounts.

### 3.6.8 Floating Pill (general-purpose)

Glass chrome pill (height 36, radius `full`, paddingH 12). Used as: filter pill, status pill (with no surrounding context), share-link pill on public page. Inherits §3.3.1 visual.

### 3.6.9 Glass Card (consumer GlassCard)

Inherits consumer `GlassCard.tsx`. Variants base (radius 20, blur 30) + elevated (radius 24, blur 34). Used as the wrapper for KPI tiles, dashboard modules, brand profile cards.

### 3.6.10 Glass Shelf

A horizontal floating tray that holds 2–4 actions. Used at bottom of detail screens for primary actions (e.g., "Publish event" + "Save draft" on event creator). Glass chrome, full width minus 16 px gutter, sticky bottom (above bottom tabs). 64 px tall.

### 3.6.11 Sticky Section Header

Within scroll views, a subtle section divider that sticks to top during scroll. Background `rgba(12, 14, 18, 0.92)`, label `body-sm` weight 600 in `rgba(255, 255, 255, 0.7)`. 36 px tall.

## 3.7 Sheets, modals, overlays

### 3.7.1 Bottom Sheet (mobile)

Snap points: peek (160 px), half (50%), full (92%). Drag handle 36 × 4 at top. Dismiss by drag-down or tap-on-scrim.

**Anatomy:** drag handle + optional title row + content area (scrollable) + optional footer with primary CTA.

**Glass treatment:** the sheet body uses glass card elevated (blur 34); the scrim behind is `rgba(0, 0, 0, 0.5)`.

**Motion:** open 320 ms `spring.gentle`. Close 240 ms `ease.in`.

### 3.7.2 Modal (web)

Centered, max width per use (see §2.2.4). Glass chrome elevated with `shadow.glass.modal`. Scrim `rgba(0, 0, 0, 0.5)` with backdrop-blur 8 px (light blur on the page underneath).

**Header:** title + close × at top-right.
**Body:** content; scrolls if exceeds max height.
**Footer:** action buttons aligned right (primary on right, cancel on left).

**Dismiss:** scrim click, Escape key, close button. Disable scrim-click on destructive flows.

### 3.7.3 Dialog

Smaller modal, 400 px wide, used for confirmations and quick prompts. Same construction as Modal.

### 3.7.4 Confirm Dialog

Variants:
- **Simple confirm** — title + body + Cancel/Confirm. Used for low-risk actions.
- **Type-to-confirm** — adds an Input requiring exact text match (e.g., type the brand name to delete it). Confirm button disabled until match.
- **Hold-to-confirm** — primary action button must be press-held 1.5 s; progress fills inside the button.

**Use rules:** anything destructive that affects more than the current view uses type-to-confirm minimum. Account deletion uses both type-to-confirm AND hold-to-confirm in sequence.

### 3.7.5 Toast

Sliding glass card from top. Width 320 mobile, 360 web. 56–80 px tall depending on body length. Auto-dismiss after 4 s (success/info), 6 s (warning), or persistent until dismissed (error).

**Anatomy:** [icon] [body text · optional description] [action link · or close ×].

**Variants per semantic:** success (`semantic.success` icon + faint `semantic.success.tint` left bar), warning, error, info.

**Stacking:** multiple toasts stack with 8 px gap; new on top.

### 3.7.6 Banner

Wider than toast, in-page persistent. Used for status notices ("Stripe onboarding incomplete — finish to start selling tickets"). Includes inline action button(s).

**Variants:** info / warning / error / success / neutral. Closable variant has × on right.

### 3.7.7 Alert / Inline Error

Below-input or top-of-form inline message. Body-sm, color from `semantic.error/warning/success`.

### 3.7.8 Empty State

Centered in container. Components: illustration (180 × 180 max) + headline (h3) + body (body-sm secondary) + primary CTA.

**Required for:** every list (orders, guests, brands, events, scans, audit log), every search-no-results, every tab (Marketing locked Post-MVP, Tracking locked Post-MVP, Analytics locked).

### 3.7.9 Error State (full-screen)

Centered icon (alert-triangle, 60 × 60, `semantic.error`) + headline ("Something broke") + body explaining + Retry CTA + "Get help" link to support.

### 3.7.10 Skeleton Loader

Per content shape — list rows, card grids, KPI tiles, image placeholders. Filled with `rgba(255, 255, 255, 0.06)` and animated by §1.10.1 shimmer rule.

### 3.7.11 Spinner

24 / 36 / 48 sizes. Stroke 3 px, color `accent.warm`. Indeterminate rotation 1000 ms linear infinite.

### 3.7.12 Progress Bar

Track 4 px tall, full-width by default. Fill `accent.warm`. Determinate variant shows percentage label above. Indeterminate sweeps a 30%-width pill across the track in 1400 ms `ease.inout` infinite.

## 3.8 Feedback and status

### 3.8.1 Status Pill

Height 24, radius `full`, paddingH 10. Body-sm weight 500. Background and text color per status; uses tint variant of semantic colors (`success.tint` background + `success` text). Variants required for:

- **Event statuses:** Draft (gray), Scheduled (info), Live (success + pulse), Ended (gray), Cancelled (error).
- **Ticket statuses:** Valid, Used, Void, Transferred, Refunded.
- **Order statuses:** Pending, Paid, Failed, Refunded, Partial Refund.
- **Stripe statuses:** Onboarding, Action required, Active, Restricted.
- **Scanner statuses:** Online, Offline, Synced.

**"Live" pulse:** 1.5 s breathing animation (opacity 1 → 0.7 → 1) on the green dot prefix.

### 3.8.2 Counter Badge

Circular for ≤ 9, pill for ≥ 10. Min 18 × 18. Text `micro` (11 px) weight 700, white on `accent.warm`. "99+" cap.

### 3.8.3 Coach Mark / Tooltip

**Coach mark (mobile, onboarding nudges):** glass card pointing to a UI element with a tail. Body explains the feature; "Got it" button dismisses. Maximum 3 per onboarding session.

**Tooltip (web hover):** glass card popup on hover/focus, 200 ms delay, 160 ms fade. Max width 280 px. Arrow indicator to the trigger.

### 3.8.4 KPI Tile

Glass card base. Layout: caption (12 px label-cap uppercased) + stat-value number (26 px weight 700) + optional sparkline (50 px tall) + optional trend caption ("+12% vs last week" with up/down arrow in semantic color).

### 3.8.5 Metric Card (larger)

Glass card elevated. Holds chart + multiple stats + filters. Used on Event Overview and Brand Dashboard.

## 3.9 Identity components

### 3.9.1 Avatar

Sizes: 24 / 32 / 40 / 48 / 64 / 96. Radius `full`. Image background or initial-monogram fallback (1–2 letters; background based on hash of name → consistent color from a 12-color palette). Border 2 px transparent by default; 2 px `accent.warm` for "online" or "active" indicator with a small status dot.

### 3.9.2 Avatar Stack

Up to 5 avatars overlapped with 4 px stacking (left avatar on top). After 5, "+N" pill in `rgba(255, 255, 255, 0.08)` background.

### 3.9.3 Brand Chip

Avatar + name + (optional) role badge. Used in headers, switchers, and team rows. Sizes md (default, 40 avatar) / lg (64 avatar).

### 3.9.4 Tier / Verified Badge

12 × 12 icon next to brand name when verified ("Mingla Curated"). Small futuristic glyph (custom — designer specifies).

## 3.10 Data viz primitives

### 3.10.1 Sparkline

Inline mini-line chart inside a KPI tile. 50 × 24. Stroke 1.5 px `accent.warm`. Last point is a 3 px dot.

### 3.10.2 Bar Chart Mini

For per-day ticket sales over 7 days: 7 bars, height by value, max 80 px. Bars `accent.warm` at full saturation for highest, fading to `rgba(235, 120, 37, 0.4)` for lowest. Hover/tap reveals exact value tooltip.

### 3.10.3 Donut Mini

For ticket-type breakdown. 80 × 80. Stroke 8 px. Up to 5 segments, each in a discrete palette (orange, plum, teal, lavender, mustard).

### 3.10.4 Trend caption

`+/−N%` with up/down arrow in `semantic.success/error`, body-sm.

### 3.10.5 Capacity Bar

Horizontal track, full-width, 8 px tall. Filled `accent.warm` to N/total ratio. Label below: "138 / 200 sold." When ≥ 80% capacity, fill becomes `semantic.warning`. When 100%, fill becomes `semantic.success` and label changes to "Sold out."

## 3.11 Specialised business components

### 3.11.1 Stripe Payment Element wrapper

The Stripe Payment Element renders Stripe-controlled UI. Wrap with: glass card base container, max-width 480, padding 24, top label "Payment details," and our submit button (Primary, label "Pay [amount]"). Stripe element fills the card body.

**States:** default · processing (button → spinner) · success (button → checkmark animation 800 ms then route forward) · failed (error toast + retry).

### 3.11.2 Apple Pay / Google Pay button

Native button styles per Apple/Google guidelines. Always shown above the Stripe Payment Element when available. 48 px tall, radius `md`.

### 3.11.3 Card Reader Status Indicator

Compact glass card showing reader name + connection state (Disconnected / Connecting / Connected / Error). Connected state shows green dot. Tap → opens reader-management sheet.

### 3.11.4 NFC Tap Indicator

Full-screen overlay during NFC tap. Animation: concentric pulse rings emanating from center (1.5 s loop), reader-tap glyph at center, label "Hold customer's card or phone to back of device." Cancel button at top-left.

**State on tap:** rings collapse to center, success checkmark plays, route forward.

### 3.11.5 Cash Entry Pad

Numeric keypad 3 × 4 (1–9, 0, .) optimised for cash entry. Display shows current amount in large stat-value. "Tendered" label above. Buttons "Exact" (auto-fill total), "Quick: £20", "Quick: £50" for common notes. Confirm button bottom calculates change.

### 3.11.6 QR Code Display (attendee ticket)

Card shape 320 × 480. Top: event title, date, ticket type. Center: QR code (240 × 240, white background, 16 px padding around). Bottom: attendee name, order ID (mono), Apple/Google Wallet add buttons.

**Hint copy:** "Show this at the door." Brightness boost: ticket-display screen automatically maxes screen brightness for 30 s on open (mobile only).

### 3.11.7 QR Scanner Frame

Full-screen camera preview. Reticle frame 280 × 280 centered with corner brackets (16 × 16 each, 4 px stroke `accent.warm`). Cutout darkens outside the reticle (`rgba(0, 0, 0, 0.5)` mask). Top sheet shows event being scanned (collapsible). Bottom action area shows last-scanned-result indicator (success/duplicate/fail) and "Manual lookup" button.

**Result animation on scan:**
- Success: reticle pulses green, large checkmark appears, ticket info card slides up from bottom for 1.4 s before auto-clearing.
- Duplicate: reticle pulses warning yellow, "Already used at [time]" copy.
- Failed: reticle pulses red, "Not a valid ticket — try manual lookup" copy.

### 3.11.8 Camera Preview

Generic component used in scanner and avatar capture. Aspect-fill canvas. On Android may need permission prompt; on iOS uses `expo-camera`. On web uses `getUserMedia` (web supports manual lookup as fallback if camera denied).

### 3.11.9 Map Picker

For event location step. Mobile: native map (Apple/Google) with pin draggable to set location. Web: Google Maps embedded with pin. Search bar above maps geocoded query → drops pin → confirm button below.

**Output:** lat/lng + address text.

### 3.11.10 Location Pin (display)

For public event page and event overview. Static map thumbnail with pin. Click/tap → opens directions in native maps app (mobile) or Google Maps tab (web).

### 3.11.11 Rich Text Editor (event description)

Tiptap-style editor wrapping a content-editable area. Toolbar (sticky on top of editor) has: B / I / link / bullet list / numbered list / heading dropdown. Max length 2000 chars with counter. Mentions (@) and hashtags (#) NOT supported in MVP.

**Mobile:** toolbar floats above keyboard.

**Web:** toolbar always visible at top of editor.

### 3.11.12 Event Theme Preview Tile

A live mini-preview of the event's public page, rendered inside the event creator at Step 5 (theme). Shows the chosen color preset and font applied to a sample title/body.

### 3.11.13 Ticket Type Card (in list)

A glass card row showing: ticket name (h3) · price (stat-value smaller) · quantity sold/total (capacity bar) · status pills (Hidden / Disabled / Approval-required / Password-protected). Trailing overflow ⋯ menu with edit/duplicate/archive.

Drag handle on left for reorder (mobile: long-press; web: drag).

### 3.11.14 Permission Matrix (cells)

A grid where rows are roles and columns are capability groups. Each cell is either a checkbox (binary) or a select (read/write/none). Used on Brand Team → role config screen.

### 3.11.15 Reconciliation Report Row

Shows method (card / NFC / cash / manual) + total tendered + total tickets issued + variance. Variance non-zero highlights `semantic.warning`.

### 3.11.16 Chat Cards (M20 placeholder)

In-chat UI cards for Date / Ticket / Visibility / Payment / Marketing per PRD §U.7. Each card is a glass card with title, body explanation, and 2–4 option buttons. Designer specifies the empty/locked state for MVP and the active design for M20.

### 3.11.17 Audit Log Filter Bar

Compact filter bar above the audit log table: Date range picker + Actor select + Action select + Brand/Event select + Search input + Clear button.

### 3.11.18 Onboarding Footer

Sticky bottom shelf with Back (left) and Next/Skip (right) on each onboarding screen. Skip is `Tertiary` variant, Next is `Primary`.

### 3.11.19 Share Modal

Modal/sheet with: canonical URL display + Copy button + native share intent button + per-platform share buttons (X, Instagram, WhatsApp, iMessage, Email). On copy, button morphs to "Copied!" for 1.4 s.

### 3.11.20 Support Footer

Sticky bottom-of-page utility with: "Help" link + "Status" (latest service status indicator) + locale/currency switcher.

---

# Section 4 — Information Architecture

## 4.1 Sitemap (full route tree)

```
Mingla Business
│
├─ /  (auth gate)
│   ├─ unauthenticated → /welcome
│   └─ authenticated   → /(tabs)/home
│
├─ /welcome                              [public] BusinessWelcomeScreen — Google + Apple sign-in
│
├─ /onboarding/                          [authenticated, first-run only]
│   ├─ /step-1                           welcome to Business
│   ├─ /step-2                           confirm display name + phone
│   ├─ /step-3                           create first brand or skip
│   └─ /step-4                           event-type taxonomy (optional)
│
├─ /(tabs)/                              [authenticated]
│   ├─ /home                             dashboard for current brand
│   ├─ /events                           event list for current brand
│   ├─ /chat                             [M0–M19: locked-state placeholder] [M20+: chat agent]
│   └─ /account                          account home
│
├─ /account/
│   ├─ /profile                          edit profile
│   ├─ /settings                         notifications, locale, timezone, marketing opt-in
│   └─ /delete                           4-step deletion flow
│       ├─ /delete/consequences
│       ├─ /delete/stripe-detach
│       ├─ /delete/confirm               type-to-confirm + hold-to-confirm
│       └─ /delete/scheduled             post-action confirmation
│
├─ /brand/
│   ├─ /create                           create new brand
│   ├─ /switcher                         [overlay] brand switcher (modal sheet on mobile)
│   ├─ /:brandId/                        brand context
│   │   ├─ /                             brand profile (founder view)
│   │   ├─ /preview                      brand profile (public preview)
│   │   ├─ /edit                         brand profile edit
│   │   ├─ /settings                     brand settings
│   │   ├─ /payments                     brand payments dashboard
│   │   │   ├─ /onboard                  Stripe Connect onboarding
│   │   │   ├─ /onboard/return           post-onboarding redirect
│   │   │   ├─ /payouts                  payout history
│   │   │   ├─ /refunds                  refund history
│   │   │   └─ /export                   finance export
│   │   ├─ /team                         team list
│   │   │   ├─ /invite                   invite teammate
│   │   │   ├─ /:memberId                member detail
│   │   │   ├─ /:memberId/role           change role
│   │   │   └─ /:memberId/remove         remove confirm
│   │   └─ /audit                        permission audit log [owner only]
│
├─ /event/
│   ├─ /create                           7-step creator (mobile) / single-page form (desktop)
│   ├─ /:eventId/
│   │   ├─ /                             event overview dashboard
│   │   ├─ /edit                         edit event (re-uses creator)
│   │   ├─ /preview                      live preview
│   │   ├─ /tickets                      ticket types list
│   │   │   ├─ /create                   create ticket type
│   │   │   ├─ /:ticketTypeId            edit ticket type
│   │   │   └─ /:ticketTypeId/preview    buyer-side preview
│   │   ├─ /orders                       orders list (table on web, list on mobile)
│   │   │   ├─ /:orderId                 order detail [right inspector at xl+]
│   │   │   ├─ /:orderId/refund          refund flow
│   │   │   └─ /:orderId/cancel          cancel flow
│   │   ├─ /guests                       guest list
│   │   │   ├─ /pending                  pending approvals queue
│   │   │   ├─ /add                      manual add guest
│   │   │   └─ /:attendeeId              attendee detail
│   │   ├─ /scanners                     scanner management
│   │   │   ├─ /invite                   invite scanner
│   │   │   ├─ /:scannerId               scanner detail
│   │   │   └─ /:scannerId/permissions   scanner perm config
│   │   ├─ /settings                     event settings (visibility, availability)
│   │   ├─ /share                        share modal
│   │   ├─ /reconciliation               end-of-night reconciliation report
│   │   └─ /publish                      publish gate / preview
│
├─ /scanner/                             [scanner-mode]
│   ├─ /                                 scanner-mode landing
│   ├─ /scan                             camera scan view
│   ├─ /lookup                           manual lookup
│   ├─ /sale                             door sale flow
│   │   ├─ /select                       select tickets
│   │   ├─ /payment                      payment method picker
│   │   ├─ /payment/card                 card reader flow
│   │   ├─ /payment/nfc                  NFC tap (mobile only)
│   │   ├─ /payment/cash                 cash entry pad
│   │   ├─ /payment/manual               manual entry
│   │   └─ /receipt                      receipt + ticket QR
│   └─ /activity                         scanner activity log (mine)
│
├─ /checkout/                            [public attendee-facing]
│   ├─ /:eventId                         ticket selection
│   ├─ /:eventId/buyer                   buyer details
│   ├─ /:eventId/payment                 Stripe Payment Element
│   ├─ /:eventId/confirm                 order confirmation + QR ticket
│   └─ /:eventId/wallet                  Apple/Google Wallet add
│
├─ /public/                              [unauthenticated permitted]
│   ├─ /e/:slug                          public event page
│   ├─ /e/:slug/sold-out                 [variant]
│   ├─ /e/:slug/past                     [variant]
│   ├─ /e/:slug/pre-sale                 [variant]
│   ├─ /e/:slug/protected                [password gate]
│   ├─ /e/:slug/apply                    [approval-required apply]
│   ├─ /b/:slug                          public brand page
│   ├─ /o/:slug                          public organiser page
│   └─ /share-redirect                   universal-link landing
│
├─ /invitation/                          [public deep-link]
│   ├─ /:token                           invitation accept (brand member)
│   └─ /scanner/:token                   invitation accept (scanner)
│
├─ /system/                               [global utility]
│   ├─ /offline                           network-down landing
│   ├─ /maintenance                       outage mode
│   ├─ /update-required                   force-update modal
│   ├─ /suspended                         suspended-account landing
│   └─ /404                                not-found
│
└─ /error                                  global error boundary fallback
```

## 4.2 Navigation model

### 4.2.1 Bottom-tab order (locked, all roles)

| Tab | Icon | Label | Route root | Visible to |
|-----|------|-------|-----------|-----------|
| 1 | home | Home | /home | All authenticated roles |
| 2 | calendar-event | Events | /events | account_owner, brand_admin, event_manager, finance_manager (read-only finance) |
| 3 | chat-bubble | Chat | /chat | All authenticated roles (locked-state until M20) |
| 4 | user-circle | Account | /account | All authenticated roles |

Scanner role uses a different navigation: scanner-mode shell (no bottom tabs; full-screen scan view with persistent contextual header).

### 4.2.2 Brand context

The user's "current brand" is a global state. Bottom tabs always render content for the current brand. Brand context is stored in `currentBrandStore` (Zustand persisted) and shown in the top bar (mobile) or sidebar header (web).

Switching brand:
- Cancels in-flight queries scoped to the previous brand.
- Resets scroll positions on event-list, orders, etc.
- Persists to disk so the next launch resumes in the last-active brand.

### 4.2.3 Role-based UI visibility

| Role | Sees |
|------|------|
| account_owner | Everything (Home, Events, Chat, Account, Brand settings, Team, Payments, Audit) |
| brand_admin | Everything except Account-deletion (own only), can manage team |
| event_manager | Home, Events (assigned only), Account; cannot see Payments financial figures (sees totals only), cannot manage team |
| finance_manager | Home (financial KPIs), Events (read), Payments (full), Account |
| marketing_manager (post-MVP) | Home, Events (read), Marketing (full), Account |
| scanner | Scanner-mode only (no tabs) + Account |

A role that lacks access to a feature sees the feature in the menu disabled with a subtle lock icon and a tooltip "Ask your brand admin to enable this." (This makes the upgrade path discoverable.)

### 4.2.4 Deep-link entry points

| Entry | Behavior signed-out | Behavior signed-in |
|-------|---------------------|---------------------|
| Public event page (`/e/:slug`) | Renders public page; CTA is checkout flow | Same; pre-fills buyer details |
| Public brand page (`/b/:slug`) | Renders public page; CTA "Save brand" requires sign-in | Same; CTA active |
| Brand invitation (`/invitation/:token`) | Routes to sign-up; preserves token in deep-link state | Routes to acceptance screen |
| Scanner invitation (`/invitation/scanner/:token`) | Same | Same |
| Reset password (post-MVP) | Routes to reset flow | Routes to reset flow |
| Stripe-onboard return (`/brand/:brandId/payments/onboard/return`) | Routes to sign-in then back | Routes to brand payments with status check |
| Universal share redirect (`/share-redirect?event=:slug`) | Routes to public event page | Same |

## 4.3 URL strategy

### 4.3.1 Public slug strategy

Until founder decision (Q8), the spec assumes the following hybrid:
- Brand creates an event → system generates a 6-character random slug (`/e/lonelymoth`).
- Brand admin can override with a vanity slug (must be unique within brand) up to 32 characters.
- Slugs are lowercase, hyphenated, no special characters.
- Slug history is maintained: old slugs 301-redirect to current after override.

### 4.3.2 Internal route conventions

- `/(tabs)/...` — primary nav-rooted routes (mobile bottom tabs / desktop sidebar).
- `/<entity>/<id>/...` — entity-rooted routes (brand, event).
- `/public/...` — explicit public-page routes.
- `/scanner/...` — scanner-mode routes (own shell).
- Detail routes use the entity ID; public routes use slugs.

## 4.4 Cross-platform link handling

- Universal links (iOS) and App Links (Android) for: public event/brand/organiser pages, invitations, share intents, OG previews.
- Web URLs are the source of truth; mobile apps register intents to handle them.
- An unauthenticated mobile user tapping a public link opens the link in the in-app webview (preserves brand chrome) until they decide to sign in.

---

# Section 5 — Screen Inventory

> Each screen entry follows the per-screen template defined in the dispatch prompt. Cross-references to PRD sections are inline. Where layout meaningfully differs between mobile / tablet / desktop / wide-desktop, all variants are described.
>
> Screens are grouped by domain: 5.1 Auth & Onboarding · 5.2 Account · 5.3 Brand · 5.4 Event Creation · 5.5 Tickets · 5.6 Public Pages · 5.7 Checkout · 5.8 Event Management · 5.9 Scanner · 5.10 In-Person Payments (door) · 5.11 Permissions · 5.12 Chat (placeholder) · 5.13 Cross-Cutting & Global · 5.14 Locked / Post-MVP Empty States.

## 5.1 Auth & Onboarding

### 5.1.1 `/welcome` — Welcome / Sign-In

**Purpose:** Allow an unauthenticated user to sign in with Google or Apple.
**Roles:** unauthenticated.
**Entry:** App launch when no session, deep links when no session.
**Exit:** On success → /onboarding/step-1 (first run) or /(tabs)/home (returning).
**Mobile layout:** Vertical: top safe-area · 80 px gap · animated headline ("Run experiences. Sell out tickets. Mingla Business.") · 32 px gap · Mingla mark · spacer · two CTAs stacked (Continue with Apple, Continue with Google) · 16 px gap · "By continuing you agree to Terms · Privacy" · safe-area bottom. Background: `bg.warm-glow` gradient.
**Tablet layout:** Same content, content max-width 480 centered, larger Mingla mark.
**Desktop web:** Two-column. Left: brand showcase imagery (16:9 hero loop). Right: 480 wide auth panel as in mobile. Background: `canvas.profile`.
**Wide desktop:** Same as desktop, more outer gutters.
**Components:** Button (primary, large), Link, Animated headline.
**Glass treatments:** None — light mode auth.
**States:** default · loading (CTAs disabled, spinner overlay) · error (toast + CTA re-enabled) · provider-blocked (e.g., Apple unavailable on Android — provider-specific button hidden).
**Interactions:** Tap CTA → OAuth → on success route forward; on cancel return to default.
**Microinteractions:** Headline morphs through 3 phrases on a 4.5 s loop with 320 ms cross-fade.
**Motion:** Page fade-in 400 ms.
**Form rules:** N/A.
**Confirmations:** N/A.
**Copy bank:** see Section 7.1.
**Sample data:** N/A.
**Accessibility:** Headline and CTAs have screen-reader labels; "Continue with Apple" announces full label; logo is decorative (`aria-hidden`).
**Edge cases:** Network failure → "Couldn't reach Mingla. Check your connection and try again." Toast persistent until retry.
**Mobile-only:** Apple Sign In button native styling.
**Web-only:** Sign-in opens in popup, closes on completion.
**Cross-references:** consumer `BusinessWelcomeScreen.tsx`.

### 5.1.2 `/onboarding/step-1` — Welcome to Business

**Purpose:** Founder-voice introduction, set tone, single CTA forward.
**Roles:** authenticated, first-run.
**Entry:** Post-OAuth on first session.
**Exit:** Next → /onboarding/step-2; Skip → /(tabs)/home.
**Mobile layout:** Glass card center (radius `xl`, blur 30) with: warm illustration (180×180) · h1 "Welcome to Mingla Business." · body "Run events that feel like the place you'd want to be in. Build a brand. Sell tickets. Settle the night without spreadsheets." · Wizard indicator (dot 1 of 4) · footer with Skip + Next.
**Desktop web:** Same content, max-width 560, centered on canvas.
**States:** default · skip-confirm (subtle inline microcopy "You can come back to this later").
**Interactions:** Skip → opens onboarding-cancel confirm dialog.
**Motion:** Card scales 0.96 → 1 + opacity 0 → 1 over 400 ms on enter.
**Accessibility:** focus on Next CTA on mount.
**Edge cases:** Returning user skipped onboarding before → never re-shown unless explicitly visited.

### 5.1.3 `/onboarding/step-2` — Display name + phone

**Purpose:** Confirm display name (pre-filled from OAuth) and optional phone (for SMS receipts).
**Mobile:** form with two fields (Display name required, Phone optional with intl format component) + Stepper indicator + Skip/Next.
**Desktop:** same, centered card 480 wide.
**States:** default · validating (phone format async check) · error (inline) · success (Next enabled).
**Edge cases:** Display name empty → Next disabled with helper "Tell us what to call you." Phone format invalid → inline error "That doesn't look like a phone number — include the country code, e.g. +44 7700 900000."

### 5.1.4 `/onboarding/step-3` — Create first brand

**Purpose:** Optional brand creation in onboarding.
**Mobile:** Dual-path screen — top half "Have a brand to bring in?" with brand-name input + "Create brand" CTA; bottom half "Or come back later" with Skip CTA.
**Desktop:** Side-by-side panels — left: brand creation form (name, optional photo), right: illustration explaining what a brand is.
**Edge cases:** Brand name already taken → inline error "That name's taken. Try [suggestion]."

### 5.1.5 `/onboarding/step-4` — Event-type taxonomy

**Purpose:** Optional taxonomy ("What kind of events do you run?") used for analytics and future curation.
**Mobile:** chip grid (Nightlife, Brunch, Comedy, Music, Theatre, Sports, Wellness, Food, Dance, Art, Workshops, Other) — multi-select up to 5 + Done.
**States:** default · with selection · max reached.
**Edge cases:** Skip allowed; Done allowed with zero selections.

### 5.1.6 `/invitation/:token` — Accept brand invitation

**Purpose:** Allow an invited teammate to join a brand.
**Roles:** unauthenticated or authenticated.
**Entry:** Email link.
**Exit:** Accepted → /brand/:brandId/; Declined → /(tabs)/home.
**Mobile layout:** Glass card with brand avatar + name + role being assigned + body "[Inviter name] invited you to join [Brand] as [Role]." + Accept (primary) + Decline (tertiary).
**Desktop:** centered card 480.
**States:** valid · expired · already-accepted · revoked. Each has a clear copy bank (Section 7).
**Edge cases:** Token expired → "This invitation expired on [date]. Ask [inviter] to send a new one." Invitation revoked → "This invitation was cancelled. Ask [inviter] to send a new one."

## 5.2 Account

### 5.2.1 `/(tabs)/account` — Account home

**Purpose:** Account hub: avatar, name, email, brand list, sign-out, delete.
**Mobile:** scroll view: avatar 96 px (tap to edit photo) · h1 name · body email · spacer · Glass card "Brands" with brand rows (avatar + name + role pill + chevron) + "+ Create brand" tile · spacer · Glass card "Settings" with rows (Edit profile, Notifications, Locale & timezone, Marketing preferences) · spacer · Sign out (tertiary destructive) · Delete account (link, `semantic.error`).
**Desktop:** sidebar nav already shows account; main area uses two-column grid: left = profile card; right = brands list + settings list.
**States:** default · brand-empty (no brands yet) → "Create your first brand to start running events." · network error.
**Interactions:** Tap brand row switches current brand and routes to /(tabs)/home.
**Motion:** Brands list cards stagger in 60 ms × index.
**Accessibility:** every row has clear name and role announced.

### 5.2.2 `/account/profile` — Edit profile

**Purpose:** Edit display name, photo, phone.
**Mobile:** form sheet with image upload (avatar 120 px) + Display name input + Phone input + Save shelf.
**Desktop:** modal 480 wide, same content.
**States:** clean · dirty (Save enabled) · saving · saved (toast) · error (inline + toast).

### 5.2.3 `/account/settings` — Settings

**Mobile:** scroll view sectioned by category (Notifications, Locale, Timezone, Marketing). Each row uses Toggle or Select.
**Desktop:** same sections in single column max 720, OR tabbed left-nav variant for `xl+`.
**Edge cases:** locale change re-renders entire app once confirmed; warn user.

### 5.2.4 `/account/delete/consequences` — Delete: consequences

**Purpose:** Show what will happen when deleting.
**Mobile:** Glass error banner top: "You're about to delete your account." Body: bullet list (your N brands will be archived, your active events totalling £X in unsold tickets will be cancelled and refunded, Stripe Connect will be disconnected, ...). Continue (primary destructive) + Keep account (secondary).
**Desktop:** centered modal 560.
**States:** default · cannot-delete-now (e.g., active events with unsettled funds → message: "You have £4,237 in unsettled payouts. Wait 7 days after your last event ends, or contact support.").
**Edge cases:** Pending refunds outstanding → cannot proceed; show pending list with "Resolve these first" CTA.

### 5.2.5 `/account/delete/stripe-detach` — Delete: detach Stripe

**Purpose:** Detach Stripe Connect from each brand before final delete.
**Mobile:** brand list with Stripe state per row + "Detach" button per row. Continue button disabled until all detached.
**Desktop:** table layout.
**States:** detaching (per row) · success · error (per row, retry).

### 5.2.6 `/account/delete/confirm` — Delete: type-to-confirm + hold-to-confirm

**Purpose:** Final confirmation gate.
**Mobile:** Type your email to confirm input + Hold-to-confirm 1.5 s primary destructive button "Delete my account." Cancel link below.
**Desktop:** Modal 480.
**Microinteractions:** Hold button fills `semantic.error` left-to-right over 1.5 s; releasing early resets fill in 200 ms.

### 5.2.7 `/account/delete/scheduled` — Deletion scheduled

**Purpose:** Confirm deletion is scheduled and explain the 30-day window.
**Mobile:** centered glass card with checkmark icon + h2 "Account deletion scheduled" + body "Your data will be permanently deleted on [date]. We've signed you out everywhere. If you change your mind, sign in within 30 days to undo." + Sign out CTA.
**Desktop:** modal 480.
**Note:** This screen also accessible from email link to cancel deletion.

## 5.3 Brand

### 5.3.1 `/brand/create` — Create brand

**Mobile:** form sheet: Brand name input + (optional) photo upload + Continue.
**Desktop:** modal 560.
**States:** name-taken (live validation) · saving · saved → routes to /brand/:brandId/.

### 5.3.2 `/brand/switcher` — Brand switcher

**Mobile sheet:** drag handle + h2 "Switch brand" + brand rows (avatar + name + role pill) with current brand highlighted (`accent.warm.tint`) + "+ Create new brand" row.
**Desktop dropdown:** glass panel below the brand chip in sidebar header. 320 px wide. Same rows.
**States:** loading · empty (only one brand → still works as a single-row sheet that says "You only have one brand. Create another?").

### 5.3.3 `/brand/:brandId/` — Brand profile (founder view)

**Mobile:** hero glass card elevated with brand photo + name + bio + contact + social chips. Below: stats strip (total events, total attendees, GMV — only for users with finance access). Below: Recent events list. Sticky shelf at bottom with "Edit brand" + "View public page".
**Desktop:** Two-column. Left: profile card. Right: stats strip on top, then recent events table.
**States:** default · empty bio ("Add a description so people know what you're about" inline CTA) · stripe-not-connected banner.
**Edge cases:** Long bio → expandable "Read more."

### 5.3.4 `/brand/:brandId/preview` — Brand profile (public preview)

**Purpose:** Render the public brand page exactly as attendees will see it.
**Layout:** same as /public/b/:slug (see 5.6.7) but with a top banner "PREVIEW · Only you can see this."

### 5.3.5 `/brand/:brandId/edit` — Edit brand

**Mobile:** scroll view sectioned: Photo · Basics (name, description, contact email, contact phone) · Social links (multi-select platforms with URL inputs) · Custom links (multi-add) · Display attendee count toggle.
**Desktop:** same in a wider form, 720 max.
**States:** clean / dirty / saving / saved / error.
**Edge cases:** Photo crop required if uploaded image is not square (default brand photo is square).

### 5.3.6 `/brand/:brandId/settings` — Brand settings

**Mobile:** rows: Tax/VAT settings · Default currency · Timezone · Slug override.
**Desktop:** sections in tabs.
**Edge cases:** Changing currency on a brand with paid past events → confirm modal: "This will change how amounts display, but past orders settle in the original currency."

### 5.3.7 `/brand/:brandId/payments` — Brand payments

**Purpose:** Stripe state, balance, payouts, fees, refunds.
**Mobile:** vertical: Stripe banner (Action required / Active / Restricted) · KPI tiles (Available balance, Pending balance, Last payout) · Recent payouts list · Recent refunds list · "Export finance report" CTA.
**Desktop xl+:** same content but as dashboard with right inspector for selected payout/refund.
**States:** stripe-not-connected (banner + Connect Stripe CTA dominates) · onboarding-incomplete (banner + "Finish onboarding" CTA) · active · restricted (red banner with reason + "Resolve" CTA linking to Stripe dashboard).

### 5.3.8 `/brand/:brandId/payments/onboard` — Stripe Connect onboarding

**Purpose:** Embedded Stripe onboarding.
**Mobile:** WebView taking full screen with native top bar (Cancel left, "Stripe onboarding" title).
**Desktop:** modal 560 wide with embedded Stripe `Connect.js` panel.
**States:** loading · in-progress · complete · failed (with retry).

### 5.3.9 `/brand/:brandId/team` — Team list

**Mobile:** list of glass card rows for each member: avatar + name + role pill + last-active timestamp + overflow ⋯. "+ Invite teammate" FAB bottom-right.
**Desktop:** data table at `lg+`: Name | Role | Email | Joined | Last active | Actions.
**States:** empty (only owner) → CTA to invite. Pending invitation rows (greyed) with "Resend" / "Cancel" buttons.

### 5.3.10 `/brand/:brandId/team/invite` — Invite teammate

**Mobile sheet:** Email input + Role select (5 options) + Optional note textarea + Send invitation primary CTA.
**Desktop modal:** 480 wide.
**Edge cases:** Email already a member → inline error "Already on the team." Email already invited (pending) → "Already invited. Resend?"

### 5.3.11 `/brand/:brandId/team/:memberId` — Member detail

**Mobile:** profile-style screen with avatar, name, role, joined, last active, change role CTA, remove CTA.
**Desktop:** right inspector pattern from team table.
**States:** owner (cannot change own role; cannot remove self).

### 5.3.12 `/brand/:brandId/audit` — Audit log [owner only]

**Mobile:** chronological list of audit log rows. Date filter at top. Search input.
**Desktop:** data table with columns Time · Actor · Action · Target · Details (expandable diff).
**States:** empty · filtered-empty.

## 5.4 Event Creation

### 5.4.1 `/event/create` — Event creator

**Layout difference:**
- **Mobile:** 7-step wizard (one step per screen + back/next + step indicator).
- **Tablet:** Same wizard but content max-width 720 centered.
- **Desktop xl+:** Single scrolling form with sticky right preview pane (360 wide). Each section (the 7 steps) is a glass card with its own anchor in the page.

**Steps (per PRD §3.1):**
1. Title + description
2. Date / time (single, recurring, multi-date)
3. Location (geocoded picker or online toggle with URL)
4. Cover media (image / video / GIF)
5. Theme (font + color preset + custom color)
6. Organiser contact (name, photo, phone, email)
7. Visibility (public / Discover / swipeable-deck toggles)

After step 7: Preview modal (live render of public event page) → Save Draft / Publish gate.

### 5.4.1.1 Step 1 — Title + description

**Anatomy:** Title input (h2 placeholder, character counter to 80) · Description Rich Text Editor (max 2000 chars).
**States:** default · dirty · auto-save indicator ("Saved a moment ago" microcopy below title).

### 5.4.1.2 Step 2 — Date/time

**Anatomy:** Recurrence rule picker (Once / Recurring / Multi-date) · Date+Time picker(s) · Timezone select (default brand TZ) · "Add another date" if Multi-date.
**Recurring branch:** Recurrence Rule Picker + end-date or end-after-N-occurrences.
**States:** default · invalid (start after end) → inline error.

### 5.4.1.3 Step 3 — Location

**Anatomy:** Toggle "In-person / Online / Hybrid" · For in-person: Map picker + Address autocomplete · For online: URL input + provider hint (Zoom / Google Meet detected) · For hybrid: both.
**States:** geocoding · no-results · selected (with map preview).

### 5.4.1.4 Step 4 — Cover media

**Anatomy:** Tabbed interface: [Image | Video | GIF library]. Image tab uses Image Upload. Video tab uses Video Upload. GIF tab opens GIF Picker.
**States:** empty · uploading (progress) · uploaded (preview) · failed.
**Edge cases:** Switching tabs after upload prompts to discard.

### 5.4.1.5 Step 5 — Theme

**Anatomy:** Font Picker (5 fonts) · Color preset row (6 presets) · Custom color via Color Picker · Live Theme Preview Tile right side.
**States:** default · custom-mode active.

### 5.4.1.6 Step 6 — Organiser contact

**Anatomy:** Display name input · Avatar Image Upload · Phone input · Email input. Pre-filled from account profile; user can override per event.
**States:** default · using-account-default · custom-overridden.

### 5.4.1.7 Step 7 — Visibility

**Anatomy:** Toggle "Public on Discover" · Toggle "Show in swipeable deck" · Visibility radio (Public / Private link only / Hidden) · Slug input (auto + manual override).
**States:** default · slug-taken · slug-invalid (special chars).

### 5.4.2 `/event/:eventId/preview` — Preview modal

**Purpose:** Show live public event page before publish.
**Layout:** Full-screen modal. Top bar with "Preview" title + Close. Body renders `/public/e/:slug` exactly as attendees see it. Bottom shelf with Edit / Save Draft / Publish.

### 5.4.3 Publish gate

**Modal triggered by Publish CTA.**
**Validation runs first:**
- Required fields complete?
- Brand has Stripe in active state (if any paid tickets)?
- At least one ticket type defined?
**On all-pass:** Confirm modal "Ready to publish [Event name] on [date]? This will make it visible to the public and Discover (if enabled)." Confirm + Cancel.
**On any-fail:** Modal lists exactly what's missing with a Fix CTA per row.

### 5.4.4 Edit-after-publish flow

**Identical to creation flow** but with a yellow banner top: "You're editing a published event. Changes go live on Save." On Save, a change-summary modal previews what changed, with "Apply changes" Confirm.

### 5.4.5 Per-date override editor (multi-date)

**Mobile:** sheet with date selector + per-date overridable fields (title, description, location). Default values inherit from master event.
**Desktop:** side-by-side: dates list (left) + override form (right).

### 5.4.6 Duplicate-across-dates action

**Action sheet:** "Apply [field name] from [source date] to: [pick dates]." Confirm overwrites overrides on selected dates.

## 5.5 Tickets

### 5.5.1 `/event/:eventId/tickets` — Ticket type list

**Mobile:** list of Ticket Type Cards · "+ Create ticket type" FAB · drag handles for reorder.
**Desktop:** data table OR card list (toggle).
**States:** empty (CTA prominent) · draft event (some operations disabled until publish).

### 5.5.2 `/event/:eventId/tickets/create` — Create ticket type

**Mobile:** Multi-section form (collapsible sections):
- Basics: Name, Description, Free toggle, Price (Currency Input), Quantity / Unlimited toggle.
- Sale period: Sale start, Sale end.
- Validity: Validity start, Validity end (optional).
- Purchase limits: Min, Max.
- Advanced (collapsed): Hidden, Disabled, Approval required, Allow transfers, Password-protected (with password input), Online available, In-person available, Waitlist enabled.
**Desktop:** sections shown in tabs OR all sections expanded as accordion.
**States:** valid (Done enabled) · invalid (each section shows inline errors) · saving.
**Edge cases:** Free toggle off + price 0 → inline warning "Set a price or mark this ticket as free." Sale start after sale end → inline error.

### 5.5.3 `/event/:eventId/tickets/:ticketTypeId` — Edit ticket type

Same as Create with values pre-filled. If tickets sold, certain fields lock with explanatory copy ("Quantity can't drop below 47 sold tickets — increase, or set to unlimited").

### 5.5.4 `/event/:eventId/tickets/:ticketTypeId/preview` — Buyer-side preview

Live mini-render of how the ticket appears in the public event ticket selector. Used by organiser to validate description copy and price display.

### 5.5.5 Reorder ticket types

Drag (web) or long-press-drag (mobile) on ticket card. Order persists; affects display on public page.

### 5.5.6 Toggle visibility / disabled

Inline ⋯ menu on each card → Hide / Disable / Archive. Confirm if active sales would be affected.

## 5.6 Public Pages

### 5.6.1 `/public/e/:slug` — Public event page (default)

**Mobile:** hero (16:9 cover or 4:5 swipe-style on mobile) · floating top bar with back + share + save-event icon button · title block · date/time chip · location chip · description body (rich text rendered) · organiser contact glass card · ticket selector glass card (sticky bottom shelf with "Get tickets [from £X]" CTA) · share section · "More by [Brand]" related events.
**Desktop:** two-column. Left: hero + content. Right: sticky ticket selector card.
**Light mode variant:** Same layout, light background, organiser-controlled accent color overrides `accent.warm`.
**States:** see 5.6.2–5.6.6 variants.

### 5.6.2 Sold-out variant

CTA replaced with "Join waitlist" (if waitlist-enabled) or "Sold out — follow [Brand] for next time" (if not).

### 5.6.3 Past-event variant

Hero greyscaled. CTA replaced with "This event ended on [date]. See more from [Brand]." Recap section optional (post-MVP).

### 5.6.4 Pre-sale variant

Sale-not-yet-started state. CTA replaced with "On sale [date] at [time]" + "Notify me" optional CTA (collects email).

### 5.6.5 Password-protected variant

Page renders with masked content (event title only) + Password input + Unlock CTA. On correct: re-renders default view.

### 5.6.6 Approval-required apply flow

CTA "Apply for tickets" → sheet/modal collecting buyer details + optional message. Submit → "Application sent. We'll let you know." On approval, attendee receives email with checkout link.

### 5.6.7 `/public/b/:slug` — Public brand page

**Mobile:** hero card with brand photo + name + bio + social chips · stats strip (events run, attendees served — only if `display_attendee_count` true) · upcoming events (card list) · past events (card list, collapsed by default).
**Desktop:** two-column with sticky brand card left, events list right.

### 5.6.8 `/public/o/:slug` — Public organiser page

Account-level showcase. Similar structure to brand page but lists multiple brands the organiser owns. (If a multi-brand showcase is shipped — gated to verified organisers.)

### 5.6.9 Share modal

Across all public pages. Modal with: canonical URL display + Copy button + native share intent + per-platform buttons (X, Instagram Story, WhatsApp, iMessage, Email). On copy: button morphs "Copied!" 1.4 s.

### 5.6.10 OG / share preview rendering

(Not a screen — but a deliverable.) Designer produces the OG card template per §1.10.4 for every public page type.

## 5.7 Checkout

### 5.7.1 `/checkout/:eventId` — Ticket selection

**Mobile:** sticky event-summary header (glass) · ticket type list with stepper per type · running total · "Continue" CTA shelf bottom.
**Desktop:** event hero left, ticket selector right.
**States:** default · max-per-customer reached (stepper disabled with hint) · sold-out type (greyed out with "Sold out" pill) · password-protected (Password input above types) · approval-required (replaces Continue with Apply CTA).

### 5.7.2 `/checkout/:eventId/buyer` — Buyer details

Form: Name, Email, Phone (optional), Postcode (optional). Pre-fill if signed in.
**States:** validating · valid · invalid (inline errors).

### 5.7.3 `/checkout/:eventId/payment` — Payment

**Mobile:** Apple Pay / Google Pay button (primary if available) · OR Stripe Payment Element below · "Pay £X" CTA shelf bottom.
**Desktop:** Same content in centered card 480.
**States:** processing (spinner overlay; no double-submit) · 3DS challenge (in-line iframe) · success → routes to confirm · failed (toast + retry).
**Edge cases:** Network drops mid-payment → status check on resume; show "Verifying payment…" state until resolved.

### 5.7.4 `/checkout/:eventId/confirm` — Confirmation + QR

**Layout:** Big checkmark · "You're in." · order summary · QR ticket (320×480) per ticket · Apple Wallet button + Google Wallet button · Email/SMS confirmation note · "View my tickets" / "Back to event" links.
**Microinteractions:** Confirmation pulse animation 800 ms (`spring.save-bounce`).

### 5.7.5 `/checkout/:eventId/wallet` — Wallet add

Native iOS / Android wallet add intent. Web has download .pkpass (Apple Wallet) or .pass (Google Wallet) buttons.

## 5.8 Event Management

### 5.8.1 `/event/:eventId/` — Event overview dashboard

**Purpose:** At-a-glance event health.
**Mobile:** vertical: status pill row (Draft / Scheduled / Live / Ended) · KPI Tiles grid 2-col (Tickets sold, Revenue, Scans, Waitlist) · capacity bar · realtime activity feed · quick-action shelf (Share / Edit / Manage tickets / Manage scanners).
**Desktop xl+:** 3-region: left sidebar nav + main dashboard + right inspector showing latest activity item with full detail.
**States:** Live event glows with `accent.warm` border on hero KPIs; ended events show settlement banner.

### 5.8.2 `/event/:eventId/orders` — Orders list

**Mobile:** Order Rows in list with sticky search/filter chips top.
**Desktop:** data table: Buyer | Tickets | Total | Method | Status | Time. Right inspector for selected order.
**Filters:** Date range · Status · Method · Search.
**Bulk actions:** Multi-select → Refund / Cancel / Export.

### 5.8.3 `/event/:eventId/orders/:orderId` — Order detail

Sheet (mobile) or right inspector (desktop): buyer block + ticket line items + payment block (method, status, Stripe ID mono) + actions (Refund, Cancel, Resend, Add note).

### 5.8.4 `/event/:eventId/orders/:orderId/refund` — Refund flow

Sheet: Full / partial radio · Amount input (capped at order total) · Reason dropdown · Confirm. Confirm uses simple confirm dialog with consequences.

### 5.8.5 `/event/:eventId/orders/:orderId/cancel` — Cancel flow

Similar to Refund but voids tickets and sends cancellation email.

### 5.8.6 `/event/:eventId/guests` — Guest list

**Mobile:** list of Guest Rows with sticky tabs (All / Pending approval / Checked in / Refunded).
**Desktop:** data table.
**Bulk actions:** Approve / Reject / Check in / Export.
**Edge cases:** Search by name, email, last 4 of phone.

### 5.8.7 `/event/:eventId/guests/pending` — Pending approvals queue

Single-purpose subview when approval-required tickets have applications. Each row Approve / Reject inline + bulk action.

### 5.8.8 `/event/:eventId/guests/add` — Manual add guest

Sheet: Name + Email + Phone + Ticket type select + Quantity. Submit issues a free ticket (or a paid ticket with "comp" payment method).

### 5.8.9 `/event/:eventId/guests/:attendeeId` — Attendee detail

Profile-style: avatar + name + email + phone + purchase history + check-in status + message history (post-MVP) + organiser notes textarea.

### 5.8.10 `/event/:eventId/share` — Share modal

Same as 5.6.9 share modal, plus tracking-link overview row (post-MVP) and brand-share footer.

## 5.9 Scanner

### 5.9.1 `/scanner/` — Scanner-mode landing

**Purpose:** Scanner role landing — pick event to scan if assigned to multiple.
**Mobile:** dark canvas · large "Open scanner" CTA · list of assigned events with ticket-progress bars · activity log entry.
**Web:** "Manual lookup mode" — same layout but Camera CTA replaced with "Camera not supported on web. Use manual lookup."

### 5.9.2 `/scanner/scan` — Camera scan view

QR Scanner Frame full-screen. Sticky context shelf top (event name + scanned/total). Bottom: last-scanned-result indicator + "Manual lookup" link.
**States:** ready · scanning · success · duplicate · wrong-event · not-found · void · permission-denied (camera).
**Microinteractions:** as defined in §3.11.7.

### 5.9.3 `/scanner/lookup` — Manual lookup

Search input + Search button → list of matching tickets with name, email, ticket type, status. Tap → ticket detail with Check-in CTA.

### 5.9.4 `/scanner/sale/select` — Door sale: select tickets

Mobile-only screen. List of available ticket types (must have `available_in_person: true`) with stepper per type. Continue when ≥ 1 selected.

### 5.9.5 `/scanner/sale/payment` — Door sale: payment method picker

Buttons (large): Card reader · NFC tap · Cash · Manual entry. Each routes to specific flow.

### 5.9.6 `/scanner/sale/payment/card` — Card reader

Card Reader Status Indicator + waiting-for-card state + on-tap → success / decline.

### 5.9.7 `/scanner/sale/payment/nfc` — NFC tap (mobile only)

NFC Tap Indicator overlay. iOS variants per Apple guidelines, Android variants per Google.

### 5.9.8 `/scanner/sale/payment/cash` — Cash entry pad

Cash Entry Pad component. On confirm calculates change and routes to receipt.

### 5.9.9 `/scanner/sale/payment/manual` — Manual entry

Form: tendered amount + method note + confirm.

### 5.9.10 `/scanner/sale/receipt` — Receipt

QR ticket display + Email/SMS receipt options + Print (mobile only via share-to-print) + "Sell another" / "Back to scanner" CTAs.

### 5.9.11 `/scanner/activity` — Scanner activity log

List of own scans (timestamp, ticket, event, result). Search input. Sync indicator if any pending offline scans.

## 5.10 In-Person Payments (door, organiser-side reconciliation)

### 5.10.1 `/event/:eventId/reconciliation` — End-of-night reconciliation

Brand admin / finance role. Mobile: list of payment methods with totals. Desktop: data table with method, ticket count, tendered total, system total, variance highlight.
**States:** open · closed (variance signed off) · disputed.

## 5.11 Permissions

### 5.11.1 `/brand/:brandId/team` (extended permission view)

Same as 5.3.9 with extra column showing role-by-feature matrix on hover/tap.

### 5.11.2 `/event/:eventId/scanners` — Scanner management

List of scanners assigned to this event with permissions toggles (Scan, Take payments). "+ Invite scanner" FAB.

### 5.11.3 `/event/:eventId/scanners/:scannerId/permissions` — Scanner permission config

Sheet: toggles for Scan tickets · Take card payments · Take NFC payments · Take cash · Manual entry. Save/Cancel.

### 5.11.4 `/brand/:brandId/audit` — Permission audit (owner-only)

Already covered 5.3.12. Permission-related events (role changes, removals, scanner invitations) included.

## 5.12 Chat (placeholder until M20)

### 5.12.1 `/(tabs)/chat` — Chat tab (locked-state, MVP)

**Mobile:** glass card centered with illustration · h2 "Coming soon" · body "Describe your event in one sentence and we'll build it. We're polishing the experience first." · "Notify me" optional CTA collecting email opt-in.
**Desktop:** centered modal-style card.
**States:** locked-default (only state in MVP).

### 5.12.2 `/(tabs)/chat` (M20+ active) — Chat thread

**Mobile:** message thread (sent right, agent left) · in-chat UI cards (Date / Ticket / Visibility / Payment / Marketing) inline · live event preview pane below thread (collapsible).
**Desktop:** two-column. Thread left, preview right.
**States:** empty · drafting · validating · ready-to-publish · published.

### 5.12.3 In-chat UI cards

Defined in §3.11.16. Each card glass card with title + body + 2–4 option buttons. Option tapped → result inserted into thread + draft updated.

## 5.13 Cross-Cutting & Global

### 5.13.1 `/system/offline` — Network-down

Centered glass card with cloud-off icon, "You're offline. Some features won't work." Persistent banner at top of every screen also shows offline state.

### 5.13.2 `/system/maintenance` — Outage mode

Full-screen takeover with a status indicator, ETA, and link to status page. Routes back to the app once resolved.

### 5.13.3 `/system/update-required` — Force update

Modal with Mingla mark, "Update Mingla Business" + "We added important fixes. Update to continue." + App Store / Play Store / web reload CTA.

### 5.13.4 `/system/suspended` — Suspended account

Glass card with warning icon + "Your account is suspended" + reason + "Get help" CTA. Sign-out below.

### 5.13.5 `/error` — Global error boundary

Centred `semantic.error` glass card · alert-triangle icon · "Something broke" · body "We're on it. The team has been notified." · "Try again" + "Get help" CTAs.

### 5.13.6 Toast container

Top-right of viewport on web, top-center on mobile (under status bar). Stacks new toasts with 8 px gap.

### 5.13.7 Loading splash (cold start)

Dark canvas with Mingla mark centered, subtle pulse `ease.sine` 1500 ms.

### 5.13.8 404 not-found

Glass card with "Couldn't find that page" + "Take me home" CTA.

## 5.14 Locked / Post-MVP Empty States

These tabs / screens exist in the IA from MVP day one to anchor the future product. They render a locked-state empty state.

### 5.14.1 Marketing (Email / SMS / CRM) — locked

**Layout:** glass card with lock icon + "Marketing tools — coming soon" + body explaining roadmap (per BUSINESS_STRATEGIC_PLAN milestones M14–M16) + "Notify me" CTA collecting email opt-in.

### 5.14.2 Tracking & Attribution — locked

Same pattern. Body: "Tracking links and source attribution shipping after M14."

### 5.14.3 Analytics dashboards — locked

Same pattern. Note: minimal in-screen counters (tickets sold, revenue, scans) DO exist in MVP — only the full Analytics tab is locked.

### 5.14.4 AI Guest psychology / AI suggestions — locked

Same pattern, gated behind chat agent M19+.

---

# Section 6 — User Journeys

> Section 6 lives in the companion file `SPEC_BUSINESS_USER_JOURNEYS.md`. It traces every user journey end-to-end: organiser onboarding (Google + Apple paths), brand operations (Stripe Connect success / stalled / rejected, team invitations, role changes), event lifecycle (single / recurring / multi-date, publish-with-validation-errors, edit-after-publish, cancellation-with-refund-cascade), ticket management (free / paid / approval / password / waitlist / transfer / refund), attendee purchase (Apple Pay / Google Pay / card-with-3DS / declined), door operations (every scan outcome, every payment method, offline-then-sync, end-of-night reconciliation), account lifecycle (delete with 30-day undo), and cross-domain failure paths (forgotten brand, double-edit conflict, delayed Stripe webhook, force-update, suspension).

---

# Section 7 — Microcopy & Voice

> Production-ready strings for every visible surface. Founder voice. Plain English. Currency-aware. Never dating-app language.

## 7.1 Auth & Onboarding

| Surface | Copy |
|---------|------|
| Welcome headline (rotating) | "Run experiences. Sell out tickets. Mingla Business." / "Build a brand. Sell the night. Settle without spreadsheets." / "The operator's app for live experiences." |
| Continue with Apple | "Continue with Apple" |
| Continue with Google | "Continue with Google" |
| Terms link | "By continuing you agree to our Terms and Privacy." |
| Onboarding step 1 body | "Welcome to Mingla Business. Build a brand. Build an event. Sell tickets and settle the night without leaving this app." |
| Onboarding step 2 label | "What should we call you?" |
| Onboarding step 2 phone label | "Phone (optional, for SMS receipts)" |
| Onboarding step 3 prompt | "Got a brand to bring in?" |
| Onboarding skip cancel modal | "Skip for now? You can build a brand later from your Account." |
| Invitation accept | "[Inviter] invited you to join [Brand] as [Role]." |
| Invitation expired | "This invitation expired on [date]. Ask [inviter] to send a new one." |

## 7.2 Account

| Surface | Copy |
|---------|------|
| Brand list empty | "No brands yet. Build the first one." / CTA "Create brand" |
| Sign out confirm | "Sign out of Mingla Business?" / "Sign out" / "Cancel" |
| Delete header | "Delete account" |
| Delete consequences body | "You're about to delete your account. We'll keep your data for 30 days in case you change your mind. After that, it's gone for good." |
| Delete with active events | "You can't delete now — you have [N] active events with £[X] in unsold tickets. Cancel them first, or wait until they end." |
| Delete type-to-confirm | "Type your email to confirm" |
| Delete hold-to-confirm | "Hold to delete" |
| Deletion scheduled | "Account deletion scheduled for [date]. We've signed you out." |

## 7.3 Brand

| Surface | Copy |
|---------|------|
| Brand created | "[Brand name] is ready. Build your first event." |
| Brand photo upload | "Add a photo so people remember you." |
| Stripe banner — not connected | "Connect Stripe to sell paid tickets." / CTA "Connect Stripe" |
| Stripe banner — onboarding incomplete | "Stripe needs one more thing before you can sell." / CTA "Finish onboarding" |
| Stripe banner — restricted | "Stripe restricted your account. Resolve it on Stripe to keep selling." / CTA "Open Stripe" |
| Team — invite empty role | "Pick a role for [email]." |
| Team — invite sent | "Invitation sent to [email]." |
| Team — already on team | "[Name] is already on the team." |
| Team — remove confirm | "Remove [Name] from [Brand]? They'll lose access immediately." |

## 7.4 Event

| Surface | Copy |
|---------|------|
| Creator step 1 placeholder title | "What's the event called?" |
| Creator step 1 placeholder description | "Tell people why they'd want to be there." |
| Creator step 2 timezone helper | "Times shown in [Brand]'s timezone ([TZ]). Change in brand settings." |
| Creator step 4 GIF library helper | "Pick a GIF or upload your own image / video." |
| Preview banner | "Preview · Only you can see this" |
| Publish gate — success | "Live. Share this link: [URL]" |
| Publish gate — missing fields | "Almost there — [N] thing[s] left." |
| Publish gate — Stripe blocker | "Connect Stripe to publish events with paid tickets." |
| Edit-after-publish banner | "Editing live event. Changes go live on Save." |
| Save draft | "Saved as draft." |
| Cancel event | "Cancel [Event]? This refunds [N] tickets totalling £[X] and notifies attendees." |

## 7.5 Tickets

| Surface | Copy |
|---------|------|
| Ticket types empty | "No tickets yet. Create the first ticket type so people can buy in." |
| Free toggle helper | "Free tickets skip checkout — buyers just confirm their email." |
| Approval helper | "Approval required means you review every applicant before issuing the ticket." |
| Password helper | "Share the password with people you want to let in. Without it, they can't see this ticket." |
| Sale window error | "Sale starts after it ends. Flip the dates around." |
| Quantity-locked warning | "[N] tickets sold — quantity can't go below that." |

## 7.6 Public pages

| Surface | Copy |
|---------|------|
| Get tickets CTA | "Get tickets · from £[X]" |
| Sold out CTA | "Sold out" / "Join waitlist" if waitlist enabled |
| Pre-sale CTA | "On sale [date] at [time]" / "Notify me" |
| Past event | "Ended [date]" |
| Password gate | "This event is private. Enter the password to continue." |
| Password wrong | "That's not it. Check the password again." |
| Approval-required CTA | "Apply for tickets" |
| Application sent | "Application sent. We'll let you know." |
| Save event (signed in) | "Saved" / "Save event" |

## 7.7 Checkout

| Surface | Copy |
|---------|------|
| Buyer details prompt | "Where do we send your tickets?" |
| Pay CTA | "Pay £[X]" |
| Processing | "Hold on — confirming with your bank…" |
| Payment failed | "Couldn't take payment. Try a different card or contact your bank." |
| 3DS prompt | "Your bank wants to confirm — follow the prompt." |
| Confirmation headline | "You're in." |
| Confirmation body | "[N] ticket[s] for [Event]. Show the QR at the door. We've sent it to [email]." |
| Add to wallet | "Add to Apple Wallet" / "Add to Google Wallet" |

## 7.8 Event management

| Surface | Copy |
|---------|------|
| Orders empty | "No orders yet. Once people buy, they'll show up here." |
| Refund full | "Refund £[X] to [Name]?" |
| Refund partial | "Refund £[X] of £[Y] to [Name]?" |
| Refund sent | "Refunded. [Name] will see it in 3–5 days." |
| Refund failed | "Refund didn't go through. Stripe error: [code]. Try again or contact support." |
| Cancel order confirm | "Cancel order and refund? [Name] gets £[X] back; their [N] ticket[s] go void." |
| Resend ticket | "Ticket re-sent to [email]." |
| Pending approvals empty | "No applications waiting." |
| Approve | "Approve [Name]?" → "Approved. Ticket sent." |
| Reject | "Reject [Name]'s application? They'll get an email." → "Rejected." |

## 7.9 Scanner

| Surface | Copy |
|---------|------|
| Camera permission | "Mingla Business needs your camera to scan tickets at the door." |
| Permission denied | "We can't scan without camera access. Open Settings to allow it." |
| Ready | "Point at a ticket QR." |
| Success | "Welcome, [Name]." (large, 2 s, then auto-dismiss) |
| Duplicate | "Already used at [time] by [scanner]." |
| Wrong event | "This ticket's for [Event]. You're scanning [This event]." |
| Not found | "No ticket matches that code. Try manual lookup." |
| Void | "Ticket void. Refunded on [date]." |
| Offline scanning | "Saved offline. We'll sync when you reconnect." |
| Sync resolved | "[N] scans synced." |

## 7.10 Door payments

| Surface | Copy |
|---------|------|
| Card reader connecting | "Connecting to reader…" |
| Card reader ready | "Ready. Tap the customer's card on the reader." |
| Card reader error | "Reader disconnected. Reconnect via Bluetooth." |
| NFC tap prompt | "Hold customer's card or phone to the back of the device." |
| Cash quick total | "Tendered £[X] · Change £[Y]" |
| Receipt sent | "Receipt sent to [email]." |
| Reconciliation variance | "Variance £[X]. Investigate before closing the night." |

## 7.11 Permissions

| Surface | Copy |
|---------|------|
| Role lock tooltip | "Ask your brand admin to enable this." |
| Permission audit empty | "No sensitive actions yet." |
| Audit row diff label | "Was: [before] · Now: [after]" |

## 7.12 System & errors

| Surface | Copy |
|---------|------|
| Offline banner | "You're offline. Some things won't work." |
| Maintenance | "Mingla Business is updating. Back in [ETA]." |
| Force update | "Update Mingla Business" / "We added important fixes. Update to keep going." |
| Suspended | "Your account is suspended. [reason]. Contact support for help." |
| Global error | "Something broke. We're on it. [Try again] [Get help]" |
| 404 | "Couldn't find that page. [Take me home]" |

## 7.13 Push & email shells

Designer mocks the shell, not full content. Push notification example shells:

- "Sara Olsen just bought 2 tickets · [Event]"
- "[Brand] published [Event] · share the link"
- "Stripe needs one more thing — finish onboarding"
- "[Event] starts in 2 hours · 138/200 sold"

Email subject shells:
- "Tickets for [Event]"
- "Payment received · Mingla Business"
- "[Inviter] invited you to [Brand]"
- "Account deletion scheduled"

---

# Section 8 — Accessibility Specification

## 8.1 Color contrast targets

| Pair | Target | Verified |
|------|--------|---------|
| Body text on `canvas.discover` | 4.5:1 | `text.inverse` (#fff) on `#0c0e12` ≈ 18:1 ✓ |
| Body text on glass chrome (over imagery) | 4.5:1 | Designer must verify per cover image |
| `text.inverse` on `primary.500` | 4.5:1 | white on `#f97316` ≈ 3.0 — NEEDS REVIEW; use `primary.700` for body or rely on size ≥ 18 px (large-text 3.0) |
| `text.inverse` on `accent.warm` | 4.5:1 | white on `#eb7825` ≈ 3.1 — same caveat |
| Status colors on dark canvas | 4.5:1 | All semantic colors verified against `canvas.discover` |
| Hairline borders | 1.5:1 visibility | Decorative — not WCAG-bound |

**Rule:** primary CTAs use button-md or button-lg sizes (≥16 px) so contrast under WCAG large-text rule (3:1) suffices. Body text and small captions never sit on `primary.500` or `accent.warm` directly without a darker overlay.

## 8.2 Touch & cursor targets

- Mobile minimum 44 × 44 pt; expand visual hit area where the design reads smaller (e.g., chip × button is visually 16 px but hit area 44).
- Web cursor target minimum 32 × 32 px with hover affordance.

## 8.3 Keyboard navigation (web)

- Logical tab order top-to-bottom, left-to-right.
- Visible focus ring (2 px `accent.warm` solid + 2 px transparent offset).
- Escape closes modals, sheets, dropdowns.
- Enter / Space activates buttons; Enter submits forms when in primary input.
- Arrow keys navigate menus, lists, calendar grid.
- Keyboard shortcuts catalog (web only, opt-in via `?` overlay):
  - `g + h` → Home
  - `g + e` → Events
  - `g + a` → Account
  - `n` → New event (when on Events)
  - `/` → Focus search
  - `r` → Refund (when in Order detail)

## 8.4 Screen reader

- Roles: `button`, `link`, `dialog`, `menu`, `combobox`, `tabpanel`, `tab`, `tablist`, `switch`, `checkbox`, `radio`, `progressbar`, `alert`, `status`.
- Live regions for realtime updates (orders incoming, scan results) use `aria-live="polite"` for non-urgent, `assertive` for errors.
- Modal traps focus until close.
- Decorative icons `aria-hidden="true"`.
- Form errors associated via `aria-describedby` and named in summary at top of form.

## 8.5 Reduced motion

- Per §1.11.5 — translate/scale collapse to opacity, springs linearise, shimmer freezes.
- Reduced motion never breaks affordance — every animation has a static fallback that conveys the same state.

## 8.6 Reduced transparency

- Glass falls back to solid surfaces per §1.8.4. Border, shadow, and content remain.

## 8.7 Color-blind safety

- Status (success / warning / error / info) carries non-color signal:
  - Success: checkmark icon + green
  - Warning: triangle-with-! + amber
  - Error: x-circle + red
  - Info: i-circle + blue
- Capacity bar carries percentage label, not color alone.

## 8.8 Form errors

- Inline error directly under the input, body-sm, `semantic.error`.
- Form-level summary at top when ≥ 2 errors: "Fix [N] things to continue." with anchor links.
- `aria-invalid="true"` on offending inputs.

## 8.9 Time-sensitive actions

- 3DS challenge has no auto-dismiss timeout.
- Scanner success state auto-dismisses but can be re-pinned with a long-press.
- Toast auto-dismiss can be paused on hover (web) or long-press (mobile).

## 8.10 Captions / alternatives

- Video covers carry a poster frame (visual alternative).
- Audio scan-success chirp has visual + haptic equivalents.

---

# Section 9 — Motion & Interaction Detail

## 9.1 Page transitions

| Form factor | Push | Pop | Tab switch | Modal open |
|-------------|------|-----|-----------|-----------|
| Mobile | Slide from right, 320 ms `ease.out`, content beneath dims to 0.4 | Slide back, 240 ms `ease.in` | Tab spotlight slides; content cross-fades 200 ms | Bottom sheet 320 ms `spring.gentle` |
| Web | Cross-fade 200 ms `ease.out` | Cross-fade 200 ms `ease.in` | Cross-fade 200 ms | Centered modal scale 0.96 → 1 + opacity 200 ms |

## 9.2 Scroll behaviors

- Sticky headers gain `shadow.glass.chrome.scrolled` (offset 0/4, blur 16, opacity 0.34) at scroll-y > 8 px, transition 200 ms `ease.out`.
- Pull-to-refresh (mobile): drag 80 px to refresh, spring back. `Haptics.ImpactFeedbackStyle.Light` at trigger.
- Swipe-to-action on rows (mobile): full-width swipe (right = primary action, left = destructive). Reveals action button at 60 px; commits at 120 px.

## 9.3 Long-press

- Avatars / brand chips: long-press shows quick actions menu (View profile, Switch to brand, Sign out).
- Rich text editor: long-press for selection.
- Scanner success: long-press to pin (don't auto-dismiss).

## 9.4 Drag-and-drop

- File upload (web): full-page drop zone activates on drag-enter (overlay 0.6 scrim with `accent.warm.tint` outline).
- Ticket type reorder: drag handle initiates; row lifts (`shadow.glass.modal`); other rows reflow with 200 ms `ease.out` per row.

## 9.5 Real-time update animations

- New order row inserts with slide-down + bg-flash from `accent.warm.tint` (260 ms hold) → fade.
- Scan count increments with stat-value pulse (scale 1 → 1.08 → 1, 320 ms `ease.out`).
- Ticket status pill transitions cross-fade 200 ms.

## 9.6 Loading-to-content morph

Skeleton crossfades to data, 240 ms `ease.out`, with content sliding up 8 px during the same window.

## 9.7 Success / error micro-celebrations

- Successful publish: confetti-like pulse from CTA — 8 small `accent.warm` dots radiating 60 px out, fading over 600 ms `ease.out`. Subtle, never carnival.
- Successful scan at door: green ring expands from QR position, 320 ms `ease.out`. Haptic success.
- Failed payment: shake 8 px ×3 cycles, 240 ms total. Haptic error.

---

# Section 10 — Mockup Set Deliverable Checklist

The external designer ships a Figma (or equivalent) file with the following pages. Until every box is checked, the mockup set is incomplete.

## 10.1 Style guide page
- [ ] Color tokens grid (every token from §1.3, with hex/rgba and contrast ratios annotated)
- [ ] Typography specimen (every role from §1.4)
- [ ] Spacing scale ruler
- [ ] Radius scale samples
- [ ] Shadow stack samples (generic and glass-specific)
- [ ] Glass treatment anatomy diagram (5-layer stack annotated)
- [ ] Iconography sample sheet
- [ ] Light + dark mode token mapping

## 10.2 Component library page
- [ ] Every component from Section 3 with every variant, size, and state
- [ ] Glass-treatment variant for every component that has one
- [ ] Mobile + web variants for every component that diverges
- [ ] Microinteraction prototypes for the 10 most-used components

## 10.3 Sitemap diagram
- [ ] Full IA tree from §4.1 rendered as a navigable diagram

## 10.4 Screen mockups (mobile)
- [ ] Every screen in Section 5 at default mobile breakpoint (`sm` 376 px)
- [ ] Every state per screen (default · loading · empty · error · partial · permission-denied · offline where relevant)
- [ ] Light + dark mode for every public-facing screen

## 10.5 Screen mockups (tablet)
- [ ] Every screen at `md` (720 px) where layout meaningfully differs

## 10.6 Screen mockups (desktop)
- [ ] Every screen at `xl` (1280 px) — sidebar layout
- [ ] Every state per screen

## 10.7 Screen mockups (wide desktop)
- [ ] Every screen at `xxl` (1600 px) where layout meaningfully differs

## 10.8 User journey flow diagrams
- [ ] Every journey from Section 6 (companion file) rendered as a flow diagram with linked screen frames

## 10.9 Microcopy applied
- [ ] No Lorem ipsum anywhere
- [ ] Every visible string from Section 7 applied verbatim or producer-approved alternative
- [ ] Sample data realistic, currency-aware, never dating-themed
- [ ] At least 3 sample organisers / brands designed to feel real (varied geographies, varied event types)

## 10.10 Accessibility annotations
- [ ] Focus order layer
- [ ] ARIA roles annotated
- [ ] Contrast checks passed on every text/bg pair
- [ ] Reduced motion variant called out where motion is critical to affordance
- [ ] Reduced transparency variant called out for at least 5 representative screens

## 10.11 Motion / prototype
- [ ] Onboarding 4-step transition prototype
- [ ] Event creator 7-step transition prototype (mobile)
- [ ] Bottom-tab spotlight motion prototype
- [ ] Scanner success / duplicate / fail micro-interaction prototypes
- [ ] Public-page hero + sticky-buy-CTA scroll motion
- [ ] Real-time order insert animation prototype
- [ ] Account deletion type-to-confirm + hold-to-confirm prototype
- [ ] Glass-on-glass nesting animation (e.g., dropdown over header)
- [ ] Pull-to-refresh prototype
- [ ] Swipe-to-action on order/guest row prototype

## 10.12 Asset export specs
- [ ] App icon (every size for iOS / Android / web favicon)
- [ ] Splash screens (every device)
- [ ] OG card template (1200×630)
- [ ] App Store screenshots (6 per locale, per device size)
- [ ] Play Store screenshots
- [ ] Web favicon set
- [ ] Mingla M monogram in SVG + PNG

---

# Section 11 — Open Design Questions

These require founder decision before mockup work proceeds beyond first draft. Each carries a recommendation.

## Q1 — Icon family

**Question:** Phosphor Icons (regular weight default, broad and modern) vs Ionicons (already in `mingla-business/package.json`, parity with consumer)?
**Implications:** Phosphor offers a more deliberate, futuristic look — but adds a dep and forces consumer-app to follow eventually. Ionicons is the path of least resistance.
**Recommendation (HIGH):** Phosphor Icons. The futuristic aesthetic warrants a deliberate icon family; Ionicons reads generic. Consumer can migrate later — design tokens live in their own constant file, no breaking change.
**Decision-by:** Mockup style guide page (before component library work begins).

## Q2 — Public-page web stack

**Question:** Render public pages (event / brand / organiser) via Expo Web (single codebase, parity simple) or Next.js (better SEO, faster cold load)?
**Implications:** Expo Web makes parity trivial but bundle size and SEO are weaker. Next.js gets best SEO but doubles the codebase and breaks single-source-of-truth.
**Recommendation (MEDIUM):** Expo Web for MVP. Public pages on Mingla aren't yet competing for organic SEO; share-link UX matters most and Expo Web is fine. Re-evaluate at M14 if marketing pushes SEO.
**Decision-by:** M0 (per BUSINESS_STRATEGIC_PLAN Q1).

## Q3 — Slug strategy

**Question:** Random short slug (`/e/lonelymoth`), vanity slug (organiser-chosen), or both?
**Implications:** Random is collision-safe but ugly. Vanity is brandable but invites squatting. Both lets organiser pick at create time and override later.
**Recommendation (HIGH):** Both with random default. Auto-generated 6-char slug at creation; brand admin can override to a vanity slug up to 32 chars. Old slugs 301-redirect after override.
**Decision-by:** Per BUSINESS_STRATEGIC_PLAN Q8 — by M7 (Public Pages).

## Q4 — Brand vs Account profile

**Question:** Public organiser page (account-level) — ship in MVP or defer?
**Implications:** Multi-brand organisers want one URL that aggregates; single-brand organisers don't need it. Adds complexity to public IA.
**Recommendation (MEDIUM):** Defer to post-MVP. Brand pages cover 90% of cases; revisit when ≥10% of organisers run multiple brands.
**Decision-by:** Mockup phase before screen 5.6.8 is committed.

## Q5 — Light vs dark default for organiser dashboard

**Question:** Organiser screens dark-default (matches consumer aesthetic and event-night use) vs light-default (matches typical SaaS dashboard expectations)?
**Implications:** Dark feels distinctive and brand-aligned; light feels familiar and reduces friction for partners coming from Eventbrite / OpenTable.
**Recommendation (HIGH):** Dark-default with no light-mode toggle in MVP. The aesthetic is the differentiator. Light-mode comes in a future "appearance" setting if data shows demand.
**Decision-by:** Mockup phase before any organiser-side screen is committed.

## Q6 — Display font

**Question:** Use Inter Display (free, ships with Inter family) or license a brand display face (Söhne, GT Walsheim, etc.)?
**Implications:** Inter Display is fine; a brand face adds character but adds licensing cost and load weight.
**Recommendation (MEDIUM):** Inter Display for MVP. Revisit when brand work formalises a wordmark/typographic identity.
**Decision-by:** Mockup style guide.

## Q7 — Organiser display name vs brand name

**Question:** When publishing an event, should the public page show the brand name only, or also the organiser-account display name (e.g., "Lonely Moth · by Sara Olsen")?
**Implications:** Multi-brand orgs may want brand-only. Single-person operators may benefit from personal credit.
**Recommendation (MEDIUM):** Show brand name dominantly; organiser name in small print under organiser-contact card on public page only. Settable per event.
**Decision-by:** Public page mockup.

## Q8 — Tax / VAT model

**Question:** Mingla calculates tax/VAT centrally (knows organiser jurisdiction and adjusts) or organiser configures their own per-event rate?
**Implications:** Central is more accurate but a major engineering lift. Per-event-rate is simpler but error-prone.
**Recommendation (HIGH):** Per-event organiser-configured tax rate (with brand-level default) for MVP. Show clearly on the buyer's order summary. Revisit central tax engine post-MVP when geographic concentration emerges.
**Decision-by:** Per BUSINESS_STRATEGIC_PLAN Q10 — by M0.

## Q9 — Bottom tab order at launch

**Question:** Locked order Home / Events / Chat / Account, but Chat is locked until M20 — does the tab still occupy the slot or do we ship a 3-tab layout (Home / Events / Account) until M20?
**Implications:** Reserving the slot foreshadows the chat agent and reduces a future re-layout. Hiding it preserves real-estate for now.
**Recommendation (HIGH):** Reserve the slot from MVP day 1. The "coming soon" placeholder primes organisers for the eventual feature and avoids a disruptive re-layout at M20.
**Decision-by:** First mockup of bottom tab.

## Q10 — Verified / Curated brand badge — when does it apply?

**Question:** Verified badge (Mingla Curated) — automatic, manual review, or paid tier?
**Implications:** Automatic is gameable. Manual is slow. Paid is honest but limits adoption.
**Recommendation (MEDIUM):** Defer the badge to post-MVP. Don't ship the visual during MVP if the criteria aren't locked.
**Decision-by:** Optional — design the badge but conditionally hide.

---

# Section 12 — Source Evidence Trail

> Every consumer-app citation in this spec, with file path + line number where the value was extracted. The Forensics Phase 0 ingest used `app-mobile/src/constants/designSystem.ts` and component sources as authoritative truth (last-writer-wins per Mingla's migration-chain rule, applied here to the design tokens file).

## 12.1 Color tokens — source citations

| Token | Source |
|-------|--------|
| `primary.500: #f97316` | `app-mobile/src/constants/designSystem.ts:101` |
| `primary.600: #ea580c` | `app-mobile/src/constants/designSystem.ts:102` |
| `primary.700: #c2410c` | `app-mobile/src/constants/designSystem.ts:103` |
| `accent.warm: #eb7825` | `app-mobile/src/constants/designSystem.ts:193` |
| `gray.50: #f9fafb` | `app-mobile/src/constants/designSystem.ts:164` |
| `gray.900: #111827` | `app-mobile/src/constants/designSystem.ts:173` |
| `canvas.discover: rgba(12, 14, 18, 1)` | `app-mobile/src/constants/designSystem.ts:561` |
| `canvas.profile: rgba(20, 17, 19, 1)` | `app-mobile/src/constants/designSystem.ts:762` |
| Glass tint floors (badge / chrome / backdrop / profile) | `app-mobile/src/constants/designSystem.ts:318, 382, 551, 782, 803` |
| Glass borders | `app-mobile/src/constants/designSystem.ts:322, 394, 785, 806` |
| Glass top-highlights | `app-mobile/src/constants/designSystem.ts:323, 787, 808` |
| Active accent tint | `app-mobile/src/constants/designSystem.ts:407` |
| Active accent border | `app-mobile/src/constants/designSystem.ts:408` |
| Active accent glow | `app-mobile/src/constants/designSystem.ts:409–411` |
| Semantic success / warning / error | `app-mobile/src/constants/designSystem.ts:129, 142, 155` |
| Light-mode bg + warm-glow | `mingla-business/src/constants/designSystem.ts:54–68` |

## 12.2 Typography tokens — source citations

| Token | Source |
|-------|--------|
| Type scale (xs–xxxl) | `app-mobile/src/constants/designSystem.ts:55–84` |
| Font weights regular / medium / semibold / bold | `app-mobile/src/constants/designSystem.ts:87–90` |
| Profile screen specific (hero name, stat-value, label-cap) | `app-mobile/src/constants/designSystem.ts:830, 869, 862` |

## 12.3 Spacing & radius — source citations

| Token | Source |
|-------|--------|
| Spacing xxs–xxl | `app-mobile/src/constants/designSystem.ts:6–14` |
| Radius sm–full | `app-mobile/src/constants/designSystem.ts:16–22` |
| Component-specific overrides (badge, pill, profile-card) | `app-mobile/src/constants/designSystem.ts:336–344, 489–511, 789–811` |

## 12.4 Shadows — source citations

| Token | Source |
|-------|--------|
| Generic shadows sm–xl | `app-mobile/src/constants/designSystem.ts:24–53` |
| Glass shadow stack | `app-mobile/src/constants/designSystem.ts:284–290, 396–412, 793–820` |

## 12.5 Glass treatment values — source citations

| Surface | Source |
|---------|--------|
| Badge intensity 24, dark | `app-mobile/src/constants/designSystem.ts:314–315` |
| Chrome intensity 28, dark | `app-mobile/src/constants/designSystem.ts:378–379` |
| Backdrop intensity 22, fade height 20 | `app-mobile/src/constants/designSystem.ts:550–552` |
| Profile card base / elevated intensity 30 / 34 | `app-mobile/src/constants/designSystem.ts:784, 805` |

## 12.6 Component anatomies — source files

| Component | Source |
|-----------|--------|
| GlassBadge | `app-mobile/src/components/.../GlassBadge.tsx:113–141, 211–275` |
| GlassCard | `app-mobile/src/components/.../GlassCard.tsx:75–146` |
| GlassTopBar | `app-mobile/src/components/.../GlassTopBar.tsx:119–151, 161–205` |
| GlassSessionSwitcher | `app-mobile/src/components/.../GlassSessionSwitcher.tsx:154–303, 338–360` |
| GlassBottomNav | `app-mobile/src/components/.../GlassBottomNav.tsx:142–272` |
| GlassIconButton | `app-mobile/src/components/.../GlassIconButton.tsx:143–252` |

## 12.7 Motion tokens — source citations

| Token | Source |
|-------|--------|
| Show / hide chrome durations 260 / 180 ms | `app-mobile/src/constants/designSystem.ts:521–522` |
| Press 120 ms | `app-mobile/src/constants/designSystem.ts:361, 524` |
| Stagger 40 ms | `app-mobile/src/constants/designSystem.ts:359` |
| Spring bottom-nav (damping 18, stiffness 260, mass 0.9) | `app-mobile/src/constants/designSystem.ts:530–532` |
| Save bounce (damping 12, stiffness 280, max 1.15) | `app-mobile/src/constants/designSystem.ts:748–750` |
| Profile card stagger 60 ms, entry 280 ms, tap 100 ms, sheet 320 ms | `app-mobile/src/constants/designSystem.ts:1074–1078` |

## 12.8 Existing Business design tokens — source citations

| Token | Source |
|-------|--------|
| Business spacing scale | `mingla-business/src/constants/designSystem.ts:5–12` |
| Business radius scale | `mingla-business/src/constants/designSystem.ts:14–20` |
| Business shadows (sm, md only — extend) | `mingla-business/src/constants/designSystem.ts:22–37` |
| Business colors | `mingla-business/src/constants/designSystem.ts:46–65` |
| Business warm-glow | `mingla-business/src/constants/designSystem.ts:68` |

## 12.9 Planning trinity — source documents

| Doc | Path |
|-----|------|
| Business PRD | `Mingla_Artifacts/BUSINESS_PRD.md` |
| Business Strategic Plan | `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md` |
| Business Project Plan | `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md` |
| Forensics Dispatch Prompt | `Mingla_Artifacts/prompts/SPEC_BUSINESS_DESIGN_SYSTEM_AND_SCREENS.md` |

## 12.10 Memory rules applied

| Rule | Source |
|------|--------|
| Mingla = experience / date-planning, not dating | `MEMORY.md` → `feedback_mingla_positioning.md` |
| Currency-aware UI | `MEMORY.md` → constitutional compliance |
| Founder voice / no jargon | `MEMORY.md` → `feedback_layman_first.md` |
| Detail in files / summary in chat | `MEMORY.md` → `feedback_short_responses.md` |
| Forbidden imports (board / pairing / recommendations / boardDiscussion) | `MEMORY.md` → project_business_plans, business_chat_agent_strategy |
| VS Code markdown rendering | `MEMORY.md` → `feedback_vscode_markdown.md` |

---

**End of `SPEC_BUSINESS_DESIGN_SYSTEM_AND_SCREENS.md`. The companion file `SPEC_BUSINESS_USER_JOURNEYS.md` carries Section 6.**




