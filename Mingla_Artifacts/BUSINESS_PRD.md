# Mingla Business — Product Requirements Document

> ⚠️ **MINGLA-WEB DISCONTINUED 2026-04-29 — see DEC-081.** PRD references to
> a separate Next.js marketing/share-pages codebase (`mingla-web/`) are
> STALE. Web product = `mingla-business` Expo Web only.

> **Status:** Draft — founding document
> **Owner:** Seth Ogieva
> **Started:** 2026-04-28
> **Last updated:** 2026-04-29 (DEC-081 banner added)
> **Scope:** Founding vision + MVP v1 scope (Event Organisers surface)
> **Anchor:** Mingla Business is the partner-side surface of Mingla. The consumer app
> (Mingla) is an experience / date-planning / social-experiences app — never a dating
> app. The Business app must serve that positioning, not contradict it.

---

## 0. Document Conventions

- Every feature listed in this PRD must be preserved. No item is dropped, consolidated,
  or renamed without an entry in the Decisions Log (Section 99).
- All claims tie to a real user, a real job, or a deliberate strategic bet.
- If a section is undecided, it stays marked **TBD** with the open question written down.
- Cross-domain rule: every business-side feature is checked against impact on the consumer
  app, the shared Supabase schema, and the admin dashboard.

---

## 1. Build Principles (Non-Negotiable)

These principles govern HOW the Business product is built across every section below.

- **Mobile-first.** All features designed for mobile as the primary surface.
- **Mobile + Web parity.** Every feature is accessible via the mobile app **and** web.
  Users (organisers, brands, attendees viewing organiser/brand/event pages) can reach
  every surface on either platform.
- **Public pages cross-platform.** Organiser pages, Brand pages, and Event pages are
  visible on mobile and web for both authenticated and unauthenticated viewers.
- **Foundations first.** Account, brand, and event primitives are built before any
  layered feature (marketing, analytics, scanners, in-person payments) is shipped.
- **Incremental delivery.** Agile cadence. We do not big-bang.
- **Throughput-oriented.** Every incremental feature must be throughput — independently
  shippable, independently testable, end-to-end functional on its own.
- **Testable on both app and web.** Every shipped feature has a verifiable test path on
  mobile AND web before it counts as done.

---

## 2. Primary User — Event Organisers

Mingla Business v1 is for **event organisers**: a place to create, manage, list, market,
and monetise events.

The organiser surface is the foundation of the platform. Future user types (venues,
brand curators, etc.) layer on top once the organiser foundation is proven.

---

# Event Organisers — Feature Inventory

The following 11 sections enumerate **every** feature the Business product must support
for event organisers. Each line item is a tracked requirement.

---

## 1. Account Structure

The account is the top-level owner of the organiser experience. A user can create one
account, manage their personal settings, invite team members, and create or switch
between multiple brands. Permissions start here and flow down into brands, events,
finance, marketing, and scanner access.

### Account Features

- Create user account
- Log in / log out
- Manage account profile
- Manage account settings
- Create multiple brands under one account
- Switch between brands
- Manage account-level permissions
- Invite team members
- Assign roles across brands
- Account owner role
- Brand admin role
- Event manager role
- Finance manager role
- Marketing manager role
- Ticket scanner role

### 1.1 Bottom Navigation (added 2026-04-28 per DEC-073)

The Mingla Business mobile app uses a **3-fixed-tab** bottom navigation, with an
**adaptive 4th tab** that materialises only when Marketing ships:

1. **Home** — at-a-glance dashboard for the current brand (KPIs, Live tonight, Upcoming, Build CTA)
2. **Events** — Events List screen with filter pills + per-event Manage menu (see §5.0)
3. **Account** — profile, settings, brand list, brand switcher entry, sign-out, delete
4. **Marketing** *(adaptive — appears only when Marketing ships per DEC-070 Q-A3 build-when-ready)*

**Scan is contextual, not a tab** — placed at: Event Detail "Scan tickets" CTA tile, Home
"Live tonight" KPI card → Scanner CTA when an event is live today, and deep-link from
event-staff invitation email. Putting Scan in the bottom nav is a real-estate waste per
DEC-073.

**No Chat tab** — the chat agent (M19+ in old plans, B6 in new cycle structure) is
deferred to post-MVP. No placeholder is rendered until the agent ships.

The TopBar carries the **brand chip** (avatar + brand name + chevron-down) on every
primary tab — tapping opens the Brand Switcher Sheet per DEC-061. When no brand exists,
the chip reads "Create brand" and tapping opens the brand-creation sheet inline per DEC-074
(no onboarding wizard).

