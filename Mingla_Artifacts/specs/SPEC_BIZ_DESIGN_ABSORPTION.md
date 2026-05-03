# SPEC — Design Package Absorption Patch Set

> **Mode:** Forensics SPEC (companion to `reports/AUDIT_BIZ_DESIGN_PACKAGE_ABSORPTION.md`)
> **ORCH-ID:** ORCH-BIZ-DESIGN-AUDIT-001
> **Status:** READY-TO-APPLY pending founder approval of audit report §6 questions Q-A1 through Q-A14.
> **How to use:** Orchestrator applies patches under SYNC mode after founder signs off the questions. Each patch is precise: file path, section, action, before/after, source citation, verdict.

---

## How to read this spec

Each patch follows this format:

```
### Patch P-NN
File: [absolute Mingla_Artifacts path]
Section: [exact heading or location]
Action: ADD | MODIFY | DELETE | RENAME | REWRITE-SECTION
Source: [design-package file + reference]
Verdict: KEEP | TUNE | DISCARD-FOR-MVP
Before:
  [literal existing text — verbatim]
After:
  [literal new text — verbatim]
Notes: [optional context]
```

Patches are gated on founder Q-A decisions. Each patch references the Q-A number that authorizes it. If a Q-A is rejected, the corresponding patch does not apply.

Unique patch IDs: `P-NN`. Hundreds: `1xx` = PRD, `2xx` = Strategic Plan, `3xx` = Project Plan, `4xx` = Designer Handoff, `5xx` = Decisions Log, `6xx` = cleanup operations.

---

## Section 1 — `BUSINESS_PRD.md` patches

### Patch P-101
File: `Mingla_Artifacts/BUSINESS_PRD.md`
Section: §3.1 Create Events
Action: REWRITE-SECTION (step labels)
Source: `design-package/project/screens-creator.jsx` lines 9–17 (`stepDefs`)
Verdict: TUNE (Q-A10)

Before:
```
- Create a new event
- Choose an animated GIF from a built-in library
- Upload a custom event image
- Upload a custom event video
- Set event media as the event header
- Choose a custom font for the event page
- Choose a color preset
- Input a custom event color
- Add event title
- Edit event title inline
- Add event description
- Add event location
- Add event date and time
- Create one-off events
- Create recurring events
- Create multiple-date events
- Create single-date events
- Duplicate event information across multiple dates
- Edit details per event date
- Show event on discover screen toggle
- Show event in swipeable deck toggle
- Add organiser contact
- Add organiser name
- Add organiser picture
- Add organiser phone number
- Add organiser email address
- Preview public event page
- Publish event
- Save event as draft
- Edit event page after publishing
```

After:
```
The event creator is a 7-step wizard with the following step labels (canonicalised per
DEC-065 from design-package screens-creator.jsx):

**Step 1 — Basics:** Name, format, and category. (Title, description, event type)
**Step 2 — When:** Date, time, and recurrence. (Single, recurring, multi-date; per-date overrides)
**Step 3 — Where:** Venue or online link. (Geocoded location picker, online toggle, hybrid)
**Step 4 — Cover:** Image, video, or GIF. (Built-in GIF library; custom image / video upload)
**Step 5 — Tickets:** Types, prices, capacity. (Inline create/edit; advanced flags collapsible)
**Step 6 — Settings:** Visibility, approvals, transfers. (Public / Discover / swipeable-deck toggles; password / approval-required flags; transfer policy)
**Step 7 — Preview:** How it looks to guests. (Live preview of public event page; Save Draft / Publish gate)

All sub-fields from the original list remain feature requirements (theme color preset, custom color, organiser contact name/photo/phone/email, edit-after-publish, save-as-draft). They are now organised under the 7 steps above.
```

Notes: This rewrite collapses 30 line items into the 7 wizard steps without losing any feature. Verbatim sub-fields are preserved in narrative form.

---

### Patch P-102
File: `Mingla_Artifacts/BUSINESS_PRD.md`
Section: §5 Event Management — under heading "Event overview"
Action: ADD line item
Source: `design-package/project/screen-events-list.jsx` (entire file)
Verdict: KEEP (Q-A5)

Before:
```
Event overview
```

After:
```
Event overview

(NEW per DEC-060) An Events List screen sits at the Events tab root, listing every event the
brand has created with filter pills (All / Live / Upcoming / Drafts / Past) and a per-row
Manage menu offering: Edit details · View public page · Open scanner · Orders · Copy share
link · Publish event (drafts) · End ticket sales (live) · Duplicate · Delete event · Issue
refunds (past). Tapping a row opens Event Detail. Tapping `⋯` opens the action menu without
navigating away.
```

---

### Patch P-103
File: `Mingla_Artifacts/BUSINESS_PRD.md`
Section: §6 (Public Pages — implied; PRD has it as part of broader "Event creation" section)
Action: ADD new sub-section
Source: `design-package/project/screen-public-brand.jsx` (entire file)
Verdict: KEEP (Q-A4)

Before:
```
[end of §3.1 Create Events sub-section]
```

