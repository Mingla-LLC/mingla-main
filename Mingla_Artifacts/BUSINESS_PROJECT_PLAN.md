# Mingla Business — Project Plan & Fulfilment Structure

> ⚠️ **MINGLA-WEB DISCONTINUED 2026-04-29 — see DEC-081.** Any reference in
> this plan to a separate `mingla-web/` Next.js codebase, two-codebase
> deploys, or Vercel-tied Next.js routes is STALE. Web product = `mingla-business`
> Expo Web only. Marketing landing + share pages either rehomed to
> `mingla-business` or deferred. Mobile + web parity rule still applies but
> "web" now means Expo Web of `mingla-business`.

> **Status:** Draft v1 — locked execution baseline
> **Owner:** Seth Ogieva
> **Started:** 2026-04-28
> **Companion docs:** [BUSINESS_PRD.md](./BUSINESS_PRD.md) · [BUSINESS_STRATEGIC_PLAN.md](./BUSINESS_STRATEGIC_PLAN.md)
>
> **Purpose:** Translate the PRD into the smallest, most granular possible task list — every component, every dependency, every architectural decision, every screen, every test. Throughput-first. Mobile + web parity in every milestone. No item left out.

---

## How to Use This Document

- Tasks use `- [ ]` checkboxes. Mark complete only when verified end-to-end on **both** mobile and web.
- Milestones run sequentially. Do not start the next milestone until the current is verified.
- Within a milestone, parallel tracks (schema / backend / mobile / web / test) can ship concurrently but must converge before milestone-done.
- Every checkbox represents work that can be picked up by one Implementor cycle.
- Cross-cutting tasks (RLS, audit log, parity test) are repeated per-milestone deliberately — they are not write-once.

---

# Part A — Architecture

## A.1 System Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                         END USERS                                   │
│  Organisers (mobile + web) · Attendees (public pages, mobile + web) │
│              Scanners (mobile only at door)                         │
└─────────────────────────────────────────────────────────────────────┘
                  │                       │
                  ▼                       ▼
       ┌──────────────────┐     ┌────────────────────┐
       │  Mingla Business │     │   Public Web Pages │
       │   (Expo + RN-W)  │     │  (event/brand/org) │
       │  iOS · Android   │     │   Mobile + Web     │
       │   · Web          │     │                    │
       └──────────────────┘     └────────────────────┘
                  │                       │
                  └──────────┬────────────┘
                             ▼
              ┌─────────────────────────────┐
              │    Supabase (shared)        │
              │  ─ Postgres + RLS           │
              │  ─ Edge Functions (Deno)    │
              │  ─ Realtime                 │
              │  ─ Storage                  │
              │  ─ Auth (Google, Apple)     │
              └─────────────────────────────┘
                             │
        ┌────────┬───────────┼──────────────┬──────────────┐
        ▼        ▼           ▼              ▼              ▼
    ┌───────┐ ┌──────┐ ┌──────────┐  ┌─────────┐  ┌──────────────┐
    │Stripe │ │Resend│ │  Twilio  │  │OneSignal│  │   Mixpanel   │
    │Connect│ │email │ │ SMS+OTP  │  │  Push   │  │  AppsFlyer   │
    │       │ │      │ │          │  │         │  │   Sentry     │
    └───────┘ └──────┘ └──────────┘  └─────────┘  └──────────────┘