Web sidebar at `lg+` breakpoints mirrors the same nav: 3 fixed items + adaptive 4th when
Marketing ships.

---

## 2. Brand Management

Brands sit underneath an account and act as the main business entity. Each brand has
its own profile, events, customers, finances, payouts, analytics, and marketing tools.
This allows one organiser account to manage multiple separate event brands without
mixing revenue, audiences, or operations.

### 2.1 Create Brands

- Create a brand
- Name a brand
- Switch between brands
- View all brands under one account
- Manage multiple brands under one account
- View and manage events for a brand
- View and manage finances for a brand
- Manage brand-level Stripe connection
- Manage brand-level payouts
- Manage brand-level transaction history
- Manage brand-level tax/VAT settings
- Manage brand-level customer database
- Manage brand-level attendee history
- Manage brand-level analytics
- Manage brand-level marketing tools

### 2.2 Brand Profile

- Brand profile page
- Brand profile photo
- Edit brand profile photo
- Camera/upload photo option
- Preview brand profile
- Organization name
- Contact information
- Social media links
- Organization description
- Custom links
- Display number of attendees toggle
- Profile settings section
- Navigation back button
- Bottom navigation access to brand profile

### 2.3 Brand Payments

- Connect Stripe account
- View brand revenue
- View brand payouts
- View brand fees
- View refunds
- View payment history
- Accept online payments
- Accept in-person payments
- Accept in-person payments with phone NFC
- Enable in-person payments per brand
- Reconcile in-person payments
- View door-sale revenue
- Export finance reports

### 2.4 Public Brand Page (added 2026-04-28 per DEC-059)

Each brand has a public storefront at `mingla.com/[brand-slug]` (e.g., `mingla.com/lonelymoth`).
Adopted into MVP per DEC-059. Lives in the `mingla-web/` Next.js codebase per DEC-075. Surfaces:

- Cover band (gradient + grain texture branding canvas)
- Brand identity card (logo, name, verified tick, handle, location)
- Bio text
- Stats strip (followers, events, rating)
- Follow + notify CTAs (signed-in attendees only)
- Tabs: **Upcoming · Past · About**
- Upcoming events list with cover thumbs, dates, prices, "X left / Half full / SOON" status
- Footer trust strip (refund policy, house rules, report, "Verified host on Mingla since YYYY")

Reachable from:
- Event Detail "Brand page" tile
- Account → tap a brand row
- Direct share link (organisers share `mingla.com/lonelymoth` to social, email, SMS)

The page is **share-link-ready** — Open Graph metadata renders correctly on iMessage,
WhatsApp, X, Slack, etc. Lives in `mingla-web/` for SSR + SEO + fast first-paint.

---

## 3. Event Creation

Events are created inside a brand and inherit that brand's identity, payment setup,
and team access. Organisers can design the public event page, add media, set dates,
configure visibility, add organiser contact details, and create single-date, recurring,
or multi-date events from one setup flow.

### 3.1 Create Events

> **Updated 2026-04-28 (DEC-065).** Event creation is a 7-step wizard with these locked
> step labels (adopted-with-refine from the Claude Design package). Every original feature
> line is preserved — sub-bullets group them under the wizard step where they live.

**Step 1 — Basics**
- Create a new event
- Add event title (with inline edit)
- Add event description
- Set event format / category

**Step 2 — When**
- Add event date and time
- Create one-off (single-date) events
- Create recurring events (RFC 5545 RRULE-based per resolved Strategic Plan Q6)
- Create multiple-date events
- Duplicate event information across multiple dates
- Edit details per event date (per-date overrides)

**Step 3 — Where**
- Add event location (geocoded picker)
- Online-event toggle with conferencing URL
- Hybrid (in-person + online) mode

**Step 4 — Cover**
- Choose an animated GIF from a built-in library
- Upload a custom event image
- Upload a custom event video
- Set event media as the event header

**Step 5 — Tickets** (full ticket-type management lives here; see §4 for ticket-type details)
- Inline create of ticket types with all §4.1 fields and all §4.2 types
- Reorder ticket types
- Toggle visibility / disabled per type

**Step 6 — Settings**
- Choose a custom font for the event page (theme typography)
- Choose a color preset
- Input a custom event color
- Show event on discover screen toggle (feeds consumer Mingla Discover per DEC-072)
- Show event in swipeable deck toggle (feeds consumer Mingla deck per DEC-072)
- Visibility radio (Public / Private link only / Hidden / Draft)
- Add organiser contact
- Add organiser name
- Add organiser picture
- Add organiser phone number
- Add organiser email address
- Approval-required + transferability + password-protected flags