After:
```
### Public Brand Page (`mingla.com/[brand-slug]`)

(NEW per DEC-059, in MVP scope at M7) Each brand has a public storefront page reachable
at the brand slug URL. The page surfaces:
- Cover band (gradient + grain texture branding canvas)
- Brand identity card (logo, name, verified tick, handle, location)
- Bio text
- Stats strip (followers, events, rating)
- Follow + notify CTAs
- Tabs: Upcoming · Past · About
- Upcoming events list with cover thumbs, dates, prices, "X left / Half full / SOON" status
- Footer trust strip (refund policy, house rules, report, "Verified host on Mingla since YYYY")

Public event pages link to the public brand page via the organiser-contact card. Reachable
from Event Detail "Brand page" tile and Account → tap a brand row.
```

---

### Patch P-104
File: `Mingla_Artifacts/BUSINESS_PRD.md`
Section: Bottom-tab nav declaration (was implicit; needs explicit section)
Action: ADD new sub-section after Account features
Source: `design-package/project/chrome.jsx` lines 113–162 (BottomNav)
Verdict: TUNE (Q-A1, Q-A2, Q-A3)

Before:
```
[end of §1 Account Features]
```

After:
```
### Bottom Navigation (locked per DEC-058)

The mobile bottom-nav is a 5-tab capsule:

1. **Home** — at-a-glance dashboard (current brand + KPIs)
2. **Events** — event list per current brand (with per-row Manage menu)
3. **Scan** — scanner mode + door operations (active for all roles; event-picker for
   non-scanner roles, direct camera for scanner role)
4. **Marketing** — Post-MVP (M14+); rendered as locked-state placeholder during M0–M13
   with copy "Marketing tools — coming in M14. We're polishing the foundation first."
5. **Account** — profile, settings, brand switcher entry, sign out, delete

Brand chip in the TopBar (avatar + brand name + chevron-down) opens BrandSwitcherSheet
from any primary tab (per DEC-061).

The Chat tab from the original 4-tab plan is folded into a future tab-swap at M19+ when
the chat agent ships, or it remains absorbed into Account.
```

---

### Patch P-105
File: `Mingla_Artifacts/BUSINESS_PRD.md`
Section: §11 Permissions and Access Control
Action: ADD note
Source: AUDIT §4.3 Permissions row (DESIGN-PACKAGE-SILENT)
Verdict: TUNE (Q-A12 indirectly; permissions UI design-time work in M12)

Before:
```
Activity logs for staff actions
Audit trail for sensitive actions
```

After:
```
Activity logs for staff actions
Audit trail for sensitive actions

(NOTE: Permissions UI is DESIGN-PACKAGE-SILENT — the design package does not include
team-list / role-detail screens. M12 implementor will design these from handoff §5.11
and product judgment.)
```

---

### Patch P-106
File: `Mingla_Artifacts/BUSINESS_PRD.md`
Section: §99 Decisions Log
Action: ADD entries
Source: AUDIT §10 draft DEC-057–DEC-069
Verdict: KEEP

Before:
```
| 2026-04-28 | Co-pilot model adopted for the chat agent | ... |
```

After:
```
| 2026-04-28 | Co-pilot model adopted for the chat agent | ... |
| 2026-04-28 | DEC-057–DEC-069: Design package absorbed; 5-tab nav, Public Brand Page in MVP, Events list w/ Manage menu, brand-switcher topbar trigger, status pill copy, KPI vocabulary, onboarding 4-step, wizard step labels, microcopy canonical, sample data canonical, Mingla M monogram v1, icon family v1 | See `Mingla_Artifacts/DECISION_LOG.md` DEC-057–DEC-069 for full context. |
```

---

## Section 2 — `BUSINESS_STRATEGIC_PLAN.md` patches

### Patch P-201
File: `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`
Section: §9 Open Strategic Questions — Q5
Action: REWRITE (mark resolved)
Source: AUDIT §4.1 Tokens row (canvas / mode); design package dark-default throughout
Verdict: KEEP (decision closed)

Before:
```
| Q5 | Light vs dark default for organiser dashboard ... | M0 |
```

After:
```
| Q5 | RESOLVED 2026-04-28 (DEC-058): Dark-default for organiser dashboard surfaces. Public-facing pages ship in both light and dark with brand-theme accent overrides. | RESOLVED |
```

---

### Patch P-202
File: `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`
Section: §9 — Q9 (Geographic scope)
Action: REWRITE (mark partially resolved)
Source: design package sample data uses £; runtime Intl.NumberFormat preserves international support
Verdict: TUNE

Before:
```
| Q9 | Geographic scope for MVP — UK only, US only, both, global? | M0 |
```

After:
```
| Q9 | RESOLVED 2026-04-28: UK-baseline for sample data + initial launch market. Runtime uses Intl.NumberFormat for currency display so US / EU / global expansion is feature-flag-flippable. Stripe Connect Standard supports UK + US + EU + 35+ countries from day one. | M3 (Stripe-config moment) |
```

---