```

## A.2 Frontend Architecture (Mingla Business)

- **Framework:** Expo SDK 54 + Expo Router 6 + React 19 + React Native 0.81
- **Web target:** `react-native-web` (already installed). Same codebase serves iOS, Android, web.
- **Navigation:** Expo Router file-based. Bottom-tab navigator from `@react-navigation/bottom-tabs` (already installed).
- **State:**
  - Server state: **React Query v5** (port pattern from `app-mobile`)
  - Client state: **Zustand** with debounced AsyncStorage persistence (port pattern from `app-mobile/src/store/appStore.ts`)
  - Auth: existing `AuthContext` extended with role/permission hooks
- **Forms:** **React Hook Form + Zod** (NEW — does not exist in either app)
- **Theming:** Existing `src/constants/designSystem.ts` extended with brand-color preset support
- **Image handling:** `expo-image` (already installed) + new `imageUploadService.ts` for Supabase Storage
- **Date pickers:** `@react-native-community/datetimepicker` + a web fallback wrapper
- **QR generation:** `react-native-qrcode-svg` (NEW)
- **QR scanning:** `expo-camera` (NEW) + barcode scanner module
- **Maps:** `react-native-maps` (mobile only) + `@vis.gl/react-google-maps` (web fallback for location pickers)
- **Stripe:**
  - Mobile: `@stripe/stripe-react-native` (NEW)
  - Web: `@stripe/stripe-js` + `@stripe/react-stripe-js` (NEW, web-only build target)
- **NFC:** `react-native-nfc-manager` (mobile only, gated behind feature flag)
- **Error boundaries:** `react-error-boundary` (NEW) — top-level + per-route
- **Analytics:** Mixpanel + AppsFlyer wrappers ported from `app-mobile`
- **Push:** OneSignal v5 wrapper ported (foreground-display fix already learned)
- **Observability:** Sentry SDK (NEW)

## A.3 Backend Architecture (Supabase)

- **Database:** PostgreSQL with RLS deny-by-default
- **Edge functions:** Deno runtime, one function per coarse-grained action
- **Realtime:** subscriptions for live event-overview dashboards (orders, scans)
- **Storage buckets:**
  - `brand-media` — brand profile photos, logos
  - `event-media` — event images, videos, GIFs
  - `tickets-qr` — generated QR images (optional; QR can also be generated client-side)
- **Auth:** Existing Google + Apple OAuth, extended with role checks
- **Cron jobs:**
  - Hourly: Stripe ↔ Mingla ledger reconciliation
  - Daily: hard-delete soft-deleted accounts past 30 days
  - Per-event: pre-event reminder dispatch (post-MVP marketing)

## A.4 Repository Layout (Target State at MVP)

> **Updated 2026-04-28 (DEC-073, DEC-075).** Two codebases live side-by-side:
> `mingla-business/` (Expo + react-native-web) for the Business app; `mingla-web/`
> (Next.js, NEW) for `mingla.com` marketing + organiser login + public share pages.
> Bottom nav is 3 fixed tabs (Home / Events / Account) + adaptive 4th when Marketing
> ships per DEC-073. No Chat tab. No Marketing placeholder.

### A.4.1 `mingla-business/` (Expo)

```
mingla-business/
├── app/
│   ├── _layout.tsx                       (existing)
│   ├── index.tsx                         (existing — auth gate)
│   ├── welcome.tsx                       (existing — AuthScreen, light + warm-glow)
│   ├── (tabs)/                           NEW
│   │   ├── _layout.tsx                   NEW (3-tab bottom nav per DEC-073; tabs config prop)
│   │   ├── home.tsx                      NEW (HomeScreen — KPIs, Live tonight, Upcoming, Build CTA)
│   │   ├── events.tsx                    NEW (EventsListScreen with filter pills + Manage menu)
│   │   └── account.tsx                   NEW (AccountScreen — brands, settings, danger zone)
│   ├── auth/                             (existing)
│   ├── brand/
│   │   ├── create.tsx                    NEW
│   │   ├── [brandId]/
│   │   │   ├── index.tsx                 NEW (brand overview)
│   │   │   ├── settings.tsx              NEW
│   │   │   ├── payments.tsx              NEW
│   │   │   ├── team.tsx                  NEW
│   │   │   └── analytics.tsx             NEW (post-MVP)
│   ├── event/
│   │   ├── create.tsx                    NEW
│   │   ├── [eventId]/
│   │   │   ├── index.tsx                 NEW (overview)
│   │   │   ├── edit.tsx                  NEW
│   │   │   ├── tickets.tsx               NEW
│   │   │   ├── orders.tsx                NEW
│   │   │   ├── guests.tsx                NEW
│   │   │   ├── scanners.tsx              NEW
│   │   │   ├── settings.tsx              NEW
│   │   │   └── share.tsx                 NEW
│   ├── public/
│   │   ├── e/[slug].tsx                  NEW (public event page)
│   │   ├── b/[slug].tsx                  NEW (public brand page)
│   │   └── o/[slug].tsx                  NEW (public organiser page)
│   ├── scanner/
│   │   ├── index.tsx                     NEW (scanner mode home)
│   │   ├── scan.tsx                      NEW
│   │   └── lookup.tsx                    NEW
│   └── checkout/
│       └── [eventId].tsx                 NEW (attendee checkout)
└── src/
    ├── components/                       (existing — auth UI)
    │   ├── account/                      NEW
    │   ├── brand/                        NEW
    │   ├── event/                        NEW
    │   ├── ticket/                       NEW
    │   ├── orders/                       NEW
    │   ├── guests/                       NEW
    │   ├── scanner/                      NEW
    │   ├── payments/                     NEW
    │   ├── permissions/                  NEW
    │   ├── public/                       NEW
    │   └── ui/                           NEW (Cycle 0a foundation — absorbed from Claude Design package per DEC-070)
    │       ├── GlassCard.tsx             NEW (base + elevated variants; 5-layer stack)
    │       ├── GlassChrome.tsx           NEW (top-bar / bottom-nav / pill-switcher wrapper)
    │       ├── TopBar.tsx                NEW (brand-chip variant + back-button variant; chevron opens BrandSwitcherSheet per DEC-061)
    │       ├── BottomNav.tsx             NEW (3-tab capsule per DEC-073; `tabs` config prop accepts adaptive 4th)
    │       ├── IconChrome.tsx            NEW (36×36 circular glass icon button + badge)
    │       ├── MinglaMark.tsx            NEW (32×32 SVG monogram, gradient #fb923c→#eb7825 per DEC-068)
    │       ├── Icon.tsx                  NEW (60+ SVG glyphs ported from design-package primitives.jsx via react-native-svg per DEC-069)
    │       ├── Button.tsx                NEW (primary / secondary / ghost / destructive; sizes sm/md/lg)
    │       ├── Pill.tsx                  NEW (live / draft / warn / accent / error / info; live-pulse animation)
    │       ├── Input.tsx                 NEW (text / email / phone / number / password / search; focus border accent.warm 1.5px)
    │       ├── StatusPill.tsx            NEW (LIVE / DRAFT / UPCOMING / ENDED / PENDING / PREVIEW / SOLD OUT per DEC-062)
    │       ├── KpiTile.tsx               NEW (label + stat-value + delta + sub)
    │       ├── ActionTile.tsx            NEW (icon + label + sub; primary variant glows orange)
    │       ├── EventCover.tsx            NEW (hue-driven striped placeholder; production replaces with organiser-uploaded media)
    │       ├── Toast.tsx                 NEW (top-of-screen; success/error variants; auto-dismiss 2.6s)
    │       ├── Sheet.tsx                 NEW (mobile bottom-sheet; drag handle; backdrop blur)
    │       ├── Modal.tsx                 NEW (web centered; scrim)
    │       ├── Skeleton.tsx              NEW (shimmer animation 1.4s linear infinite)
    │       ├── Spinner.tsx               NEW
    │       ├── Stepper.tsx               NEW (wizard indicator with step segments)
    │       ├── EmptyState.tsx            NEW
    │       ├── ErrorBoundary.tsx         NEW
    │       └── ConfirmDialog.tsx         NEW (type-to-confirm + hold-to-confirm variants)
    ├── config/                           (existing)
    │   ├── routes.ts                     EXTENDED
    │   ├── queryClient.ts                NEW (port from app-mobile)
    │   └── stripe.ts                     NEW
    ├── constants/
    │   ├── designSystem.ts               (existing — extended)
    │   └── permissions.ts                NEW
    ├── context/                          (existing — extended)
    │   ├── AuthContext.tsx               (existing)
    │   ├── BrandContext.tsx              NEW (current selected brand)
    │   └── ToastContext.tsx              NEW
    ├── hooks/                            NEW
    │   ├── queryKeys.ts                  NEW (factory pattern)
    │   ├── useAccount.ts                 NEW
    │   ├── useBrand.ts                   NEW
    │   ├── useBrands.ts                  NEW
    │   ├── useEvent.ts                   NEW
    │   ├── useEvents.ts                  NEW
    │   ├── useTickets.ts                 NEW
    │   ├── useOrders.ts                  NEW
    │   ├── useGuests.ts                  NEW
    │   ├── useScanners.ts                NEW
    │   ├── usePayments.ts                NEW
    │   ├── usePermissions.ts             NEW
    │   ├── useImageUpload.ts             NEW
    │   └── useDeleteAccount.ts           NEW
    ├── services/                         (existing)
    │   ├── supabase.ts                   (existing — extended)
    │   ├── creatorAccount.ts             (existing — extended)
    │   ├── accountService.ts             NEW
    │   ├── brandService.ts               NEW
    │   ├── eventService.ts               NEW
    │   ├── ticketService.ts              NEW
    │   ├── orderService.ts               NEW
    │   ├── guestService.ts               NEW
    │   ├── scannerService.ts             NEW
    │   ├── paymentService.ts             NEW
    │   ├── stripeConnectService.ts       NEW
    │   ├── imageUploadService.ts         NEW
    │   ├── permissionsService.ts         NEW
    │   ├── publicPageService.ts          NEW
    │   ├── auditLogService.ts            NEW
    │   └── analyticsService.ts           NEW (port from app-mobile)
    ├── store/                            NEW
    │   ├── appStore.ts                   NEW (port pattern)
    │   ├── currentBrandStore.ts          NEW
    │   └── draftEventStore.ts            NEW (used heavily by chat agent later)
    ├── types/                            NEW
    │   ├── database.ts                   NEW (Supabase codegen output)
    │   ├── account.ts                    NEW
    │   ├── brand.ts                      NEW
    │   ├── event.ts                      NEW
    │   ├── ticket.ts                     NEW
    │   ├── order.ts                      NEW
    │   ├── scanner.ts                    NEW
    │   └── permission.ts                 NEW
    └── utils/                            (existing)
        ├── responsive.ts                 (existing)
        ├── hapticFeedback.ts             (existing)
        ├── edgeFunctionError.ts          NEW (port)
        ├── platform.ts                   NEW (Web vs Native checks)
        ├── currency.ts                   NEW
        ├── dateTime.ts                   NEW (timezone-safe)
        ├── slug.ts                       NEW
        ├── validation/                   NEW (Zod schemas)
        │   ├── account.schema.ts
        │   ├── brand.schema.ts
        │   ├── event.schema.ts
        │   ├── ticket.schema.ts
        │   └── ...
        └── qr.ts                         NEW (encode + decode helpers)
```

### A.4.2 `mingla-web/` (NEW Next.js codebase per DEC-075)

```
mingla-web/                                NEW codebase, root-level
├── app/                                   (Next.js App Router)
│   ├── layout.tsx                         NEW (root layout, fonts, global providers)
│   ├── page.tsx                           NEW (mingla.com landing — Cycle 15)
│   ├── business/
│   │   └── login/page.tsx                 NEW (organiser login — Cycle 15)
│   ├── auth/
│   │   └── callback/route.ts              NEW (Supabase code exchange handler per DEC-076)
│   ├── e/[slug]/
│   │   ├── page.tsx                       NEW (public event page — Cycle 6)
│   │   ├── sold-out/page.tsx              NEW (variant — Cycle 6)
│   │   ├── past/page.tsx                  NEW (variant — Cycle 6)
│   │   ├── pre-sale/page.tsx              NEW (variant — Cycle 6)
│   │   ├── protected/page.tsx             NEW (password gate — Cycle 6)
│   │   └── apply/page.tsx                 NEW (approval-required apply — Cycle 6)
│   ├── b/[slug]/page.tsx                  NEW (public brand page — Cycle 7)
│   ├── o/[slug]/page.tsx                  NEW (public organiser page — Cycle 7, gated by Q-A4 adopted)
│   └── checkout/[eventId]/
│       ├── page.tsx                       NEW (ticket selection — Cycle 8)
│       ├── buyer/page.tsx                 NEW (buyer details — Cycle 8)
│       ├── payment/page.tsx               NEW (Stripe Element stub — Cycle 8)
│       ├── confirm/page.tsx               NEW (confirmation + QR — Cycle 8)
│       └── wallet/page.tsx                NEW (Apple/Google Wallet add — Cycle 8)
├── lib/
│   └── supabase/
│       ├── client.ts                      NEW (browser client per DEC-076)
│       └── server.ts                      NEW (server client with cookie domain `.mingla.com`)
├── components/                            NEW (mirror selected primitives from mingla-business/ui)
│   ├── GlassCard.tsx                      NEW (web-only; backdrop-filter + fallback)
│   ├── Button.tsx                         NEW (web-styled equivalent)
│   ├── MinglaMark.tsx                     NEW (shared SVG)
│   └── ...
├── styles/
│   ├── tokens.css                         NEW (copy from design package; eventually shared as workspace package)
│   └── globals.css                        NEW
├── middleware.ts                          NEW (Supabase session refresh per DEC-076)
├── next.config.ts                         NEW
├── package.json                           NEW
├── tsconfig.json                          NEW
└── README.md                              NEW (run `npm run dev`)
```

### A.4.3 Vercel multi-project configuration

Both codebases deploy under one Vercel project with routing:
- `mingla.com` → `mingla-web/` (Next.js)
- `business.mingla.com` → `mingla-business/` (Expo Web export)
- Cookie domain `.mingla.com` for cross-subdomain session portability per DEC-076

---

# Part B — Data Model

> **PRESERVED VERBATIM 2026-04-28 (DEC-071).** Per the frontend-first build sequence,
> the data model below remains the contract that the eventual backend cycles (B1–B6)
> implement. **No tables ship during UI cycles 1–17.** Stub data shapes in cycle spec
> blocks may differ slightly from these tables for prototype convenience; the canonical
> shape is what's documented here, and the eventual backend implementation conforms to
> it. If a UI cycle reveals a stub-data shape that doesn't fit this model, the
> implementor flags it for orchestrator re-spec.

> Every table below is **NEW** unless marked. RLS is on by default. Service role only used by edge functions, never by clients.

## B.1 Accounts & Identity

### `creator_accounts` (EXTEND existing)
- Existing: `user_id (FK auth.users)`, `business_name`, `email`, `display_name`, `avatar_url`, `created_at`
- **Add:** `phone_e164`, `default_brand_id (FK brands)`, `marketing_opt_in (bool)`, `deleted_at (timestamp, soft delete)`
- RLS: owner-only read/write via `auth.uid() = user_id`

### `account_deletion_requests` (NEW)
- `id`, `user_id`, `requested_at`, `scheduled_hard_delete_at`, `status (pending/cancelled/completed)`, `reason`, `metadata (JSONB)`
- RLS: owner read; service role write

## B.2 Brands & Teams

### `brands` (NEW)
- `id`, `account_id (FK creator_accounts)`, `name`, `slug (unique)`, `description`, `profile_photo_url`, `contact_email`, `contact_phone`, `social_links (JSONB)`, `custom_links (JSONB)`, `display_attendee_count (bool)`, `tax_settings (JSONB)`, `default_currency (3-char ISO)`, `stripe_connect_id`, `stripe_payouts_enabled (bool)`, `stripe_charges_enabled (bool)`, `created_at`, `updated_at`, `deleted_at`
- Indexes: `account_id`, `slug` (unique), `deleted_at IS NULL`
- RLS: account owner OR brand-team member with read role

### `brand_team_members` (NEW)
- `id`, `brand_id`, `user_id`, `role (account_owner / brand_admin / event_manager / finance_manager / marketing_manager / scanner)`, `invited_at`, `accepted_at`, `removed_at`, `permissions_override (JSONB)`
- RLS: brand admin OR self

### `brand_invitations` (NEW)
- `id`, `brand_id`, `email`, `role`, `invited_by`, `token`, `expires_at`, `accepted_at`
- RLS: brand admin only

## B.3 Events

### `events` (NEW — Mingla Business owned, distinct from consumer-side `experiences`)
- `id`, `brand_id`, `created_by`, `title`, `description`, `slug (unique within brand)`, `location_text`, `location_geo (POINT)`, `online_url (nullable)`, `is_online (bool)`, `is_recurring (bool)`, `is_multi_date (bool)`, `recurrence_rules (JSONB, RFC 5545 RRULE)`, `cover_media_url`, `cover_media_type (image/video/gif)`, `theme (JSONB: font_family, color_preset, custom_color)`, `organiser_contact (JSONB: name, photo_url, phone, email)`, `visibility (public/discover/private/hidden/draft)`, `show_on_discover (bool)`, `show_in_swipeable_deck (bool)`, `status (draft/scheduled/live/ended/cancelled)`, `published_at`, `timezone`, `created_at`, `updated_at`, `deleted_at`
- Indexes: `brand_id`, `slug`, `(brand_id, status)`, `published_at`
- RLS: brand team read; brand admin/event manager write; public reads via `events_public_view`

### `event_dates` (NEW)
- `id`, `event_id`, `start_at`, `end_at`, `timezone`, `is_master (bool, true for the canonical date)`, `override_title`, `override_description`, `override_location`, `created_at`, `updated_at`
- Indexes: `event_id`, `start_at`
- Reason for separate table: lets recurring/multi-date events have per-date overrides (PRD §3.1 "Edit details per event date")

## B.4 Tickets & Orders

### `ticket_types` (NEW)
- `id`, `event_id`, `name`, `description`, `price_cents`, `currency`, `quantity_total (nullable for unlimited)`, `is_unlimited (bool)`, `is_free (bool)`, `sale_start_at`, `sale_end_at`, `validity_start_at`, `validity_end_at`, `min_purchase_qty (default 1)`, `max_purchase_qty (nullable)`, `is_hidden (bool)`, `is_disabled (bool)`, `requires_approval (bool)`, `allow_transfers (bool)`, `password_protected (bool)`, `password_hash (nullable, bcrypt)`, `available_online (bool)`, `available_in_person (bool)`, `waitlist_enabled (bool)`, `display_order (int)`, `created_at`, `updated_at`, `deleted_at`
- Indexes: `event_id`, `(event_id, display_order)`
- RLS: brand team read; event manager / finance manager write

### `orders` (NEW)
- `id`, `event_id`, `buyer_user_id (nullable for door sales)`, `buyer_email`, `buyer_name`, `buyer_phone`, `total_cents`, `currency`, `payment_method (online_card / nfc / card_reader / cash / manual)`, `payment_status (pending / paid / failed / refunded / partial_refund)`, `stripe_payment_intent_id`, `stripe_charge_id`, `is_door_sale (bool)`, `created_by_scanner_id (nullable)`, `metadata (JSONB)`, `created_at`, `updated_at`
- Indexes: `event_id`, `buyer_user_id`, `created_at`, `payment_status`
- RLS: brand team read; event/finance manager write; buyer reads own

### `order_line_items` (NEW)
- `id`, `order_id`, `ticket_type_id`, `quantity`, `unit_price_cents`, `total_cents`
- RLS inherited via `order_id`

### `tickets` (NEW — issued attendee tickets)
- `id`, `order_id`, `ticket_type_id`, `event_id`, `attendee_name`, `attendee_email`, `attendee_phone`, `qr_code (unique secure token)`, `status (valid / used / void / transferred / refunded)`, `transferred_to_email`, `transferred_at`, `approval_status (auto / pending / approved / rejected)`, `approval_decided_by`, `approval_decided_at`, `created_at`, `used_at`, `used_by_scanner_id`
- Indexes: `qr_code (unique)`, `order_id`, `event_id`, `status`
- RLS: brand team read; service role write on issuance; scanner can update `status` to `used`

### `waitlist_entries` (NEW)
- `id`, `event_id`, `ticket_type_id`, `email`, `phone`, `name`, `status (waiting / invited / converted / expired)`, `invited_at`, `created_at`
- RLS: brand team read; service role write

## B.5 Scanners & Check-ins

### `scanner_invitations` (NEW)
- Similar to brand_invitations but scoped per-event
- `id`, `event_id`, `email`, `permissions (JSONB: { scan, take_payments })`, `token`, `expires_at`, `accepted_at`

### `event_scanners` (NEW)
- `id`, `event_id`, `user_id`, `permissions (JSONB)`, `assigned_by`, `assigned_at`, `removed_at`
- RLS: brand admin / event manager write; scanner self-read

### `scan_events` (NEW — append-only audit)
- `id`, `ticket_id`, `event_id`, `scanner_user_id`, `scan_result (success / duplicate / not_found / wrong_event / void)`, `scanned_at`, `client_offline (bool)`, `synced_at`, `device_id`, `metadata (JSONB)`
- Indexes: `ticket_id`, `event_id`, `scanned_at`
- RLS: brand team read; scanner write own

## B.6 Payments

### `stripe_connect_accounts` (NEW)
- `id`, `brand_id`, `stripe_account_id`, `account_type (standard/express/custom)`, `charges_enabled`, `payouts_enabled`, `requirements (JSONB)`, `created_at`, `updated_at`
- RLS: brand admin / finance manager only

### `payouts` (NEW)
- `id`, `brand_id`, `stripe_payout_id`, `amount_cents`, `currency`, `status (pending / paid / failed)`, `arrival_date`, `created_at`
- RLS: brand admin / finance manager only

### `refunds` (NEW)
- `id`, `order_id`, `stripe_refund_id`, `amount_cents`, `reason`, `initiated_by`, `status`, `created_at`
- RLS: brand admin / finance manager only

### `door_sales_ledger` (NEW)
- `id`, `event_id`, `order_id`, `scanner_user_id`, `payment_method`, `amount_cents`, `currency`, `reconciled (bool)`, `reconciled_at`, `notes`, `created_at`
- Append-only

### `payment_webhook_events` (NEW)
- `id`, `stripe_event_id (unique)`, `type`, `payload (JSONB)`, `processed (bool)`, `processed_at`, `error`, `created_at`
- For idempotent webhook processing

## B.7 Permissions & Audit

### `permissions_matrix` (NEW — config table or constants)
- Lookup of role → allowed actions; can be a TS constant if not user-editable

### `audit_log` (NEW — append-only, write from edge functions only)
- `id`, `user_id`, `brand_id (nullable)`, `event_id (nullable)`, `action (e.g., event.publish, ticket.refund)`, `target_type`, `target_id`, `before (JSONB)`, `after (JSONB)`, `ip`, `user_agent`, `created_at`
- Indexes: `user_id`, `brand_id`, `created_at`, `action`
- RLS: account owner read own; service role write

## B.8 Public Views (for unauthenticated reads)

### `events_public_view` — read-only view filtered to `visibility = public AND status IN ('scheduled', 'live')`
### `brands_public_view` — read-only view of public brand profile
### `organisers_public_view` — read-only view (account-level public profile if shipped)

## B.9 Post-MVP Tables (Listed for Architectural Awareness)

### Marketing (M14–M16)
- `email_campaigns`, `email_templates`, `email_recipients`, `email_consent`, `email_suppressions`
- `sms_campaigns`, `sms_consent`, `sms_suppressions`
- `customer_profiles`, `customer_tags`, `customer_journeys`, `customer_lifetime_value_snapshots`

### Tracking & Attribution (M17)
- `tracking_links`, `tracking_clicks`, `tracking_conversions`

### Analytics (M18)
- Materialized views for brand/event metrics (rolled up hourly)

### Chat Agent (M19+)
- `draft_events`, `chat_sessions`, `chat_messages`, `agent_tool_calls`

---

# Part C — API Surface

> **PRESERVED VERBATIM 2026-04-28 (DEC-071).** No edge functions, RPCs, or service-layer
> hooks ship during UI cycles 1–17. The list below is the contract the eventual backend
> cycles (B1–B6) implement. UI cycles use stub-data services that mirror these signatures
> in shape but resolve from in-memory fixtures. When a backend cycle wires a real edge
> function, the corresponding hook drops its stub and reads from Supabase via the same
> signature.

## C.1 Edge Functions (one per coarse-grained action)

### Account
- [ ] `account-create` (auto-runs on first OAuth)
- [ ] `account-update-profile`
- [ ] `account-update-settings`
- [ ] `account-request-deletion`
- [ ] `account-cancel-deletion`
- [ ] `account-finalise-deletion` (cron-triggered after 30-day grace)

### Brand
- [ ] `brand-create`
- [ ] `brand-update`
- [ ] `brand-delete`
- [ ] `brand-upload-photo`
- [ ] `brand-invite-member`
- [ ] `brand-accept-invitation`
- [ ] `brand-update-member-role`
- [ ] `brand-remove-member`
- [ ] `brand-stripe-onboard` (creates Connect account + onboarding link)
- [ ] `brand-stripe-refresh-status`
- [ ] `brand-export-finance-report`

### Event
- [ ] `event-create-draft`
- [ ] `event-update-field` (generic field-update for chat agent later)
- [ ] `event-update` (full update for forms)
- [ ] `event-delete`
- [ ] `event-publish`
- [ ] `event-unpublish`
- [ ] `event-duplicate`
- [ ] `event-add-date`
- [ ] `event-update-date`
- [ ] `event-remove-date`
- [ ] `event-upload-cover-media`
- [ ] `event-generate-preview` (returns preview URL)
- [ ] `event-validate-draft` (returns missing required fields — agent uses)

### Ticket
- [ ] `ticket-type-create`
- [ ] `ticket-type-update`
- [ ] `ticket-type-delete`
- [ ] `ticket-type-toggle-visibility`
- [ ] `ticket-issue` (called from successful checkout)
- [ ] `ticket-resend` (re-emails ticket)
- [ ] `ticket-transfer`
- [ ] `ticket-void`
- [ ] `ticket-approve` (for approval-required types)
- [ ] `ticket-reject`

### Order & Checkout
- [ ] `checkout-create-payment-intent` (online buyer)
- [ ] `checkout-confirm-order` (Stripe webhook entry)
- [ ] `order-refund`
- [ ] `order-cancel`
- [ ] `order-export` (CSV)
- [ ] `door-sale-create` (scanner-initiated)
- [ ] `door-sale-record-cash`

### Scanner
- [ ] `scanner-invite`
- [ ] `scanner-accept-invitation`
- [ ] `scanner-validate-ticket` (online scan)
- [ ] `scanner-sync-offline-scans` (batch upload)
- [ ] `scanner-manual-checkin`
- [ ] `scanner-revoke-access`

### Webhooks
- [ ] `stripe-webhook` (idempotent, signature-verified)
- [ ] `apple-server-notifications` (post-MVP if needed for IAP)

### Public
- [ ] `public-event-by-slug`
- [ ] `public-brand-by-slug`
- [ ] `public-organiser-by-slug`

### Account Deletion
- [ ] `account-deletion-cron` (scheduled function, runs daily)

## C.2 RPC Functions (PostgreSQL functions for performance-sensitive reads)

- [ ] `get_event_overview(event_id)` — returns counts in one trip
- [ ] `get_brand_dashboard(brand_id)` — events, GMV, etc.
- [ ] `get_ticket_inventory(event_id)` — sold/total per ticket type
- [ ] `validate_draft_event(event_id)` — returns missing required fields

## C.3 Service-layer Hooks (Mobile + Web)

Every edge function gets a wrapped service in `src/services/*` and a React Query hook in `src/hooks/*`. Pattern:

```ts
// services/brandService.ts
export async function createBrand(input: CreateBrandInput): Promise<Brand> {
  const { data, error } = await trackedInvoke('brand-create', { body: input });
  if (error) throw extractFunctionError(error);
  return data;
}

// hooks/useBrand.ts
export function useCreateBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBrand,
    onSuccess: () => qc.invalidateQueries({ queryKey: brandKeys.all }),
  });
}
```

---

# Part D — UI / UX Plan

## D.1 Mobile + Web Parity Strategy

- Single Expo codebase deploys to iOS, Android, web.
- All UI primitives live in `src/components/ui/*` and use platform branches only when no cross-platform option exists.
- Web-specific overrides via `*.web.tsx` extensions only when truly necessary (e.g., DatePicker, NFC-disabled state).
- Tablets and desktop web get larger layouts via responsive helpers; same screens, different containers.

## D.2 Bottom Navigation (Locked Order)

1. **Home** — at-a-glance dashboard (current brand + KPIs)
2. **Events** — event list per current brand
3. **Chat** — placeholder until M20; then chat agent
4. **Account** — profile, settings, brand switcher, sign out, delete

## D.3 Screen-by-Screen Inventory

### Auth (existing)
- [x] Welcome → Google / Apple sign-in
- [x] Sign in → Home

### Onboarding (M1)
- [ ] Step 1 — Welcome (founder voice copy)
- [ ] Step 2 — Confirm display name + phone (optional)
- [ ] Step 3 — Create your first brand (or skip + create later)
- [ ] Step 4 — "What kind of events do you run?" (optional, for analytics)

### Account (M1)
- [ ] Account home (avatar, name, email, brand list, sign out, delete)
- [ ] Edit profile
- [ ] Settings (notifications, locale, timezone)
- [ ] Delete account flow:
  - Step 1: confirm intent + show consequences
  - Step 2: detach Stripe Connect from each brand
  - Step 3: type-to-confirm
  - Step 4: schedule deletion, immediate sign-out
  - Step 5: 30-day cancel-window screen accessible from email

### Brand (M2 / M3 / M12)
- [ ] Create brand
- [ ] Brand profile view (founder + public preview tabs)
- [ ] Brand profile edit (photo, bio, contact, social, custom links)
- [ ] Brand switcher (modal sheet on mobile, dropdown on web)
- [ ] Brand settings
- [ ] Brand payments (Stripe status, balance, payout history, fees, refunds)
- [ ] Brand team (members list, invite, role assignment, remove)
- [ ] Brand finance export

### Event Creation (M4 / M5)
- [ ] Event creator screen 1 — title, description
- [ ] Event creator screen 2 — date/time (single, recurring, multi-date)
- [ ] Event creator screen 3 — location (geocoded picker, online toggle)
- [ ] Event creator screen 4 — media (image/video/GIF library + upload)
- [ ] Event creator screen 5 — theme (font + color preset + custom color)
- [ ] Event creator screen 6 — organiser contact
- [ ] Event creator screen 7 — visibility (public, discover, swipeable deck toggles)
- [ ] Preview modal (renders public event page within app)
- [ ] Save draft / Publish

### Tickets (M6)
- [ ] Ticket type list per event
- [ ] Create ticket type (price, qty, unlimited, free, sale period, validity period, descriptions)
- [ ] Advanced ticket settings (hidden, disabled, approval, transfers, password, online/in-person, waitlist)
- [ ] Reorder ticket types
- [ ] Edit / archive ticket type

### Public Pages (M7)
- [ ] Public event page (mobile + web) — hero, description, organiser, ticket selector, share buttons, OG tags
- [ ] Public brand page (mobile + web) — bio, upcoming events
- [ ] Public organiser page (mobile + web) — account-level showcase if shipped

### Checkout (M8)
- [ ] Ticket selection (qty inputs per type, max-per-customer enforcement)
- [ ] Buyer details (name, email, phone)
- [ ] Stripe Payment Element (web + mobile)
- [ ] Order confirmation (with QR ticket)
- [ ] Email + SMS confirmation
- [ ] Apple Pay / Google Pay (mobile + web)

### Event Management (M9)
- [ ] Event overview (KPIs: tickets sold, revenue, scans %, capacity)
- [ ] Date selector (for multi-date events)
- [ ] Orders list (search, filter, export, refund, cancel, resend)
- [ ] Guest list (approve/reject, manual add, manual check-in, search, export)
- [ ] Settings tab (re-edit event, visibility, availability)
- [ ] Share event modal

### Scanner (M10)
- [ ] Scanner-mode landing
- [ ] Camera scan view (success/duplicate/fail haptics + visual)
- [ ] Manual lookup (search by name/email)
- [ ] Manual check-in
- [ ] Offline queue indicator
- [ ] Activity log (scans done by me)

### In-Person Payments (M11)
- [ ] Door sale flow (select tickets, take payment)
- [ ] Card reader connect (Stripe Terminal)
- [ ] Cash entry
- [ ] NFC tap (mobile only, gated by feature flag)
- [ ] Door receipt
- [ ] Reconciliation report

### Permissions (M12)
- [ ] Brand team screen (already in M2 spec) extended with role-by-feature matrix
- [ ] Permission audit screen for owner

### Chat Menu (M19/M20 — placeholder until then)
- [ ] Empty state ("Coming soon — describe your event in one sentence and we'll build it")
- [ ] Chat thread (M20)
- [ ] In-chat UI cards (date, ticket, visibility, payment, marketing)
- [ ] Live preview pane
- [ ] Publish-confirm gate

## D.4 Cross-Cutting UX Rules

- Every destructive action confirms with type-to-confirm or a hold-to-confirm gesture.
- Every form has loading + error + success states. No silent failures.
- Every list has empty state copy + primary action.
- Every screen has accessibility labels for VoiceOver / TalkBack.
- Every modal/sheet supports back-button / escape.
- Every public page is shareable; share intent generates canonical URL.

---

# Part E — Workflows (Sequence Outlines)

## E.1 Sign in → Create First Brand → Publish First Event

```
User → Welcome → Google sign-in → AuthContext detects session
     → ensureCreatorAccount() upserts row
     → BrandContext sees no brands → push to /brand/create
     → Brand created → BrandContext.currentBrand set → push to /
     → Home shows empty state "Create your first event"
     → User taps → /event/create → fills 7 steps → preview → publish
     → publish RPC validates (RLS check + brand has Stripe live)
     → status = scheduled → public URL active
     → Event appears in /events list
```

## E.2 Attendee Buys Online

```
Attendee → public event page (web or mobile) → select ticket type & qty
        → Stripe Payment Element → confirm
        → checkout-create-payment-intent (server) returns clientSecret
        → Stripe confirms → webhook hits stripe-webhook
        → checkout-confirm-order issues tickets, creates QR, emails buyer
        → Realtime: organiser sees order on event overview live
```

## E.3 Door Sale by Scanner

```
Scanner → /scanner → /scanner/scan → camera scans QR (no QR? → /lookup → manual)
        → if door sale needed: /scanner → "Sell at door" → select ticket → take payment
        → door-sale-create → ticket-issue → QR rendered for attendee
        → reconcile_at_close on event end-of-night cron
```

## E.4 Account Deletion

```
User → Account → Delete account → consequences screen → type-to-confirm
     → account-request-deletion → soft-deletes account row, schedules hard-delete +30d
     → for each brand: brand-stripe-detach (or transfer ownership)
     → all sessions revoked → user signed out
     → 30 days later: account-deletion-cron hard-deletes all orphaned rows
     → audit_log records every step
```

---

# Part F — Cross-Cutting Concerns

## F.1 Testing Strategy

| Layer | Tool | Coverage Target |
|-------|------|----------------|
| Unit (TS) | Vitest | 80% on services + hooks |
| Component (RN) | React Native Testing Library | Smoke per screen |
| Web e2e | Playwright | Every MVP user flow |
| Mobile e2e | Maestro (preferred) or Detox | Every MVP user flow |
| RLS | pgTAP or Supabase test harness | Every policy |
| Visual regression | Percy or Chromatic (web only) | Every public page |
| Stripe webhooks | Stripe CLI replay | Every webhook handler |

## F.2 Observability

- **Sentry** — JS errors mobile + web; release tagged per build
- **Supabase logs** — edge function tracing
- **Mixpanel** — product analytics events (locked event taxonomy in M0)
- **AppsFlyer** — install + revenue attribution
- **Custom dashboards** — Supabase → admin app for finance reconciliation

## F.3 Security

- RLS deny-by-default on every table
- No client uses service role
- All edge functions verify JWT + check role/membership
- Stripe webhooks signature-verified
- Idempotency keys on every payment + every destructive action
- Audit log for every sensitive write
- Secrets in EAS / Supabase env, never in repo

## F.4 Internationalisation

- v1 English only. Currency-aware UI per memory (formats use `Intl.NumberFormat`).
- All copy lives in `src/copy/*` for future i18n migration.
- Date/time always stored UTC, displayed in event timezone.

## F.5 Accessibility

- All buttons have accessible labels.
- Color contrast meets WCAG AA.
- All forms operable via keyboard on web.
- Screen reader testing per milestone.

## F.6 Performance

- Bundle size budget: mobile < 12 MB, web initial < 300 KB gzipped
- Public event page LCP < 2.5s on 3G
- Cold app startup < 2.5s on iPhone 12
- Realtime subscription concurrency capped per session

---

# Part G — Per-Cycle Task List

> **REPLACED 2026-04-28 (DEC-071, DEC-070).** The original M0–M13 milestone task lists are superseded by the journey-driven cycle structure in `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md`. Each cycle has its own per-cycle spec block (Sections 6 + 7 of the roadmap) covering: codebase, journeys covered, source files, target files, stub data shape, mobile + web parity check, acceptance criteria, founder sign-off prompt, refinement loop, dependencies, estimated effort.

Per-cycle authority chain:

1. Frontend Journey Build Roadmap (`SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md`) — the master sequence.
2. Journey Gap Audit (`AUDIT_BIZ_JOURNEY_GAPS.md`) — what design-package coverage looks like per journey (FULL / PARTIAL / SILENT).
3. Designer Handoff (`HANDOFF_BUSINESS_DESIGNER.md`) — the visual spec for every screen.
4. Design Package (`Mingla_Artifacts/design-package/`) — the source-of-record HTML/CSS/JSX prototype.

**Backend cycles B1–B6** ship after Cycle 17 founder sign-off; their task lists will be specced separately by orchestrator + forensics dispatches once the UI is shippable-grade. The data model in §B and API surface in §C are preserved verbatim as the contract those backend cycles implement.

---
# Part H — Post-MVP Milestones (Outline)

> Detailed task lists deferred. Captured here so dependencies are visible.

## M14 — Marketing v1 (Email)
Schema: campaigns, templates, recipients, consent, suppressions. Edge fns: `email-campaign-create/send/test`. Resend integration. Compliance: double opt-in, unsubscribe, CAN-SPAM/GDPR.

## M15 — Marketing v1 (SMS)
Schema: sms_campaigns, opt-in. Twilio integration. Compliance: STOP keyword, sender registration (US/UK).

## M16 — CRM + Nurturing
Customer profiles, tags, journeys, re-engagement. CLV snapshots.

## M17 — Tracking + Attribution
tracking_links, clicks, conversions. UTM params on every public URL. Attribution dashboards.

## M18 — Analytics Dashboards
Brand + event analytics. Materialized views for performance.

## M19 — Chat Agent Foundation
Agent-ready APIs (PRD §U.3). Schema-fill loop. Draft state. Missing-field detection. No UI yet.

## M20 — Chat Agent MVP
Bottom-nav chat menu. Free-text → draft → preview → publish (PRD §U.14). Co-pilot confirmations.

## M21 — Agent Upgrades
AI descriptions, ticket setup, marketing copy, pricing defaults (PRD §U.11 Phase 5).

---

# Part I — Dependency Map

```
M0 (Foundations)
 └─→ M1 (Account)
      └─→ M2 (Brands)
           ├─→ M3 (Stripe Connect)        ─┐
           │                                ├─→ M8 (Online Checkout)
           ├─→ M4 (Event Core)             ─┤
           │    └─→ M5 (Recurring)         │
           │         └─→ M6 (Tickets)      ─┤
           │              └─→ M7 (Public Pages)
           │                                │
           ├─→ M12 (Permissions UI)         │
           │                                ▼
           │                          M9 (Event Mgmt)
           │                                │
           │                                ├─→ M10 (Scanner)
           │                                │
           │                                └─→ M11 (In-Person Pay)
           │
           └─→ M13 (Hardening) ←─ all of the above
                  │
                  ▼
              MVP launch
                  │
                  ├─→ M14, M15, M16 (Marketing)
                  ├─→ M17 (Tracking)
                  ├─→ M18 (Analytics)
                  └─→ M19 → M20 → M21 (Chat Agent)
```

---

# Part J — Per-PR Definition of Done

Every PR must satisfy:

- [ ] Lints + typechecks pass
- [ ] Unit tests pass
- [ ] e2e tests pass on web AND on at least one mobile platform
- [ ] RLS policies tested (if schema touched)
- [ ] Mobile + web parity verified manually (recorded in PR description)
- [ ] No `any` types added
- [ ] No service-role usage from client
- [ ] Audit log written for any sensitive action
- [ ] Cross-domain check completed (consumer app, admin app, business app)
- [ ] No imports from `app-mobile/src/services/board*`, `pairing*`, `recommendations*`, `boardDiscussion*`
- [ ] Sentry coverage on new error paths
- [ ] Mixpanel events emitted per locked taxonomy
- [ ] Decisions Log updated if a strategic question got resolved
- [ ] User-facing copy reviewed (no jargon, no AI-flavor)
- [ ] Reviewer signed off

---

# Part K — Glossary

- **Account** — a user identity at the top of the org tree. Owns brands.
- **Brand** — a business entity under an account. Owns events, finances, team, customers.
- **Event** — a publishable activity owned by a brand. Has dates, tickets, organiser contact, public page.
- **Event Date** — a single occurrence of an event (one row per date for recurring/multi-date events).
- **Ticket Type** — a SKU within an event (price, qty, rules).
- **Ticket** — an issued attendee QR (one per attendee).
- **Order** — a purchase containing 1+ ticket line items.
- **Scanner** — a person granted scan-only or scan+payment access to specific events.
- **Door Sale** — a scanner-initiated in-person purchase.
- **Throughput** — independently shippable, independently testable, end-to-end functional unit of work.
- **Parity** — feature works identically on mobile and web.
- **MVP** — Account → Brand → Event → Ticket → Checkout → Scan → Pay → Account-Delete, mobile + web.

---

# Part L — Maintenance & Living-Document Rules

- This plan is updated at every milestone-done.
- Every Decisions Log entry made during execution gets propagated up to PRD §99.
- Risks resolved get marked closed; new risks logged.
- Open questions resolved get logged with reasoning.
- Status / dates / owners can change but the structure cannot drift without a Decisions Log entry.

---

## 99. Decisions Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-04-28 | Project plan locked v1 with 22 milestones (M0–M21) | Mirrors Strategic Plan; granular task breakdown per milestone established. Throughput-first; mobile + web parity in every milestone. |
| 2026-04-28 | Repository layout planned | Clear separation: app routes, components by domain, services by domain, hooks by domain, store by concern, types codegenerated. |
| 2026-04-28 | Web parity served by Expo Web by default | Single codebase. Public-page stack revisitable in M7 if SEO/perf demands it. |
| 2026-04-28 | Forms = React Hook Form + Zod | Neither app currently has a form library; pick once and use everywhere. |
| 2026-04-28 | Codegenerated Supabase types | Single source of truth for DB shapes; eliminates drift. |
| 2026-04-28 | Forbidden imports from app-mobile = pairing, deck, board, recommendations | Dating-domain logic; cannot leak into Business. |