**Step 7 — Preview**
- Preview public event page (live render)
- Publish event (gate: validation + Stripe-active for paid tickets)
- Save event as draft
- Edit event page after publishing (with change-summary modal)

### 3.2 AI Event Features

- AI guest list banner
- Set desired attendee number
- Use AI-generated guest psychology to promote attendance
- Display AI-enhanced social proof before target threshold
- Automatically switch to real guest count after 80% registration
- AI event copy suggestions
- AI ticket description suggestions
- AI campaign copy suggestions
- AI audience targeting suggestions

---

## 4. Ticket Creation

Tickets belong to specific events and define how attendees can register or pay.
Organisers can create free, paid, hidden, approval-based, password-protected, online,
in-person, limited, unlimited, transferable, and waitlist-enabled tickets, with full
control over quantities, sale windows, validity periods, and purchase limits.

### 4.1 Create Tickets

- Create a new ticket
- Ticket name
- Ticket quantity
- Unlimited quantity option
- Free ticket option
- Sale period scheduling
- Sale start date/time
- Sale end date/time
- Validity period scheduling
- Validity start date/time
- Validity end date/time
- Ticket description
- Limit purchase quantity per customer
- Minimum purchase quantity
- Maximum purchase quantity
- Hide ticket option
- Disable ticket option
- Require approval for ticket purchase
- Allow ticket transfers
- Password-protected ticket
- Ticket password field
- Online availability toggle
- In-person availability toggle
- Waitlist enabled option
- Info tooltips for ticket settings
- Collapsible ticket option sections
- Disabled "Done" state until required fields are completed

### 4.2 Ticket Types

- Paid tickets
- Free tickets
- Hidden tickets
- Disabled tickets
- Password-protected tickets
- Approval-required tickets
- Online-only tickets
- In-person-only tickets
- Limited-quantity tickets
- Unlimited tickets
- Waitlist-enabled tickets
- Transferable tickets
- Non-transferable tickets

---

## 5. Event Management

Once an event is live, organisers manage it from the event overview. This includes
viewing performance, managing orders, approving guests, handling private guest lists,
editing the event page, sharing the event, tracking scans, and monitoring how the event
is performing across each date.

### 5.0 Events List Screen with Manage Menu (added 2026-04-28 per DEC-060)

The Events tab opens to an **Events List screen** — every event the brand has created,
filterable by status:

- Filter pills: **All / Live / Upcoming / Drafts / Past** (with counts)
- Each event row: cover thumb, status pill, date, venue, capacity bar with sold/total, revenue + delta
- Per-row **Manage menu** (`⋯`) with context-aware actions:
  - Edit details
  - View public page
  - Open scanner
  - Orders
  - Copy share link
  - Publish (drafts only)
  - End ticket sales (live only)
  - Duplicate (drafts + upcoming)
  - Delete event (drafts + upcoming)
  - Issue refunds (past)

Tapping a row opens Event Detail. Tapping `⋯` opens the action menu without navigating away.
This screen replaces the locked plans' direct-tap-to-detail pattern from the Events tab.

### 5.1 Event Overview

- Event overview page
- Date-based event overview
- Event performance dashboard
- Scanned ticket progress tracker
- Total scanned count
- View event page
- Edit event page
- Share event
- Manage event settings
- Manage ticket settings
- Manage visibility settings
- Manage event availability
- Bottom navigation access to events

### 5.2 Orders

- View event orders
- Search orders
- Filter orders
- View order details
- Resend tickets
- Cancel orders
- Refund orders
- View payment status
- View attendee details
- Export orders
- Track online orders
- Track in-person orders

### 5.3 Guest Management

- Approve pending guests
- Reject pending guests
- Private guest list
- Manually add guests
- Manually check in guests
- View attendee check-in status
- Search guest list
- Export guest list
- View attendee purchase history
- View attendee contact details

---

## 6. Ticket Scanners and Door Operations

Ticket scanners are added at the event level to help manage entry at the door. Scanner
users can be given restricted access to scan tickets, manually check in guests, validate
QR codes, prevent duplicate entry, and optionally accept payments for door sales depending
on their permissions.

### 6.1 Ticket Scanners