### Patch P-203
File: `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`
Section: §9 — Q10 (Tax/VAT)
Action: REWRITE (mark resolved)
Source: AUDIT §6 Founder-decision queue (Q-A is silent; default to per-event organiser-configured rate)
Verdict: TUNE

Before:
```
| Q10 | Tax/VAT — does Mingla calculate, or does the organiser configure their own rates per event? | M0 |
```

After:
```
| Q10 | RESOLVED 2026-04-28: Per-event organiser-configured tax rate (with brand-level default). Mingla central tax engine deferred to post-MVP when geographic concentration emerges. Order summary line displays tax explicitly to the buyer. | RESOLVED |
```

---

### Patch P-204
File: `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`
Section: §6 Risks — append new risk
Action: ADD risk row
Source: AUDIT §12 D-7 (sample data + fixed dates can stale)
Verdict: KEEP

Before:
```
| R14 | ... | Marketing is Post-MVP. ... |
```

After:
```
| R14 | ... | Marketing is Post-MVP. ... |
| R15 | **Sample data and demo dates freeze stale** — design package uses fixed dates (FRI 15 MAY, SUN 17 MAY) and revenue figures (£8,420). If hardcoded into mockups or screenshots used in App Store / Play Store / marketing, those frozen artifacts become misleading 6+ months later. | M | M | All sample data including dates is generated at runtime as `today + N days`. Revenue figures are populated from an in-memory demo state, not hardcoded into stored mocks. App Store screenshots use the runtime-generated values. |
```

---

### Patch P-205
File: `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`
Section: §5 Milestones — M0 row
Action: MODIFY (add design absorption to outcome)
Source: AUDIT §8 Cycle 1
Verdict: KEEP

Before:
```
| **M0** | Foundations & infra | Mobile/web parity rig, Supabase types codegen, React Query, Zustand, design tokens, error boundaries, Sentry, test rigs, audit-log table | 1 week |
```

After:
```
| **M0** | Foundations & infra | Mobile/web parity rig, Supabase types codegen, React Query, Zustand, **design tokens absorbed from Claude Design package** (full token set, glass utility primitives, MinglaMark monogram, 60+ icon SVG library, 5-tab BottomNav with config prop, TopBar with brand chip, IconChrome, Button/Pill/Input primitives), error boundaries, Sentry, test rigs, audit-log table | 1.5 weeks (added 0.5 week for design absorption) |
```

---

### Patch P-206
File: `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`
Section: §5 Milestones — M9 row
Action: MODIFY (call out Events List as discrete deliverable)
Source: AUDIT §8 Cycle 10
Verdict: KEEP

Before:
```
| **M9** | Event management | Event overview, orders dashboard, search/filter/export, refunds, guest list mgmt, manual check-in | 2 weeks |
```

After:
```
| **M9** | Event management | **Events List screen with filter pills + per-event Manage menu (DEC-060)**, Event Overview, Orders dashboard with refunds, Order Detail with refund sheet, Guests List with approval queue, manual check-in, search/filter/export | 2.5 weeks (added 0.5 week for Events List + Manage menu) |
```

---

### Patch P-207
File: `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`
Section: §5 Milestones — M7 row
Action: MODIFY (Public Brand Page in scope)
Source: AUDIT §6 Q-A4
Verdict: KEEP

Before:
```
| **M7** | Public pages | Public event page, brand page, organiser page — mobile + web parity, OG tags, canonical URLs | 1 week |
```

After:
```
| **M7** | Public pages | **Public Event Page (per design-package PublicEventScreen)**, **Public Brand Page (`mingla.com/[brand-slug]` per design-package PublicBrandScreen, DEC-059)**, **Public Organiser Page** (account-level showcase if shipped — pending Q-A4 founder decision), mobile + web parity, OG tags, canonical URLs, share modal | 1.5 weeks (added 0.5 week for Public Brand Page) |
```

---

## Section 3 — `BUSINESS_PROJECT_PLAN.md` patches

### Patch P-301
File: `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md`
Section: Part A.4 Repository Layout (Target State at MVP) — under `app/`
Action: REWRITE-SECTION (update tab routes to 5-tab)
Source: `design-package/project/app.jsx` route table
Verdict: TUNE (Q-A1)

Before:
```
│   ├─ (tabs)/                           NEW
│   │   ├─ _layout.tsx                   NEW (bottom-tab nav)
│   │   ├─ home.tsx                      MOVED + rebuilt (dashboard)
│   │   ├─ events.tsx                    NEW
│   │   ├─ chat.tsx                      NEW (placeholder until M20)
│   │   └─ account.tsx                   NEW
```

After:
```
│   ├─ (tabs)/                           NEW
│   │   ├─ _layout.tsx                   NEW (5-tab BottomNav per DEC-058; tabs config prop)
│   │   ├─ home.tsx                      NEW (HomeScreen — KPIs + Live tonight + Upcoming + Build CTA)
│   │   ├─ events.tsx                    NEW (EventsListScreen — filter pills + per-row Manage menu, DEC-060)
│   │   ├─ scan.tsx                      NEW (Scanner-mode entry — event picker for non-scanner roles)
│   │   ├─ marketing.tsx                 NEW (M0–M13: locked-state placeholder; M14+: full Marketing dashboard)
│   │   └─ account.tsx                   NEW (AccountScreen — brands list + settings + danger zone)
```