- Add ticket scanners to an event
- Invite scanner users
- Assign scanner permissions
- Scanner-only access mode
- Restrict scanner access to specific events
- Scan tickets at the door
- Validate ticket QR codes
- Prevent duplicate scans
- Show successful scan state
- Show failed scan state
- Manual ticket lookup
- Manual check-in
- Offline scanning support
- Scanner activity log
- Track scans by scanner
- View total scans by scanner

### 6.2 Scanner Payments

- Allow ticket scanners to accept payments
- Enable or disable payment access per scanner
- Accept in-person payments at the door
- Accept card payments at the door
- Accept phone NFC payments at the door
- Record cash payments at the door
- Create in-person orders
- Issue tickets after in-person payment
- Send in-person receipts
- Track door revenue
- Reconcile scanner sales
- View scanner payment report
- View scanner payout/reconciliation report

---

## 7. In-Person Payments

In-person payments allow organisers and approved scanners to monetise walk-up attendees
at the door. Payments can be taken by card, phone NFC tap-to-pay, cash, or manual
recording, with all door sales linked back to the event and reported separately from
online sales.

### 7.1 Door Sales

- Enable in-person payments per event
- Accept payments at the door
- Accept card payments
- Accept NFC tap-to-pay payments
- Accept cash payments
- Record manual payments
- Sell tickets at the door
- Create door-sale tickets
- Track in-person ticket sales
- Track in-person revenue separately
- Assign payment permissions to staff
- Refund in-person payments
- View in-person payment history
- Reconcile door sales

---

## 8. Marketing and Nurturing

Marketing tools operate mainly at the brand level but can be used for specific events.
Organisers can build customer lists, segment audiences, send email and SMS campaigns,
automate reminders and follow-ups, re-engage past attendees, and nurture customers
before and after events.

### 8.1 Marketing Dashboard

- Brand-level marketing dashboard
- Event-level marketing dashboard
- Campaign performance dashboard
- Audience dashboard
- Customer/attendee list
- Audience segmentation
- Contact import
- Contact export
- Customer tags
- Customer groups
- Past attendee targeting
- Repeat attendee targeting
- VIP targeting
- Waitlist targeting

### 8.2 Email Marketing

- Create email campaigns
- Send one-off emails
- Send bulk emails
- Email campaign templates
- Email campaign drafts
- Scheduled email campaigns
- Send test email
- Pre-event email reminders
- Post-event email follow-ups
- Ticket launch announcement emails
- Last-chance ticket reminder emails
- Sold-out notification emails
- New event announcement emails
- Abandoned checkout emails
- Waitlist notification emails

### 8.3 SMS Marketing

- Create SMS campaigns
- Send one-off SMS messages
- Send bulk SMS messages
- SMS campaign templates
- SMS campaign drafts
- Scheduled SMS campaigns
- Send test SMS
- Pre-event SMS reminders
- Post-event SMS follow-ups
- Ticket launch SMS announcements
- Last-chance ticket SMS reminders
- Sold-out SMS notifications
- Waitlist SMS notifications
- Abandoned checkout SMS follow-ups

### 8.4 Nurturing and CRM

- Attendee profiles
- Customer profiles
- Customer notes
- Customer tags
- Purchase history
- Attendance history
- Message history
- Follow-up reminders
- Lead nurturing flows
- Automated customer journeys
- Re-engagement campaigns
- VIP outreach campaigns
- Birthday campaigns
- Anniversary campaigns
- Customer lifetime value tracking
- High-value customer segment

### 8.5 Marketing Compliance

- Email consent management
- SMS opt-in management
- Unsubscribe management
- Suppression lists
- Bounce tracking
- Delivery status tracking

---

## 9. Traffic and Attribution

Tracking links help organisers understand where their audience and sales are coming from.
Each event can have custom links, UTM tracking, QR codes, influencer links, affiliate
links, campaign links, and source-level reporting so organisers can see which channels
drive views, sales, and revenue.

### 9.1 Tracking Links

- Create tracking links
- Create campaign-specific links
- Create source-specific links
- Custom tracking link names
- UTM tracking
- QR codes for tracking links
- Shareable event links
- Tracking links for influencers
- Tracking links for ambassadors
- Tracking links for affiliates
- Tracking links for paid ads
- Tracking links for email campaigns
- Tracking links for SMS campaigns
- Tracking links for social media posts

### 9.2 Traffic Analytics