---

### Patch P-302
File: `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md`
Section: Part A.4 — under `src/components/ui/`
Action: REWRITE-SECTION (replace placeholder list with absorbed primitives)
Source: AUDIT §4.2 Components verdict
Verdict: KEEP

Before:
```
│       ├─ Button.tsx                NEW (web-aware)
│       ├─ Input.tsx                 NEW
│       ├─ Select.tsx                NEW
│       ├─ DatePicker.tsx            NEW (mobile + web)
│       ├─ ImageUpload.tsx           NEW
│       ├─ Toast.tsx                 NEW
│       ├─ Modal.tsx                 NEW (mobile sheet + web modal)
│       ├─ Table.tsx                 NEW (web data tables)
│       ├─ ErrorBoundary.tsx         NEW
│       └─ ...
```

After:
```
│       ├─ GlassCard.tsx             NEW (base + elevated; absorbed from design-package tokens.css .glass-card / .glass-card-elev)
│       ├─ GlassChrome.tsx           NEW (blur 28 + tint + border + shadow + inset highlight)
│       ├─ TopBar.tsx                NEW (brand chip variant + back-button variant; absorbed from chrome.jsx TopBar)
│       ├─ BottomNav.tsx             NEW (5-tab per DEC-058; tabs config prop; spotlight spring animation)
│       ├─ IconChrome.tsx            NEW (36×36 circular glass icon button + badge)
│       ├─ MinglaMark.tsx            NEW (32×32 SVG monogram, gradient orange #fb923c→#eb7825 per DEC-068)
│       ├─ Icon.tsx                  NEW (60+ SVG glyphs absorbed from primitives.jsx — react-native-svg port)
│       ├─ Button.tsx                NEW (primary / secondary / ghost / destructive variants)
│       ├─ Pill.tsx                  NEW (live / draft / warn / accent / error / info; live-pulse animation)
│       ├─ Input.tsx                 NEW (focus-border accent.warm; variants text/email/phone/number/password/search)
│       ├─ Toast.tsx                 NEW (top-of-screen; success/error variants; auto-dismiss)
│       ├─ Sheet.tsx                 NEW (mobile bottom-sheet; drag-handle; refund/brand-switcher consumers)
│       ├─ Modal.tsx                 NEW (web-modal centered)
│       ├─ Skeleton.tsx              NEW (shimmer animation absorbed from tokens.css)
│       ├─ Spinner.tsx               NEW
│       ├─ Stepper.tsx               NEW (wizard indicator with step segments)
│       ├─ KpiTile.tsx               NEW (stat-value + delta + sub)
│       ├─ ActionTile.tsx            NEW (icon + label + sub; primary variant glows orange)
│       ├─ EventCover.tsx            NEW (hue-driven striped placeholder; skeleton mode for failed loads)
│       ├─ StatusPill.tsx            NEW (LIVE/DRAFT/UPCOMING/ENDED/PENDING/PREVIEW/SOLD OUT per DEC-062)
│       ├─ DatePicker.tsx            NEW (mobile native; web fallback)
│       ├─ ImageUpload.tsx           NEW
│       ├─ Table.tsx                 NEW (web-only data tables; mobile collapses to lists)
│       ├─ ErrorBoundary.tsx         NEW
│       ├─ EmptyState.tsx            NEW
│       └─ ConfirmDialog.tsx         NEW (type-to-confirm + hold-to-confirm variants)
```

---

### Patch P-303
File: `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md`
Section: Part D.3 Screen-by-Screen Inventory — Brand
Action: ADD new screen entries
Source: `design-package/project/screens-brand.jsx` (BrandsListScreen, FinanceReportsScreen)
Verdict: KEEP

Before:
```
- [ ] Brand finance export
```

After:
```
- [ ] Brand finance export
- [ ] **Brands List screen** (per DEC-067) — list of all brands user owns with stats (revenue, followers, events) per brand. Tapping a row routes to Brand Profile. "+ Create new brand" tile at the end.
- [ ] **Finance Reports screen** (per design-package FinanceReportsScreen) — KPI bars, breakdown by source, top events, Stripe-ready CSV exports.
```

---

### Patch P-304
File: `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md`
Section: Part D.3 — Event Creation
Action: REWRITE-SECTION (use 7-step package labels)
Source: AUDIT §4.2 + DEC-065
Verdict: TUNE (Q-A10)

Before:
```
- [ ] Event creator screen 1 — title, description
- [ ] Event creator screen 2 — date/time (single, recurring, multi-date)
- [ ] Event creator screen 3 — location (geocoded picker, online toggle)
- [ ] Event creator screen 4 — media (image/video/GIF library + upload)
- [ ] Event creator screen 5 — theme (font + color preset + custom color)
- [ ] Event creator screen 6 — organiser contact
- [ ] Event creator screen 7 — visibility (public, discover, swipeable deck toggles)
```

After:
```
- [ ] Step 1 — **Basics** (title, description, format, category)
- [ ] Step 2 — **When** (date, time, recurrence; per-date overrides)
- [ ] Step 3 — **Where** (venue or online link; geocoded picker; hybrid mode)
- [ ] Step 4 — **Cover** (image / video / GIF library; theme color + font selection collapses here per DEC-065)
- [ ] Step 5 — **Tickets** (types, prices, capacity; advanced flags collapsible)
- [ ] Step 6 — **Settings** (visibility — Public / Discover / swipeable-deck toggles; approvals; transfers; password protection; organiser contact)
- [ ] Step 7 — **Preview** (live preview of public event page; Save Draft / Publish gate)
```

---

### Patch P-305
File: `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md`
Section: Part D.3 — Auth (existing)
Action: ADD onboarding step list
Source: `design-package/project/screens-auth.jsx` lines 70–181 (4-step OnboardingScreen)
Verdict: KEEP (Q-A9)

Before:
```
### Onboarding (M1)
- [ ] Step 1 — Welcome (founder voice copy)
- [ ] Step 2 — Confirm display name + phone (optional)
- [ ] Step 3 — Create your first brand (or skip + create later)
- [ ] Step 4 — "What kind of events do you run?" (optional, for analytics)
```

After:
```
### Onboarding (M1) — per DEC-064
- [ ] Step 1 — **Operator type** ("Independent promoter / Brand or hospitality / Lifestyle operator / Other") + display name confirmation
- [ ] Step 2 — **Create your first brand** (Brand name + subdomain check `mingla.com/<slug>` with live availability + bio)
- [ ] Step 3 — **Connect Stripe** (info card; "Connect Stripe" primary CTA OR "I'll do this later" ghost CTA — tickets stay free to publish)
- [ ] Step 4 — **You're set** (3-bullet check-list of what's done; "Build first event" primary CTA)
```

---

### Patch P-306
File: `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md`
Section: Part D.3 — Event Management
Action: ADD Events List entry
Source: `design-package/project/screen-events-list.jsx`
Verdict: KEEP (Q-A5)

Before:
```
### Event Management (M9)
- [ ] Event overview (KPIs: tickets sold, revenue, scans %, capacity)
```

After:
```
### Event Management (M9)
- [ ] **Events List screen** (per DEC-060) — landing on Events tab; filter pills (All / Live / Upcoming / Drafts / Past); per-row Manage menu with Edit details / View public page / Open scanner / Orders / Copy share link / Publish / End ticket sales / Duplicate / Delete event / Issue refunds; tap-row routes to Event Detail
- [ ] Event overview (KPIs: tickets sold, revenue, scans %, capacity)
```

---

### Patch P-307
File: `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md`
Section: Part G — M0 task list
Action: REWRITE-SECTION (UI primitives task list per design package)
Source: AUDIT §8 Cycle 1
Verdict: KEEP

Before:
```
### UI primitives
- [ ] `Button` (mobile + web with hover/focus states)
- [ ] `Input`, `Textarea`, `Select`
- [ ] `DatePicker` (mobile native + web fallback)
- [ ] `ImageUpload` (mobile + web drag-drop)
- [ ] `Toast` + `ToastContext`
- [ ] `Modal` (mobile sheet + web modal)
- [ ] `Table` (web data table; mobile list)
- [ ] `ErrorBoundary` (top-level + route-level)
- [ ] `EmptyState`
- [ ] `ConfirmDialog` (type-to-confirm + hold-to-confirm)
```