- Track where traffic is coming from
- Track clicks by source
- Track views by source
- Track ticket sales by source
- Track revenue by source
- Track conversion rate by source
- Track campaign attribution
- Track source-level sales
- Track source-level revenue
- Track paid ad traffic
- Track influencer traffic
- Track ambassador traffic
- Track affiliate/referral traffic
- Track email campaign traffic
- Track SMS campaign traffic
- Track social media traffic
- Link performance dashboard
- Revenue attribution report
- Campaign attribution report
- Export tracking report

---

## 10. Analytics and Reporting

Analytics connect the full organiser journey from brand to event to ticket to customer.
Organisers can track revenue, sales, orders, check-ins, traffic sources, campaign
performance, customer growth, conversion rates, and top-performing events, ticket types,
and marketing channels.

### 10.1 Brand Analytics

- Brand-level revenue analytics
- Brand-level ticket sales analytics
- Brand-level attendee analytics
- Brand-level campaign analytics
- Brand-level customer growth analytics
- Brand-level traffic source analytics
- Brand-level conversion analytics

### 10.2 Event Analytics

- Event overview analytics
- Ticket sales analytics
- Revenue analytics
- Orders over time
- Sales over time
- Scans over time
- Check-in analytics
- Traffic source analytics
- Campaign performance analytics
- Attendee growth tracking
- Conversion funnel tracking
- Top-performing campaigns
- Top-performing traffic sources
- Top-performing ticket types

---

## 11. Permissions and Access Control

Permissions control who can access each part of the system. Account owners can assign
roles for brand admins, event managers, finance managers, marketing managers, and ticket
scanners, with restrictions by brand, event, finance access, customer data, marketing
tools, scanner tools, and payment capabilities.

### 11.1 Roles and Permissions

- Account owner permissions
- Brand owner permissions
- Brand admin permissions
- Event manager permissions
- Finance manager permissions
- Marketing manager permissions
- Ticket scanner permissions
- Scanner payment permissions

> **Note (added 2026-05-04 per Cycle 13a SPEC §4.16 / DEC-092):** the canonical role
> enum shipped in PR #59 has **6 roles** (`account_owner`, `brand_admin`, `event_manager`,
> `finance_manager`, `marketing_manager`, `scanner`). The eight bullets above resolve as:
> "Brand owner" reads as `account_owner`-or-`brand_admin` context-dependent (not a
> separate role); "Scanner payment permissions" lives as the `take_payments` boolean on
> the scanner role's `permissions` jsonb (Cycle 11 + 12 surface). No DB migration needed —
> Cycle 13a builds against the 6-role enum. SQL `biz_role_rank()` (migration
> `20260502100000_b1_business_schema_rls.sql:11-30`) is the source of truth; mobile
> mirrors verbatim per I-32.

### 11.2 Access Restrictions

- Restrict access by brand
- Restrict access by event
- Restrict access to finances
- Restrict access to marketing tools
- Restrict access to customer data
- Restrict access to scanner tools
- Restrict scanner payment permissions
- Activity logs for staff actions
- Audit trail for sensitive actions

> **Note (added 2026-04-28):** the Permissions UI (team list, invite flow, role-detail
> screens, audit-log viewer) is **DESIGN-PACKAGE-SILENT** — the Claude Design package did
> not include team / role-detail screens. Cycle 2 implementor will design these from the
> Designer Handoff §5.3.9–§5.3.11 and §5.11 references using the absorbed tokens +
> primitives. ~16 hours of design-time work folded into the cycle estimate.

---

# Ultimate Goal — Chat-Driven Event Creation

> **One-line target:** A chat menu lives as one of the bottom navigation items. From it,
> an organiser describes an event in a single sentence, the app extracts structured
> fields into a draft, asks only for missing essentials, creates a ticket, shows a
> preview, and publishes. Foundations come first; the agent goes on top.

## U.0 Architectural Principle (Non-Negotiable)

- **Do not build the AI agent first.** Build the normal event creation system as
  structured data first. Put the chat agent on top of it.
- **The agent is not the source of truth.** The database and event-creation logic are
  the source of truth. The agent simply helps fill in that structure.
- **The chat interface has no separate logic.** It uses the same event creation APIs as
  the manual flow. Manual and chat paths share one backend.

## U.1 Define the Event Creation Data Model First

Before the chat interface, define what a complete event needs.

```text
Event {
  id
  brandId
  title
  description
  location
  startDateTime
  endDateTime
  timezone
  isRecurring
  recurrenceRules
  visibility
  coverMedia
  theme
  organiserContact
  tickets[]
  marketingSettings
  trackingSettings
  scannerSettings
  paymentSettings
  status
}

Ticket {
  id
  eventId
  name
  price
  quantity
  isUnlimited
  isFree
  saleStart
  saleEnd
  validityStart
  validityEnd
  description
  minPurchaseQty
  maxPurchaseQty
  isHidden
  isDisabled
  requiresApproval
  allowTransfers
  passwordProtected
  password
  availableOnline
  availableInPerson
  waitlistEnabled
}
```

This is the foundation. The chat agent's job is to populate this object.

## U.2 Build the Manual Event Creation Flow First

Build a basic version where users create an event using forms. This must exist before
the chat version, because the AI agent will call the same backend actions.

**Minimum manual flow:**

- Create event title
- Add description
- Add date/time
- Add location
- Add cover image
- Create ticket
- Set ticket price/quantity
- Publish event

Once this works manually, the chat version is safe to build. The chat interface uses
the same event creation APIs — no separate logic.

## U.3 Turn Every Event Setup Step into Backend Actions

Create small backend functions the agent can call:

- `createDraftEvent(brandId)`
- `updateEventTitle(eventId, title)`
- `updateEventDescription(eventId, description)`
- `updateEventDate(eventId, startDateTime, endDateTime)`
- `updateEventLocation(eventId, location)`
- `updateEventTheme(eventId, theme)`
- `createTicket(eventId, ticketData)`
- `updateTicket(eventId, ticketId, ticketData)`
- `connectTrackingLink(eventId, sourceName)`
- `enableInPersonPayments(eventId)`
- `assignTicketScanner(eventId, userId)`
- `publishEvent(eventId)`

The agent must not "pretend" to set things up. It actually calls tools/functions that
update the draft event.

## U.4 Build a Draft Event State System

When the user starts chatting, create a draft event immediately.

Example — user says: *"I'm hosting a Valentine's R&B night in Shoreditch on Feb 14,
tickets £20, 200 capacity."*

The system creates:

```text
DraftEvent {
  title: "Valentine's R&B Night"
  location: "Shoreditch"
  date: "Feb 14"
  ticketName: "General Admission"
  ticketPrice: 20
  ticketQuantity: 200
  missingFields: ["start time", "end time", "venue address", "brand", "cover image"]
}
```

The agent then asks only for the missing essentials.

## U.5 Required vs Optional Fields

The agent must only ask for required things first. Most products fail by asking 50
questions upfront. Mingla creates the simplest complete event first, then offers
optional upgrades.

### U.5.1 Required to Publish

- Brand
- Event title
- Event description
- Event date
- Event start time
- Event location or online status
- At least one ticket
- Ticket price or free status
- Ticket quantity or unlimited
- Payment setup if paid
- Public/private visibility

### U.5.2 Optional After Draft is Created

- Custom font
- Color preset
- GIF/header media
- Sale period
- Validity period
- Password-protected ticket
- Approval-required ticket
- Ticket transfers
- Waitlist
- Tracking links
- Scanner access
- SMS/email campaigns
- AI guest list banner

## U.6 Chat Flow — Guided Setup Assistant

The experience pattern (illustrative):

User: *"Create an Afrobeats brunch for 150 people next Saturday in Hackney. Tickets are £25."*

Agent: *"Got it. I've started your event draft. I just need 3 things before I can
publish it: start time, venue address, and whether you want tickets available online
only or also at the door."*

User: *"Starts 2pm, venue is 44 Kingsland Road, online and door."*

Agent: *"Perfect. I've set the event for next Saturday at 2pm, added a £25 General
Admission ticket with 150 available, and enabled online plus door sales. Do you want
me to make it public on Discover?"*

This is the product pattern.

## U.7 Pop-Up Questions for Structured Decisions

Do not make the user type everything. Use chat for natural language, but use UI cards
for decisions. The agent asks; the app shows buttons, toggles, date pickers, forms
inside the conversation.

- **Date card** — One-off event / Multiple dates / Recurring event
- **Ticket card** — Free / Paid / Approval required / Password protected
- **Visibility card** — Public on Discover / Private link only / Hidden for now
- **Payment card** — Online only / Online + in-person / In-person only
- **Marketing card** — Create tracking link / Send announcement email /
  Send announcement SMS / Skip for now

## U.8 Start Rules-Based, Then Add AI

The first version is mostly a structured wizard with AI extraction. The intelligence
is in field extraction and smart follow-up questions, not in giving the AI total control.

Loop:

1. User enters event description
2. AI extracts structured fields
3. App checks missing required fields
4. App asks the next best question
5. User answers
6. App updates draft
7. Repeat until ready to publish