After:
```
### UI primitives (absorbed from design package per DEC-057)
- [ ] Port `tokens.css` to `src/constants/designSystem.ts` extending the existing file additively (preserve every rgba value verbatim; rename CSS-kebab to TS-camelCase). Include glass utility primitives (.glass-chrome / .glass-card / .glass-card-elev / .glass-badge) as React Native components.
- [ ] `MinglaMark` (32×32 SVG, gradient `linear-gradient(135deg, #fb923c, #eb7825)`, white M path stroke 2px) per DEC-068
- [ ] `Icon` (60+ SVG glyphs ported to `react-native-svg` from design-package primitives.jsx; named: home / calendar / chat / user / plus / chevR / chevL / chevD / chevU / close / check / search / bell / qr / scan / share / edit / pound / trash / settings / google / apple / arrowL / moreH / flash / location / clock / ticket / eye / cash / tap / list / grid / refund / sparkle / flag / flashOn / keypad / backspace / star / mail / sms / chart / pieChart / funnel / link / users / tag / send / play / pause / template / upload / download / filter / branch / shield / receipt / bank / nfc / swap / target / calendarPlus / globe / rocket / notebook / award / trending / inbox)
- [ ] `GlassCard` (base + elevated variants; 5-layer stack from handoff §1.7.3)
- [ ] `GlassChrome` (top-bar / bottom-nav / pill-switcher wrapper)
- [ ] `TopBar` (brand-chip + back-button variants; chevron-down brand chip opens BrandSwitcherSheet per DEC-061)
- [ ] `BottomNav` (5-tab capsule per DEC-058; `tabs` config prop accepting 4-tab fallback; spotlight spring animation damping 18 stiffness 260 mass 0.9)
- [ ] `IconChrome` (36×36 circular glass icon button; badge slot)
- [ ] `Button` (primary / secondary / ghost / destructive; sizes sm/md/lg)
- [ ] `Pill` (live / draft / warn / accent / error / info; live-pulse animation)
- [ ] `Input` (text / email / phone / number / password / search; focus border accent.warm 1.5px)
- [ ] `StatusPill` (LIVE / DRAFT / UPCOMING / ENDED / PENDING / PREVIEW / SOLD OUT per DEC-062)
- [ ] `KpiTile` (label + stat-value + delta + sub)
- [ ] `ActionTile` (icon + label + sub; primary variant glows orange)
- [ ] `EventCover` (hue-driven striped placeholder; production replaces with organiser-uploaded media)
- [ ] `Toast` (top-of-screen; success/error variants; auto-dismiss 2.6s)
- [ ] `Sheet` (mobile bottom-sheet; drag handle; backdrop blur)
- [ ] `Modal` (web centered; scrim)
- [ ] `Skeleton` (shimmer animation 1.4s linear infinite)
- [ ] `Spinner`, `Stepper`, `EmptyState`, `ErrorBoundary`, `ConfirmDialog` (type-to-confirm + hold-to-confirm)
- [ ] Storybook-style `__styleguide.tsx` route (gated to `__DEV__`) rendering every primitive variant for founder QA
```

---

### Patch P-308
File: `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md`
Section: Part G — M1 task list (Account lifecycle)
Action: ADD design absorption to UI section
Source: AUDIT §8 Cycle 2
Verdict: KEEP

Before:
```
### UI — mobile + web
- [ ] Onboarding screens 1–4 (welcome, name/phone, brand-create CTA, event-type)
- [ ] Account home screen
- [ ] Edit profile screen
- [ ] Settings screen (notifications, locale, timezone)
- [ ] Delete account flow (4 screens + confirm) with consequences UX
```

After:
```
### UI — mobile + web (per design package + DEC-064)
- [ ] **AuthScreen** absorbed from design-package screens-auth.jsx — light + warm-glow gradient, MinglaMark hero, headline "Welcome to Mingla Business," 3 CTAs (Continue with Google / Apple / email), Terms & Privacy footnote
- [ ] **OnboardingScreen 4 steps** absorbed from design-package OnboardingScreen — Operator type / Brand creation w/ live URL availability / Stripe (deferrable) / Ready confirmation
- [ ] **AccountScreen** absorbed from design-package screens-ops.jsx — avatar + name + role pill / Brands section with multi-brand list + "Manage all brands" + "Add a brand" / Account settings rows / Danger zone Delete account button
- [ ] **DeleteScreen 4 steps** absorbed from design-package DeleteScreen — Step 1 warning + bullets / Step 2 affected-brands list / Step 3 type-DELETE input / Step 4 scheduled-deletion confirmation
- [ ] Edit profile screen (DESIGN-PACKAGE-SILENT — design new from handoff §5.2.2)
- [ ] Settings screen (notifications, locale, timezone — DESIGN-PACKAGE-SILENT — design new from handoff §5.2.3)
```

---

## Section 4 — `handoffs/HANDOFF_BUSINESS_DESIGNER.md` patches

### Patch P-401
File: `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md`
Section: §5.4.1.1 through §5.4.1.7 (event creator step labels)
Action: REWRITE-SECTION
Source: design-package screens-creator.jsx step labels
Verdict: TUNE (Q-A10)

Before: (each step's heading)
```
### 5.4.1.1 Step 1 — Title + description
### 5.4.1.2 Step 2 — Date/time
### 5.4.1.3 Step 3 — Location
### 5.4.1.4 Step 4 — Cover media
### 5.4.1.5 Step 5 — Theme
### 5.4.1.6 Step 6 — Organiser contact
### 5.4.1.7 Step 7 — Visibility
```

After:
```
### 5.4.1.1 Step 1 — Basics (title + description + format + category)
### 5.4.1.2 Step 2 — When (date / time / recurrence)
### 5.4.1.3 Step 3 — Where (venue or online link)
### 5.4.1.4 Step 4 — Cover (image / video / GIF; theme color + font selection collapses here per DEC-065)
### 5.4.1.5 Step 5 — Tickets (types / prices / capacity; advanced flags collapsible)
### 5.4.1.6 Step 6 — Settings (visibility / approvals / transfers / password / organiser contact)
### 5.4.1.7 Step 7 — Preview (live render + Save Draft / Publish gate)
```

---

### Patch P-402
File: `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md`
Section: §5.12.1 Chat tab locked-state copy
Action: MODIFY (replace placeholder copy with package's tighter version)
Source: design-package screens-ops.jsx ChatScreen
Verdict: KEEP (Q-A11)

Before:
```
**Mobile:** glass card centered with illustration · h2 "Coming soon" · body "Describe your event in one sentence and we'll build it. We're polishing the experience first."
```

After:
```
**Mobile:** glass card centered · sparkle icon in circular glass-card-elev container · h2 "Chat is on the way" · body "An AI co-pilot that helps you draft event copy, answer guest questions, and run campaigns. We'll switch this on in a future release." · "Get early access" secondary CTA
```

---

### Patch P-403
File: `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md`
Section: §5.3 Brand domain
Action: ADD entries (Brands List + Finance Reports screens)
Source: design-package screens-brand.jsx
Verdict: KEEP (DEC-067)

Before:
```
### 5.3.10 `/brand/:brandId/team/invite` — Invite teammate
```

After:
```
### 5.3.10 `/brand/:brandId/team/invite` — Invite teammate
[existing content]

### 5.3.13 `/brand/list` — Brands List (NEW per DEC-067)
**Purpose:** List of every brand the account owner / admin has access to.
**Mobile:** scrollable list of brand cards (avatar + name + stats: revenue / followers / events).
Tapping a row routes to Brand Profile. "+ Create new brand" tile at the bottom.
**Reachable from:** Account → "Manage all brands" row, BrandSwitcherSheet → "Manage" CTA.

### 5.3.14 `/brand/:brandId/payments/reports` — Finance Reports (NEW)
**Purpose:** KPI bars, breakdown by source, top events, Stripe-ready CSV exports for the
finance manager role.
**Mobile:** KPI tiles row (Gross / Net / Refunded / Fees) · breakdown chart · top events
list · Export CSV button.
**Reachable from:** Brand Payments → "Reports" CTA.
```

---

### Patch P-404
File: `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md`
Section: §1.9.3 Custom icons (MinglaMark)
Action: REWRITE (concrete instantiation per DEC-068)
Source: design-package primitives.jsx MinglaMark
Verdict: KEEP

Before:
```
- **Mingla M monogram** — used as in-app brand mark, splash, OG card watermark.
```

After:
```
- **Mingla M monogram (v1, locked per DEC-068)** — 32×32 SVG, rounded rect with `linear-gradient(135deg, #fb923c, #eb7825)` background, white M path stroke 2px, used as in-app brand mark, splash, OG card watermark, app icon foreground.
```

---

### Patch P-405
File: `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md`
Section: §1.9.1 Primary icon family
Action: MODIFY (resolve Q1 to package's icon set)
Source: AUDIT §6 Q-A14
Verdict: KEEP (DEC-069)

Before:
```
**Recommended:** Phosphor Icons (regular weight default) — broad, modern, futuristic, well-licensed for both mobile and web. Sizes: 16 / 20 / 22 / 24 / 28 / 32 / 40.
**Fallback acceptable:** Ionicons (already shipping in business `package.json`) for parity with consumer.
Until the founder elects, use Ionicons in mockups but include alternates from Phosphor on the style guide page so the swap is visible. (See Section 11 — Open Question.)
```

After:
```
**Locked v1 per DEC-069:** Hand-rolled SVG icon library absorbed from the Claude Design package, ported to `react-native-svg`. 60+ named glyphs cover every visible UI need in MVP (home, calendar, qr, scan, sparkle, chat, user, plus, chev*, close, check, search, bell, share, edit, pound, trash, settings, google, apple, arrowL, moreH, flash, location, clock, ticket, eye, cash, tap, list, grid, refund, flag, flashOn, keypad, backspace, star, mail, sms, chart, pieChart, funnel, link, users, tag, send, play, pause, template, upload, download, filter, branch, shield, receipt, bank, nfc, swap, target, calendarPlus, globe, rocket, notebook, award, trending, inbox). Sizes: 16 / 20 / 22 / 24 / 28 / 32 / 40. Stroke weight 1.75px default; weight 0 for icons rendered as filled (google / apple / play / pause / star / flashOn / moreH / keypad).

Phosphor Icons remains an option for post-MVP iconography expansion if needed; the package set is sufficient for MVP.
```

---

### Patch P-406
File: `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md`
Section: §7 Microcopy & Voice
Action: MODIFY (mark canonical sources + adopt package strings)
Source: AUDIT §4.5 Microcopy verdict
Verdict: KEEP (Q-A11)

Before:
```
> Production-ready strings for every visible surface. Founder voice. Plain English. Currency-aware. Never dating-app language.
```

After:
```
> Production-ready strings for every visible surface. Founder voice. Plain English. Currency-aware. Never dating-app language.
>
> **Canonical microcopy source per DEC-066:** Where the design package and this Handoff cover the same surface, the design-package strings supersede Handoff placeholders. The implementor reads the package files in `Mingla_Artifacts/design-package/mingla-business-app-screens/project/` for the literal strings to use. Specifically: AuthScreen welcome copy, OnboardingScreen step subtitles, "Build a new event · About 4 minutes," DeleteScreen 4-step copy, RefundSheet "Marcus will see it on his card in 3–5 business days," ScannerScreen "Point at a ticket QR · Hold steady — it scans automatically," ChatScreen "Chat is on the way" locked-state copy, "Live tonight" / "Last 7 days" / "Active events" KPI labels.
```

---

## Section 5 — `DECISION_LOG.md` patches

### Patch P-501
File: `Mingla_Artifacts/DECISION_LOG.md`
Section: Top of decision table (newest first)
Action: ADD 13 new entries (DEC-057 through DEC-069)
Source: AUDIT §10 (drafts)
Verdict: KEEP

Action: Insert each row from AUDIT §10 above the existing DEC-056 row, in newest-first order. Each row uses the exact format already in DECISION_LOG.md (ID · Date · Decision · Context · Alternatives Rejected · Tradeoff Accepted · Exit Condition).

---

## Section 6 — Cleanup operations

### Patch P-601 (file deletion)
Files to delete:
- `Mingla_Artifacts/design-package/mingla-business-app-screens/project/ios-frame.jsx`
- `Mingla_Artifacts/design-package/mingla-business-app-screens/project/design-canvas.jsx`
- `Mingla_Artifacts/design-package/mingla-business-app-screens/project/uploads/HANDOFF_BUSINESS_DESIGNER.md` (duplicate of canonical at `handoffs/`)

Action: `rm` after founder approval. Audit trail preserved in chat transcripts and audit report.

### Patch P-602 (file extract-then-delete)
File: `Mingla_Artifacts/design-package/mingla-business-app-screens/project/tokens.css`

Action: After Patch P-307 (M0 implementor cycle) completes — implementor ports every value into `mingla-business/src/constants/designSystem.ts`. After tester verifies parity, this CSS file may be deleted or kept as visual reference (founder decision).

### Patch P-603 (rename for clarity)
File: `Mingla_Artifacts/design-package/mingla-business-app-screens/`
Suggested rename: `Mingla_Artifacts/design-package/v0.4-claude-design/`
Reason: The folder name reflects the design source (Claude Design v0.4) and frees `design-package/` to hold future iterations.
Action: Optional — orchestrator/founder discretion.

### Patch P-604 (preserve as reference)
All other files in `Mingla_Artifacts/design-package/mingla-business-app-screens/project/` and the `chats/` subdirectory remain in place, untouched, until the corresponding implementor cycle completes per AUDIT §8. After each cycle:
- M1 done → `screens-auth.jsx` may be deleted or moved to `_archived/`
- M2 done → `screens-brand.jsx` (BrandSwitcherSheet, BrandsListScreen, BrandProfileScreen sections)
- ... etc.

This is an opt-in cleanup; the conservative default is to retain all reference files indefinitely.

---

## Section 7 — Application order

The orchestrator applies patches in this order under SYNC mode:

1. **Founder approval round** — answer Q-A1 through Q-A14 from AUDIT §6.
2. **DECISION_LOG patches first** — P-501 (DEC-057 through DEC-069) — establishes the decision baseline before any plan-level edit.
3. **Strategic Plan patches** — P-201 through P-207 (open-question resolutions, M0/M7/M9 milestone updates, R-15 risk).
4. **PRD patches** — P-101 through P-106.
5. **Project Plan patches** — P-301 through P-308.
6. **Designer Handoff patches** — P-401 through P-406.
7. **Cleanup operations** — P-601 (delete prototype-only files), P-602 (extract tokens.css after M0 lands).
8. **Implementor dispatch resumes** — orchestrator writes the M0 cycle 1 prompt referencing the now-patched plans.

Each patch is independent; if a Q-A is rejected, only the patches gated on that Q-A are skipped (the others apply).

---

## Section 8 — Verification (pre-apply)

Before any patch applies, the orchestrator must verify:

- [ ] Audit report (`AUDIT_BIZ_DESIGN_PACKAGE_ABSORPTION.md`) is approved by the founder.
- [ ] All 14 founder-decision questions in AUDIT §6 carry an explicit yes/no answer.
- [ ] No locked-plan section in this spec's "Before" block has been edited since the audit ran (run a `git status` / `git diff` check).
- [ ] DECISION_LOG.md format conventions preserved exactly (table column order, datetime format).
- [ ] No patch in this spec adds an `any` TypeScript type, a silent failure, or a forbidden cross-app import (per Mingla constitutional rules).

---

## Section 9 — Post-apply

After all patches apply:

1. Update `Mingla_Artifacts/AGENT_HANDOFFS.md` — mark `ORCH-BIZ-DESIGN-AUDIT-001` Completed; record the audit + spec artifact paths.
2. Update `Mingla_Artifacts/COVERAGE_MAP.md` — note the design-package absorption as a coverage advance for the Mingla Business surface.
3. Update `Mingla_Artifacts/PRIORITY_BOARD.md` — surface "M0 cycle 1: design tokens + glass primitives + 5-tab BottomNav shell" as the new top priority.
4. Orchestrator authors `Mingla_Artifacts/prompts/IMPLEMENTOR_M0_DESIGN_FOUNDATION_v2.md` (replacing the superseded v1) referencing the patched plans + design-package files.
5. User dispatches the v2 prompt to `/mingla-implementor`. M0 cycle 1 begins.

---

**End of patch set. Pair with `reports/AUDIT_BIZ_DESIGN_PACKAGE_ABSORPTION.md` for full evidence trail.**