## U.9 Build the Agent Around a Schema

Use a schema the model must fill:

```json
{
  "title": null,
  "description": null,
  "location": null,
  "startDateTime": null,
  "endDateTime": null,
  "timezone": null,
  "ticket": {
    "name": null,
    "price": null,
    "quantity": null,
    "isFree": null,
    "availableOnline": true,
    "availableInPerson": false
  },
  "visibility": {
    "showOnDiscover": false,
    "privateLinkOnly": true
  },
  "missingRequiredFields": []
}
```

After every user message, run extraction into this schema. Then the app decides what to
do next.

## U.10 Suggested MVP Agent Flow

- **Step 1 — User describes event.** Free-text description. Example: *"I'm doing a
  comedy night at Boxpark Croydon next Friday at 8pm, £15 tickets, 100 capacity."*
- **Step 2 — AI extracts event fields.** Identifies event type, location, date, time,
  ticket price, capacity.
- **Step 3 — Create draft event.** App creates the event in draft mode.
- **Step 4 — Ask missing questions.** Examples: *"What should the event be called?"*
  / *"What time does it end?"* / *"Should this be public on Discover?"* / *"Online
  tickets, door tickets, or both?"*
- **Step 5 — Generate defaults.** Suggest event title, description, ticket name, ticket
  description, theme color, marketing copy.
- **Step 6 — Preview.** Show a live event preview card.
- **Step 7 — Confirm and publish.** *"Everything is ready. Publish now or save as draft?"*

## U.11 Build Order (Technical Phasing)

### Phase 1 — Core Backend

- Account model
- Brand model
- Event model
- Ticket model
- Order model
- Attendee model
- Payment model
- Draft event status
- Publish event status

### Phase 2 — Manual Organiser Tools

- Brand creation
- Event creation form
- Ticket creation form
- Public event page
- Checkout
- Payment
- QR ticket generation
- Event dashboard
- Basic scanner

### Phase 3 — Agent-Ready APIs

- Create draft event API
- Update event field API
- Create ticket API
- Update ticket API
- Validate draft event API
- Publish event API
- Generate event preview API

### Phase 4 — Chat MVP

- Chat UI on event creation screen
- Free-text event prompt
- AI extraction into event schema
- Missing-field detection
- Follow-up questions
- In-chat UI cards
- Draft event preview
- Publish confirmation

### Phase 5 — Agent Upgrades

- AI-generated event description
- AI-generated ticket setup
- AI-generated marketing copy
- Tracking link suggestions
- Suggested SMS/email campaigns
- Suggested event page design
- Suggested pricing/capacity defaults

## U.12 Co-Pilot, Not Autopilot

For important actions, require confirmation.

### U.12.1 Agent Can Act Automatically

- Create draft event
- Fill title
- Fill description
- Suggest tickets
- Suggest colors
- Suggest marketing copy
- Create preview

### U.12.2 Agent Must Ask Before

- Publishing event
- Taking payments live
- Sending SMS/email campaigns
- Creating public tracking links
- Inviting scanner users
- Refunding orders
- Changing payout settings

This protects users from costly mistakes.

## U.13 Recommended First Chat Prompt

In-app prompt:

*"Tell me about your event. Include the name, date, location, ticket price, and capacity
if you know them."*

Example shown to user:

*"Example: I'm hosting an Afrobeats brunch in Shoreditch next Saturday from 2pm to 8pm.
Tickets are £25 and capacity is 200."*

After the user submits, the agent creates a draft and continues.

## U.14 First Build Target

The user can describe an event in one sentence → the app creates a draft event → asks
missing questions → creates one ticket → shows preview → publishes.

That is the core magic.

**Explicitly excluded from the first build target:** SMS, tracking links, AI guest
psychology, scanners, multi-date events. Those come later.

The first loop, end-to-end:

> Describe event → extract details → fill draft → ask missing fields → create ticket →
> preview → publish.

---

# Strategic Sections (To Be Filled)

## 12. Vision

> What is Mingla Business and why does it need to exist?

**TBD — to be filled in with founder guidance.**

Open questions:
- One-sentence definition of Mingla Business.
- The change in the world we are trying to create.
- Why this cannot be a feature of the consumer app and must be its own surface.

## 13. Strategic Positioning

> Where Mingla Business sits in the market and why we win.

**TBD.**

Anchors already established:
- Mingla = experience / date-planning / social-experiences app (not dating).
- Long-term frame: Posh + Partiful + OpenTable fusion.
- v1 user = event organisers.

Open questions:
- Which slice of the fusion comes first.
- Defensible wedge — what we do that nobody else does, that ties to the consumer app's
  unique demand graph.
- Who we explicitly are NOT for.

## 14. MVP v1 — Foundations Cut

> The smallest, sharpest version we will actually build first, given that "foundations
> come first" and "all incremental features must be throughput."

**Resolved 2026-04-28.** See companion documents:

- [BUSINESS_STRATEGIC_PLAN.md](./BUSINESS_STRATEGIC_PLAN.md) — vision, goals, milestone outline (M0–M21), MVP definition, risks, success metrics, open strategic questions.
- [BUSINESS_PROJECT_PLAN.md](./BUSINESS_PROJECT_PLAN.md) — granular execution plan: architecture, data model (every table), API surface (every edge function), repository layout, UI/UX inventory, workflows, cross-cutting concerns, per-milestone task list with checkboxes, dependency map, per-PR definition of done.

MVP scope summary: **Account (create/delete/profile/settings) → Brand (CRUD, profile, team, Stripe Connect) → Event (full §3 inventory) → Tickets (full §4 inventory) → Public pages → Online checkout → Event management → Scanners → In-person payments → Permissions UI → Hardening.** Marketing (§8), Tracking (§9), Analytics (§10), AI features (§3.2), and the chat agent (§U.0–U.14) are explicitly Post-MVP.

Required sub-sections:
- 14.1 Foundation slice (Account + Brand + Event creation + basic public page)
- 14.2 Sequenced slices (each independently throughput, mobile + web parity)
- 14.3 Out-of-scope for v1 (explicitly deferred)
- 14.4 Cross-platform (mobile/web) test plan per slice
- 14.5 Consumer-app surface impact per slice
- 14.6 Admin-app oversight surface per slice

## 15. Non-Functional Requirements

**TBD.** Performance, reliability, security, RLS posture, audit logging, onboarding speed,
support load expectations, mobile/web parity SLAs.

## 16. Success Metrics

> How we know v1 worked.

**TBD.** North-star metric, leading indicators, kill criteria.

## 17. Risks and Open Strategic Questions

**TBD.**

## 18. Roadmap Beyond v1

**TBD.**

---

## 99. Decisions Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-04-28 | PRD scoped to "Founding vision + MVP v1" | User confirmed via orchestrator framing question. Full GTM and tech architecture deferred to follow-up docs once v1 scope is locked. |
| 2026-04-28 | Primary v1 user = event organisers | User-directed. Venues, brand curators, and other personas deferred until organiser foundation is proven. |
| 2026-04-28 | Build principles locked: mobile-first, mobile+web parity, foundations-first, agile, throughput, dual-platform testable | User-directed. Every feature shipped must be independently throughput and verifiable on both mobile app and web. |
| 2026-04-28 | Full feature inventory captured verbatim across 11 organiser sections | User explicit instruction: "Each one. No one left out." Every line item is a tracked requirement. Future consolidation requires a Decisions Log entry. |
| 2026-04-28 | Ultimate goal locked: chat menu in bottom nav, agent on top of structured event creation | User-directed. Core architectural rule: DB + event-creation logic = source of truth; chat agent only populates structure via the same APIs as the manual flow. Build order: data model → manual flow → agent-ready APIs → chat MVP → agent upgrades. First build target = single-sentence describe → draft → missing fields → one ticket → preview → publish. |
| 2026-04-28 | Co-pilot model adopted for the chat agent | User-directed. Agent acts automatically on low-risk drafting; must ask before publishing, taking payments live, sending campaigns, creating public tracking links, inviting scanners, refunds, payout changes. |
| 2026-04-28 | DEC-070..DEC-076 logged in canonical `DECISION_LOG.md` | Founder resolutions on the design-package absorption (14 audit questions), frontend-first build (DEC-071), producer model (DEC-072), 3-tab nav (DEC-073), no onboarding (DEC-074), Next.js + Expo Web split (DEC-075), auth architecture (DEC-076). This PRD's decision log is a pointer to the canonical record at `Mingla_Artifacts/DECISION_LOG.md`. |
| 2026-04-28 | PRD synced to absorption — patches P-101 to P-106 applied | Wizard step labels (§3.1), Events List with Manage menu (§5.0), Public Brand Page (§2.4), Bottom Navigation locked (§1.1), Permissions design-package-silent note (§11.2), this Decision Log pointer. PRD now matches Strategic Plan + Project Plan + Designer Handoff post-SYNC. |
