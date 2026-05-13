# SPEC — ORCH-0815 Marketing Hub UI (Cycle B5 Phase A, Email-only)

**ORCH:** ORCH-0815
**Cycle:** B5 Phase A
**Type:** missing-feature + design-debt (UI/UX + schema + edge function)
**Severity:** S2 — not launch-blocking; high-value post-MVP growth capability
**Date:** 2026-05-12
**Owner:** Seth Ogieva
**Author:** mingla-orchestrator (Claude)
**Mode:** SPEC (no code; contract for implementor)

---

## 1. Plain-English Summary

This SPEC defines the Phase A Marketing Hub for `mingla-business`: a new
top-level "Marketing" tab on the bottom-nav AND contextual blast entry points
from inside events and brands. Brands compose Email-only campaigns to ticket
buyers (per-event or brand-rollup audiences), schedule or send immediately,
and track sent → delivered → opened → clicked → converted → revenue.

The hub UI is channel-agnostic from day one (Email enabled, SMS/RCS visible
but greyed-out pending verification) so future channels plug in without
rework. The buyer-audience data source is the existing `orders` table —
audiences are empty in production until ORCH-0777 (production ticket checkout)
populates real `orders` rows; the build can proceed in parallel.

---

## 2. Scope (In / Out)

### In scope (Phase A)

- Standalone "Marketing" tab on `mingla-business/app/(tabs)/` bottom-nav
- Four sub-surfaces: Overview, Audiences, Campaigns, Templates (+ Settings deferred to §2 out)
- Campaign composer (single-page, 4 numbered steps, live preview)
- Campaign scheduler (send-now or schedule-for-future)
- Email channel via Resend (one provider)
- Brand-level "Customers" tab on `mingla-business/app/brand/[id]/customers.tsx`
- Event-level "Buyers" tab on `mingla-business/app/event/[id]/buyers/index.tsx`
- Audience query shape supporting brand-rollup and event-scoped buyer queries
- Campaign history with per-campaign report (sent / delivered / opened / clicked / revenue)
- Unsubscribe flow + global suppression list read path
- Click tracking via Mingla redirect (`https://mingla.app/m/{trackingId}`)
- UTM-based attribution to `orders` (existing UTM column or new column TBD in §6)
- Schema for `marketing_campaigns`, `marketing_audiences`, `marketing_templates`, `marketing_messages`, `marketing_clicks`, `marketing_unsubscribes`
- One edge function `marketing-send` (Resend branch only in Phase A)
- One edge function `marketing-track-click` (redirect + click log)
- One edge function `marketing-unsubscribe` (one-click unsubscribe endpoint)
- One pg_cron job dispatching scheduled campaigns

### Explicitly out of scope (deferred to later B5 phases)

- **SMS channel** — gated on Twilio 10DLC verification (Phase B)
- **RCS channel** — gated on Twilio RBM brand verification (Phase C, see ORCH-0817 strategy)
- **Brand followers audience** — no follower schema yet (Phase D)
- **Consent enforcement at checkout** — Phase 0 (must precede live sending; not blocking the build of the hub UI)
- **AppsFlyer cross-platform attribution** — Phase F (M3); Phase A uses UTM-only attribution
- **Mingla-managed ads (Track 2)** — Phase E + F
- **Mingla Brain agent layer** — Cycle B6
- **Marketing → Settings sub-surface** (sender domain, suppression list management UI, brand defaults) — Phase A+ follow-up; Phase A reads suppression list, does not yet manage it via UI
- **Per-recipient timezone-aware scheduling** — Phase A schedules at one absolute time; per-recipient TZ smart-send is Phase A+ enhancement
- **A/B testing of subject lines** — Phase A+
- **Multi-language email templates** — Phase A+

### Live-broadcast hard dependency

Audiences read from `orders` rows. Until **ORCH-0777 (production ticket checkout)**
closes, `orders` is local/stubbed in `mingla-business` and audiences will be
empty in production. Phase A UI **may ship with mocked audiences for organiser
preview** (clearly labelled "Preview mode — your real buyers will appear here
after checkout is live"). The `Send` button MUST be gated so that scheduled
campaigns do not actually fire while audiences are stubbed. Once ORCH-0777
closes, the gate flips off via a single config flag.

---

## 3. User Flows (three doorways, one composer)

### Doorway A — Standalone Marketing tab

```
(tabs)/marketing → Overview
  ↓ tap "+ New campaign"
marketing/compose
  ↓ pick audience from dropdown
  ↓ pick channel (Email enabled; SMS/RCS greyed)
  ↓ write subject + body, see live preview
  ↓ pick send-now or schedule
  ↓ review locked compliance footer
  ↓ tap "Schedule" or "Send now"
marketing/campaigns?status=scheduled OR /campaigns?status=sent
  ↓ campaign appears in History
  ↓ taps row → marketing/campaigns/[id] report
```

### Doorway B — Event-context entry

```
event/[id] detail
  ↓ tap "Buyers (247)" sub-route
event/[id]/buyers
  ↓ tap sticky "Blast these 231 reachable buyers" CTA
marketing/compose?audience=event:[id]
  ↓ composer opens with audience pre-filled to the event's buyers
  ↓ (same composer as Doorway A — single source)
```

### Doorway C — Brand-context entry (the "announce my next event" flow)

```
brand/[id] detail
  ↓ tap "Customers" tab
brand/[id]/customers
  ↓ tap "Blast these 387 customers" CTA
marketing/compose?audience=brand:[id]
  ↓ composer opens with audience pre-filled to all brand buyers
  ↓ (same composer as Doorway A — single source)
```

All three doorways resolve to the same composer route. State and behaviour
are identical. The pre-fill is driven by query params (`audience=brand:[id]`
or `audience=event:[id]`); the composer reads the audience identifier,
resolves it via the audiences service, and renders.

---

## 4. Information Architecture

### 4.1 New routes

```
mingla-business/app/(tabs)/marketing/
  _layout.tsx                  → top-level "Marketing" tab layout with sub-nav
  index.tsx                    → Overview (default landing)
  audiences/
    index.tsx                  → Audiences list
    [id].tsx                   → Audience detail (read-only contact list + edit)
  campaigns/
    index.tsx                  → Campaigns history
    compose.tsx                → Composer
    [id].tsx                   → Campaign report
  templates/
    index.tsx                  → Templates list
    [id].tsx                   → Template detail (read + edit)

mingla-business/app/brand/[id]/customers.tsx
  → new permanent "Customers" tab on brand surface

mingla-business/app/event/[id]/buyers/index.tsx
  → new permanent "Buyers (N)" tab on event surface
```

### 4.2 Bottom-nav update

`mingla-business/app/(tabs)/_layout.tsx` TABS array adds a 4th entry:

```typescript
const TABS: BottomNavTab[] = [
  { id: "home", icon: "home", label: "Home" },
  { id: "events", icon: "calendar", label: "Events" },
  { id: "marketing", icon: "megaphone", label: "Marketing" },  // NEW
  { id: "account", icon: "user", label: "Account" },
];
```

The pre-existing comment at lines 6-7 of `_layout.tsx` already anticipates
this expansion ("Future-4-tab when Marketing ships in Cycle 12" — Cycle ID
correction note: it's actually Cycle B5 per the canonical cycle roadmap;
the comment reference is historical and may be updated in the implementor
PR).

`BottomNav` component must support 4 tabs visually. Today it renders 3.
Implementor verifies the existing capsule layout extends cleanly to 4 tabs;
if not, design tokens for tab-width must be re-derived.

### 4.3 Hub sub-navigation

Inside `/marketing`, the four sub-surfaces use a sticky segmented control at
the top of each screen (NOT a second bottom-nav). The composer route
(`/marketing/campaigns/compose`) hides the sub-nav and shows a back chevron
instead.

---

## 5. Screen Contracts

For each screen below: data dependencies, primary actions, empty state,
loading state, error state, design tokens, accessibility requirements.

### 5.1 Marketing → Overview (`(tabs)/marketing/index.tsx`)

**Data:**
- Query 1: aggregate campaign metrics (last 30 days) — sum sent/delivered/opened/clicked/revenue
- Query 2: 3 most-recent sent or scheduled campaigns

**Layout (top-down):**
1. Sub-nav segmented control: [Overview] · Audiences · Campaigns · Templates
2. Hero card — headline "Revenue from blasts" with $ value + delta vs prior 30 days
3. Four metric cards in row — Sent / Delivered / Opened / Clicked with % rate
4. "Recent campaigns" list (3 most recent)
5. Floating "+ New campaign" CTA bottom-right (FAB pattern)

**Empty state:** "You have N buyers across M brands. Let them know about your next event." + "+ New campaign" primary CTA.

**Loading state:** Skeleton cards (4 metric cards + 3 list rows).

**Error state:** Toast banner above content with "Couldn't load metrics — pull to retry."

**Design tokens:** `mingla-business/src/constants/designSystem.ts` (same surface treatment as Home tab).

**Accessibility:** All cards have `accessibilityLabel`; FAB has 44pt touch target (I-38).

### 5.2 Marketing → Audiences (`(tabs)/marketing/audiences/index.tsx`)

**Data:** list of audiences (server-derived "All buyers — {Brand}" auto-generated per brand the account manages, plus per-event audiences auto-generated per event with ≥1 paid order).

**Layout:**
1. Sub-nav
2. Header "Your audiences" + "[+ New audience]" deferred button (greyed in Phase A — saved-query creation is Phase A+)
3. List of audience cards — each shows name, total people, "reachable" count (people with marketing consent for ≥1 enabled channel)
4. "Coming soon" section: Brand followers (greyed), Custom segment (greyed)

**Per-row card data:**
- Audience name
- Total count + reachable count
- "Updated live from orders" caption
- Tap → audience detail screen

**Empty state:** "No buyers yet. Audiences fill in automatically as people buy tickets." (visible when account has zero `orders` rows across all managed brands.)

### 5.3 Marketing → Audience detail (`(tabs)/marketing/audiences/[id].tsx`)

**Data:** resolve audience query → list of contacts (paginated 50/page).

**Layout:**
1. Audience name + counts
2. Filter pills: All · Marketing-consenting · No marketing consent
3. Contact list (same row layout as Brand Customers tab — §5.7)
4. Sticky bottom CTA: "[Blast these N people →]" (count reflects current filter)

### 5.4 Marketing → Campaigns (`(tabs)/marketing/campaigns/index.tsx`)

**Data:** all campaigns the account has authored, descending by `created_at`.

**Layout:**
1. Sub-nav
2. Filter pills: All · Scheduled · Sent · Drafts · Failed
3. Card list per campaign with status icon + name + meta + actions

**Per-row card data:**
- Status icon: ⏰ scheduled · ✉ sent · 📝 draft · ⚠ failed
- Campaign name
- For scheduled: "Scheduled for {date} · N recipients" + [Edit] [Cancel]
- For sent: "Sent {date} · N recipients · X% opened · Y% clicked · $Z revenue" + [View report]
- For draft: "Saved {time} ago · No audience selected" (or audience name if picked) + [Resume]

**FAB:** "[+ New campaign]" bottom-right.

### 5.5 Marketing → Composer (`(tabs)/marketing/campaigns/compose.tsx`)

**Data:**
- Query params: optional `audience=brand:[id]` or `audience=event:[id]` for pre-fill
- Existing draft if returning from saved state (`?draft=[id]`)
- Brand profile fields for compliance auto-fill (address, sender domain, reply-to)

**State machine:**

```
INIT → resolve audience (if query param) → ready
ready → editing
editing → previewing (live preview pane / sheet)
editing → save_draft → ready_with_draft
ready → review (show review modal with audience + content + schedule)
review → schedule_or_send → sending → sent_confirmation
review → cancel → editing
sending → error → editing (with error banner)
```

**Layout (vertical, single page):**

1. Header: `← New campaign` left chevron + `[Save draft]` right action
2. Step 1: Who
   - Audience dropdown (BottomSheet picker on mobile)
   - Live reach count: "N people · M with marketing consent"
3. Step 2: What
   - Channel tabs: [✉ Email] [📱 SMS — pending] [💬 RCS — pending] (only Email tappable in Phase A)
   - Subject TextInput
   - Body TextInput (multiline, ≥6 rows)
   - "[+ Insert event card]" action — opens BottomSheet to pick an event from the brand's catalogue; inserts a rendered event-card block into the email body (rendered as MJML/HTML block in the final email, displayed as a single line `{{event:[id]}}` token in the textarea for editing)
   - Live preview link (mobile) / pane (tablet+web)
4. Step 3: When
   - Radio: ○ Send now · ● Schedule
   - DateTimePicker (visible when Schedule selected) — single absolute time in brand's local timezone (per-recipient TZ is Phase A+)
   - Helper text under DateTimePicker showing best-practice window
5. Step 4: Compliance (read-only, locked)
   - "From: {Brand name} via Mingla"
   - "Reply-to: {brand reply email}"
   - "Unsubscribe link: appended automatically"
   - "Brand address: {brand address}"
   - Info note about cross-brand unsubscribe honoring
6. Footer: `[Save draft]` left · `[Review & schedule →]` right (disabled until all required fields present)

**Review modal/sheet:**
- Show audience, channel, subject, body preview, scheduled time, compliance summary
- Final `[Schedule]` (or `[Send now]`) primary CTA
- `[Back to edit]` secondary

**Sent confirmation:**
- "Your campaign is scheduled for {date}" (or "Your campaign is sending now")
- "[View in campaigns]" CTA → /marketing/campaigns
- Auto-dismiss after 3 seconds OR after tap

**Hard requirements:**
- TextInputs MUST follow Mingla keyboard-rule (`feedback_keyboard_never_blocks_input.md`): keyboard listener + dynamic `paddingBottom` + deferred `scrollToEnd` via `requestAnimationFrame`
- Save-draft writes happen on every field debounce 800ms — never lose draft on app backgrounding
- Cancel-from-review returns to editing with all state preserved
- Sub-sheets (audience picker, event picker) MUST be rendered INSIDE parent Sheet per `feedback_rn_sub_sheet_must_render_inside_parent.md`

### 5.6 Marketing → Campaign report (`(tabs)/marketing/campaigns/[id].tsx`)

**Data:** campaign row + aggregated `marketing_messages` deliveries + `marketing_clicks` + `orders` rows attributed via UTM.

**Layout:**
1. Header: ← campaign name · sent-date subtitle
2. Hero: "💰 ${revenue} revenue ({N} conversions · ${avg} avg)"
3. Funnel row: Sent / Delivered / Opened / Clicked counts + percentages
4. "Click destinations" mini bar chart — top URLs clicked
5. "Conversions over time" sparkline — hourly purchases for 24h post-send
6. "Top buyers from this campaign" list — top 5 conversions with name + $ + timestamp
7. Footer actions: `[Duplicate]` `[Save as template]`

**Empty data states:**
- 0 conversions: show funnel only, hide hero $ value, replace with "No purchases yet from this blast."
- 0 opens: show "Awaiting delivery — Resend reports within ~5 minutes."

### 5.7 Brand → Customers tab (`brand/[id]/customers.tsx`)

**Data:** all distinct buyers of brand's events from `orders` table where
`event.brand_id = [id]` and `payment_status IN ('paid','partial_refund')`,
left-joined with global `marketing_unsubscribes` to compute reachable.

**Layout:**
1. Header: ← Brand name
2. Existing brand tab strip: Overview · Events · Team · [Customers] · Settings — Customers is NEW
3. Counts: "412 customers · 387 reachable"
4. Sticky "[Blast these 387 customers →]" CTA
5. Filter pills: [All] [This year] [Filter ▾]
6. Filter sheet: by event, date range, consent state, min/max spend
7. Customer rows (paginated 25/page):
   - Customer name (or "Anonymous buyer" if no name)
   - Masked email (`ale**@gmail.com`) and/or phone (`(555) ***-1234`)
   - "N orders · ${total} total"
   - "Last: {event name} · {relative date}"
   - Consent state icons: `✉ marketing OK` / `📱 SMS OK` / `✉ transactional only` etc.
   - Tap row → customer detail (read-only purchase history with this brand)
8. "[Load more (N) →]" pagination

**Permissions:** RLS gates this view on the brand-team-member role having at least `brand_member` rank for the brand (read-only) or higher for blast actions. Implementor verifies against `biz_brand_effective_rank_for_caller(brand_uuid) >= biz_role_rank('brand_member')` for read; `>= biz_role_rank('event_manager')` for the blast CTA.

### 5.8 Event → Buyers tab (`event/[id]/buyers/index.tsx`)

**Data:** distinct buyers of one event from `orders` where `event_id = [id]`.

**Layout:**
- Same row layout as §5.7 (single shared component `BuyerRow`)
- Filter pills scoped to this event's ticket types
- Sticky "[Blast these N buyers →]" CTA → composer with `audience=event:[id]`

### 5.9 Marketing → Templates (`(tabs)/marketing/templates/index.tsx`)

**Layout:**
1. Sub-nav
2. "Your templates" list (user-created)
3. "Mingla starter pack" list (curated, read-only seeds)
4. FAB `[+ New template]`

**Starter pack seeded by migration** (5 templates):
- Last call — N spots left
- Pre-event reminder (24h)
- Thank you for coming
- Similar upcoming event
- Re-engagement (haven't bought in 60 days)

**Template detail (`templates/[id].tsx`):**
- Subject + body editor with variable placeholders (`{first_name}`, `{event_name}`, `{event_date}`)
- "Use this template" CTA → /marketing/campaigns/compose?template=[id]
- Delete (user templates only) / Duplicate

---

## 6. Schema Additions

All schema lives in a single migration:
`supabase/migrations/[timestamp]_orch_0815_marketing_hub_phase_a.sql`

### 6.1 Tables

```sql
-- Reusable saved-query audiences
CREATE TABLE marketing_audiences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES auth.users(id),
  brand_id         uuid REFERENCES brands(id) ON DELETE CASCADE,
  name             text NOT NULL,
  query_definition jsonb NOT NULL,  -- declarative shape, see §6.3
  is_system_generated boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Campaign records
CREATE TABLE marketing_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES auth.users(id),
  brand_id        uuid NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  audience_id     uuid NOT NULL REFERENCES marketing_audiences(id) ON DELETE RESTRICT,
  template_id     uuid REFERENCES marketing_templates(id) ON DELETE SET NULL,
  name            text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email','sms','rcs')),
  channel_payload jsonb NOT NULL,  -- channel-specific content, see §6.4
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_for   timestamptz,
  sent_at         timestamptz,
  recipient_count integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Per-recipient delivery log
CREATE TABLE marketing_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  recipient_email  text,
  recipient_phone  text,
  channel          text NOT NULL CHECK (channel IN ('email','sms','rcs')),
  provider_message_id text,
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','sent','delivered','opened','clicked','bounced','failed','unsubscribed')),
  sent_at          timestamptz,
  delivered_at     timestamptz,
  opened_at        timestamptz,
  last_clicked_at  timestamptz,
  click_count      integer NOT NULL DEFAULT 0,
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Click tracking
CREATE TABLE marketing_clicks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  message_id      uuid REFERENCES marketing_messages(id) ON DELETE SET NULL,
  destination_url text NOT NULL,
  tracking_id     text NOT NULL UNIQUE,
  clicked_at      timestamptz,
  user_agent      text,
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Reusable content templates
CREATE TABLE marketing_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid REFERENCES auth.users(id),  -- nullable for Mingla starter pack
  brand_id        uuid REFERENCES brands(id) ON DELETE CASCADE,
  name            text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email','sms','rcs')),
  subject_template text,
  body_template   text NOT NULL,
  is_starter_pack boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Global suppression
CREATE TABLE marketing_unsubscribes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_email text,
  contact_phone text,
  channel     text NOT NULL CHECK (channel IN ('email','sms','rcs','all')),
  scope       text NOT NULL CHECK (scope IN ('account','brand','global')),
  brand_id    uuid REFERENCES brands(id) ON DELETE CASCADE,  -- when scope='brand'
  account_id  uuid REFERENCES auth.users(id),                -- when scope='account'
  reason      text,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT either_email_or_phone CHECK (
    (contact_email IS NOT NULL AND contact_phone IS NULL) OR
    (contact_email IS NULL AND contact_phone IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_unsub_email_channel_scope
  ON marketing_unsubscribes (contact_email, channel, scope, COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE contact_email IS NOT NULL;
```

### 6.2 Indexes

```sql
CREATE INDEX idx_audiences_account_brand ON marketing_audiences(account_id, brand_id);
CREATE INDEX idx_campaigns_account_status ON marketing_campaigns(account_id, status);
CREATE INDEX idx_campaigns_scheduled_for ON marketing_campaigns(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX idx_messages_campaign_status ON marketing_messages(campaign_id, status);
CREATE INDEX idx_messages_recipient_email ON marketing_messages(recipient_email);
CREATE INDEX idx_clicks_tracking_id ON marketing_clicks(tracking_id);
CREATE INDEX idx_templates_account_brand ON marketing_templates(account_id, brand_id) WHERE NOT is_starter_pack;
```

### 6.3 `marketing_audiences.query_definition jsonb` shape

**Brand-rollup audience:**
```json
{
  "kind": "brand_buyers",
  "brand_id": "uuid",
  "payment_statuses": ["paid", "partial_refund"]
}
```

**Event-scoped audience:**
```json
{
  "kind": "event_buyers",
  "event_id": "uuid",
  "payment_statuses": ["paid", "partial_refund"]
}
```

**Future (Phase D — brand followers):**
```json
{ "kind": "brand_followers", "brand_id": "uuid" }
```

**Future (Phase A+ — custom segment):**
```json
{
  "kind": "custom_segment",
  "filters": [
    { "field": "total_spent", "op": "gte", "value": 100 },
    { "field": "last_purchase_within_days", "op": "lte", "value": 90 }
  ]
}
```

**Hard invariant (I-PROPOSED-BP, see §11):** every audience kind MUST be a
discriminated union with a `kind` field. NEW audience kinds add new `kind`
values, never new top-level shapes. This is what makes channel- and
audience-extension safe.

### 6.4 `marketing_campaigns.channel_payload jsonb` shape

**Email (Phase A):**
```json
{
  "kind": "email",
  "subject": "Last 50 tickets — see you Saturday",
  "body_html": "<p>Hi {first_name}...</p>",
  "body_text": "Hi {first_name}...",
  "embedded_events": ["uuid-of-event-card-1"]
}
```

**SMS (Phase B placeholder shape):**
```json
{
  "kind": "sms",
  "body": "Last 50 tickets at Sunset Rooftop — buy: {short_url}",
  "short_url_token": "abc123"
}
```

**RCS (Phase C placeholder shape):**
```json
{
  "kind": "rcs",
  "rich_card": { "title": "...", "image_url": "...", "buttons": [...] },
  "quick_replies": [...],
  "fallback_sms": "Last 50 tickets — buy: {short_url}"
}
```

**Hard invariant (I-PROPOSED-BQ):** every channel kind MUST be a discriminated
union with a `kind` field. Adding SMS/RCS in later phases adds new `kind`
values + new dispatcher branches; never modifies the Email shape.

### 6.5 RLS policies

All marketing tables:
- INSERT/UPDATE/DELETE gated on `account_id = auth.uid()` OR
  `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('event_manager')`
- SELECT gated on same predicates with direct-predicate owner-SELECT pair per
  `feedback_rls_returning_owner_gap.md` (no SECURITY DEFINER helpers for SELECT)

### 6.6 Migration apply-time probes

Migration MUST include `DO $$ ... RAISE EXCEPTION ... $$` probes verifying:
- All 6 tables created
- All foreign keys valid
- All CHECK constraints in place
- Starter-pack templates seeded with `is_starter_pack = true`
- RLS enabled on every table

Pattern per ORCH-0793 / ORCH-0795 / ORCH-0805 migration precedents.

---

## 7. Edge Functions

### 7.1 `supabase/functions/marketing-send/index.ts`

**Trigger:** pg_cron job every 1 minute for scheduled campaigns past their `scheduled_for`; ALSO callable directly for "send now."

**Logic:**
1. Find campaigns with `status='scheduled' AND scheduled_for <= now()` (limit 10/run); flip to `status='sending'` atomically
2. For each campaign:
   - Resolve audience via `query_definition` → list of contacts
   - Filter against `marketing_unsubscribes` (channel + scope match)
   - For each remaining contact:
     - Insert `marketing_messages` row with `status='queued'`
     - Generate per-link tracking IDs, insert `marketing_clicks` rows
     - Render email body with variable substitution
     - Call Resend with rendered HTML + plain-text
     - On success: update `marketing_messages.status='sent'` + provider message ID
     - On failure: update status='failed' + failure reason
3. After all contacts processed: flip campaign `status='sent'` + populate `sent_at` + `recipient_count`

**Channel routing (Phase A):**
```typescript
switch (campaign.channel_payload.kind) {
  case 'email': return sendEmail(...);  // Resend branch
  case 'sms':   throw new Error('sms_not_yet_enabled');  // Phase B
  case 'rcs':   throw new Error('rcs_not_yet_enabled');  // Phase C
  default:      throw new Error(`unknown_channel_kind:${kind}`);
}
```

**verify_jwt:** false (cron-triggered + service-role only).

### 7.2 `supabase/functions/marketing-track-click/index.ts`

**Public HTTP endpoint:** `GET /m/{trackingId}` (proxied via Mingla redirect domain).

**Logic:**
1. Look up `marketing_clicks` by `tracking_id`
2. Record `clicked_at` if first click for this tracking ID
3. Increment `marketing_messages.click_count` and update `last_clicked_at`
4. Append UTM params to destination URL (`utm_source=mingla&utm_medium=email&utm_campaign={campaign_id}`)
5. 302 redirect to destination

**verify_jwt:** false (public endpoint).

### 7.3 `supabase/functions/marketing-unsubscribe/index.ts`

**Public HTTP endpoint:** `GET /unsubscribe/{token}` linked from email footer.

**Logic:**
1. Decode token → resolve to `(campaign_id, recipient_email)`
2. Insert into `marketing_unsubscribes` with `scope='brand'` (per the campaign's brand)
3. Mark `marketing_messages.status='unsubscribed'`
4. Render confirmation page: "You won't receive marketing emails from {brand} anymore."
5. Offer "Unsubscribe from all Mingla brands" secondary link → escalates `scope='global'`

**verify_jwt:** false.

### 7.4 Live-broadcast gate

A single environment-flag `MARKETING_SEND_LIVE_ENABLED` (default `false`).
When `false`, `marketing-send` writes `marketing_messages` rows but does NOT
call Resend — it marks each as `status='preview_skipped'`. Operator flips the
flag to `true` after ORCH-0777 closes and audiences contain real buyers.

---

## 8. Component Architecture

### 8.1 Shared components (new)

```
mingla-business/src/components/marketing/
  MarketingSubNav.tsx              — segmented control (Overview/Audiences/Campaigns/Templates)
  MetricCard.tsx                   — single funnel metric tile
  CampaignCard.tsx                 — campaign list row
  AudienceCard.tsx                 — audience list row
  AudiencePickerSheet.tsx          — BottomSheet for composer audience picker
  ChannelTabs.tsx                  — Email/SMS/RCS tabs with greyed states
  ComposerStepWho.tsx              — composer step 1
  ComposerStepWhat.tsx             — composer step 2 (with embedded event card token)
  ComposerStepWhen.tsx             — composer step 3
  ComposerStepCompliance.tsx       — composer step 4 (read-only)
  EmailPreviewPane.tsx             — live preview render
  EventCardInserter.tsx            — picks an event, inserts {{event:id}} token
  CampaignReportHero.tsx           — revenue hero card
  CampaignReportFunnel.tsx         — sent/delivered/opened/clicked row
  CampaignReportSparkline.tsx      — conversions over time
  TemplateCard.tsx                 — template list row
  BuyerRow.tsx                     — shared customer/buyer row (used in §5.7 and §5.8)
  BuyerFilterSheet.tsx             — filter by event/date/consent/spend
  BlastCustomersCta.tsx            — sticky "Blast these N customers" button
```

### 8.2 Shared hooks (new)

```
mingla-business/src/hooks/marketing/
  useMarketingMetrics.ts           — Overview aggregates
  useAudiences.ts                  — list audiences (auto-system + user-created)
  useAudienceContacts.ts           — paginated contact list for an audience
  useCampaigns.ts                  — paginated campaign list with filter
  useCampaign.ts                   — single campaign with report aggregates
  useComposerDraft.ts              — composer state + debounced draft save
  useTemplates.ts                  — list user + starter-pack templates
  useTemplate.ts                   — single template
  useBrandCustomers.ts             — §5.7 data source
  useEventBuyers.ts                — §5.8 data source
```

### 8.3 Shared services (new)

```
mingla-business/src/services/marketing/
  marketingCampaignService.ts      — campaign CRUD
  marketingAudienceService.ts      — audience CRUD + query resolution
  marketingTemplateService.ts      — template CRUD
  marketingTrackingService.ts      — tracking-id generation, URL rewriting
  marketingComplianceService.ts    — read brand defaults for compliance section
```

### 8.4 Component rules (Mingla-bespoke)

- All TextInputs MUST implement keyboard-rule per `feedback_keyboard_never_blocks_input.md`
- All sub-sheets (audience picker, event picker, filter sheet) MUST render inside parent Sheet per `feedback_rn_sub_sheet_must_render_inside_parent.md`
- All inline-style colors hex/rgb/hsl/hwb only per `feedback_rn_color_formats.md` (no oklch/lab/lch/color-mix)
- All Toasts wrapped in absolute-positioned wrappers per `feedback_toast_needs_absolute_wrap.md`
- Anti-back-block listener pattern for composer dirty-state per `feedback_back_listener_disarm_pattern.md` — leaving composer with unsaved changes prompts "Save draft? / Discard?"
- All interactive elements ≥44pt touch target (I-38)
- All interactive Pressables have `accessibilityLabel` (I-39)
- Zustand persist holds IDs only, not server records (I-PROPOSED-J)

---

## 9. Channel-Extensibility Invariants (MANDATORY)

These invariants make Phase B (SMS) and Phase C (RCS) plug in without refactor:

| ID | Invariant | Enforcement |
|---|---|---|
| **I-PROPOSED-BP** | `marketing_audiences.query_definition` is a discriminated union with required `kind` field. New audience types ADD `kind` values; never modify existing shapes. | Strict-grep gate + jest schema test |
| **I-PROPOSED-BQ** | `marketing_campaigns.channel_payload` is a discriminated union with required `kind` field. New channels ADD `kind` values; never modify existing shapes. | Strict-grep gate + jest schema test |
| **I-PROPOSED-BR** | `marketing-send` edge fn routes via switch on `channel_payload.kind`. The switch has `default: throw` to detect unknown kinds. | Deno test of dispatcher |
| **I-PROPOSED-BS** | `ChannelTabs.tsx` renders all three tabs (Email/SMS/RCS) from day one. SMS/RCS are visually disabled but present in DOM. | Strict-grep gate |
| **I-PROPOSED-BT** | `BuyerRow.tsx` is the single shared component for Brand Customers tab and Event Buyers tab. No copy-paste. | Strict-grep gate (single-import check) |
| **I-PROPOSED-BU** | Composer pre-fill query param shape is `audience={kind}:{id}` (e.g., `brand:abc`, `event:xyz`). New audience kinds extend without breaking existing URLs. | Jest test + composer route handler |

All invariants flip DRAFT → ACTIVE on CLOSE.

---

## 10. Success Criteria

A successful Phase A implementation, verified by tester, must:

| SC | Criterion |
|---|---|
| SC-1 | A 4th "Marketing" tab is visible on `mingla-business` bottom-nav with `megaphone` icon; tap navigates to /marketing/index (Overview) |
| SC-2 | Overview renders Revenue hero + 4 funnel metric cards + 3-row recent campaigns list; pulls from real `marketing_messages` aggregates (mocked in dev, live after flag flip) |
| SC-3 | Audiences screen shows auto-system audiences "All buyers — {Brand}" per brand and "Buyers — {Event}" per event with ≥1 paid order; reach + reachable counts accurate |
| SC-4 | Brand → Customers tab renders 4th tab on every brand detail screen; lists all distinct buyers; sticky "Blast these N customers" CTA navigates to composer with audience pre-filled |
| SC-5 | Event → Buyers tab renders new sub-route on every event detail screen; lists distinct buyers; sticky CTA navigates to composer with audience pre-filled |
| SC-6 | Composer renders 4 numbered steps; ChannelTabs shows Email enabled + SMS/RCS greyed; live preview pane updates as subject/body change |
| SC-7 | Insert event card token (`{{event:id}}`) embeds an event card module in the email body; live preview renders the card |
| SC-8 | Saving draft writes `marketing_campaigns` row with `status='draft'`; reopening from /campaigns?status=drafts restores all composer state |
| SC-9 | Scheduling a campaign writes `status='scheduled'` + `scheduled_for`; campaign appears in /campaigns?status=scheduled |
| SC-10 | pg_cron triggers `marketing-send` every minute; campaign with scheduled_for in past flips to `status='sending'` then `status='sent'` |
| SC-11 | While `MARKETING_SEND_LIVE_ENABLED=false`: `marketing_messages` rows write with `status='preview_skipped'`; no Resend call fires; campaign report shows preview state honestly |
| SC-12 | While `MARKETING_SEND_LIVE_ENABLED=true`: Resend call fires; provider message ID written; campaign report fills in opens/clicks via Resend webhook |
| SC-13 | Unsubscribe link in email footer routes to /unsubscribe/{token}; writes `marketing_unsubscribes` with `scope='brand'`; offers global escalation; subsequent campaigns suppress this contact |
| SC-14 | Click-tracking redirect at /m/{tracking_id} writes `marketing_clicks.clicked_at`, increments `marketing_messages.click_count`, appends UTM params, 302-redirects |
| SC-15 | Campaign report renders revenue hero, funnel row, click destination chart, conversions sparkline, top-buyers list; numbers reconcile with raw `marketing_messages` + `orders` |
| SC-16 | Templates screen renders 5 Mingla starter-pack seeds + user-created list; "Use this template" populates composer |
| SC-17 | All channel-extensibility invariants (I-PROPOSED-BP..BK) hold; strict-grep gate passes 100% |
| SC-18 | tsc clean, jest green, Deno green, strict-grep green |
| SC-19 | iOS Simulator + Android Emulator parity verified by tester (per `feedback_tester_canonical_and_platform_parity.md`); web preview-mode renders for `mingla-business/app/web` if expo-web is enabled |
| SC-20 | Mingla design tokens used throughout; no oklch/lab colors; all keyboard rules followed; all sub-sheets inside parent sheets; all interactive elements ≥44pt + accessibilityLabel |

---

## 11. Test Matrix

| ID | What | Where | Pass criteria |
|---|---|---|---|
| T-01 | Audience query: brand-rollup | jest service test | Returns expected buyer count for seeded fixture |
| T-02 | Audience query: event-scoped | jest service test | Returns expected buyer count for seeded fixture |
| T-03 | Audience filter: marketing-consenting only | jest service test | Filters out unconsented buyers correctly |
| T-04 | Unsubscribe suppression in audience | jest service test | Excludes unsubscribed contacts |
| T-05 | Composer draft auto-save debounce | jest hook test | Writes draft 800ms after last keystroke; not before |
| T-06 | Composer pre-fill via query param | jest route test | `audience=brand:abc` resolves to that audience; renders correctly |
| T-07 | Composer review modal blocks Schedule until all required fields present | jest component test | Disabled when subject/body/audience/time missing |
| T-08 | Channel-extensibility: unknown `kind` in `channel_payload` throws | Deno edge test | Dispatcher rejects unknown kinds with `unknown_channel_kind:X` |
| T-09 | Send-live gate honors `MARKETING_SEND_LIVE_ENABLED=false` | Deno edge test | No Resend call; rows marked `preview_skipped` |
| T-10 | Click tracking: redirect appends UTM and records click | Deno edge test | 302 with correct UTM params; `marketing_clicks.clicked_at` set |
| T-11 | Unsubscribe: writes brand-scoped suppression | Deno edge test | Row inserted with `scope='brand'`; subsequent send skips contact |
| T-12 | Brand Customers tab: pagination, filtering | jest component test | 25/page, filter sheet applies correctly |
| T-13 | Event Buyers tab: same row component as Customers | jest component test | Imports `BuyerRow` from shared path (I-PROPOSED-BT) |
| T-14 | Composer event-card insertion produces correct token | jest component test | `{{event:abc}}` token rendered in body; preview shows event card |
| T-15 | Migration apply probes (idempotency) | Deno migration test | Re-running migration is a no-op; probes still pass |
| T-16 | RLS: non-brand-member cannot SELECT marketing_campaigns | Supabase MCP probe | RLS denies |
| T-17 | RLS: brand_member can SELECT but not INSERT marketing_campaigns for the brand | Supabase MCP probe | Read OK, write denied |
| T-18 | RLS: event_manager can INSERT marketing_campaigns | Supabase MCP probe | Both read and write succeed |
| T-19 | iOS simulator: composer keyboard does not block subject TextInput | Tester live | Subject input remains visible above keyboard |
| T-20 | Android emulator: AudiencePickerSheet renders inside parent Sheet | Tester live | Sub-sheet visible, not occluded |
| T-21 | Web (mingla-business/app web): composer preview pane renders side-by-side | Tester live | Two-column layout on viewport ≥768px |

---

## 12. Hard Guards (Implementor MUST NOT)

- ❌ Implement SMS or RCS sending (Phases B/C — out of scope)
- ❌ Implement consent enforcement at checkout (Phase 0 — separate ORCH)
- ❌ Implement AppsFlyer (Phase F — M3)
- ❌ Wire `MARKETING_SEND_LIVE_ENABLED=true` by default (must default `false` until ORCH-0777 closes)
- ❌ Add brand-followers audience type (Phase D)
- ❌ Send any real email to any real address during development (Resend sandbox only; production secrets gate live)
- ❌ Skip channel-extensibility invariants I-PROPOSED-BP..BK
- ❌ Use SECURITY DEFINER helpers for SELECT (per `feedback_rls_returning_owner_gap.md`)
- ❌ Use Zustand persist for server records (per I-PROPOSED-J)
- ❌ Use `.neq()` on nullable columns (per memory `feedback_supabase_neq_null.md`)
- ❌ Use oklch/lab/lch/color-mix colors (per `feedback_rn_color_formats.md`)
- ❌ Render sub-sheets as Fragment siblings (per `feedback_rn_sub_sheet_must_render_inside_parent.md`)
- ❌ Bare `crypto.randomUUID()` — use `mingla-business/src/utils/randomId.ts` (per DEC-148)
- ❌ Call SECURITY DEFINER RPCs with `serviceClient()` when RPC reads `auth.uid()` — use `userClient(req)` (per DEC-148)
- ❌ Modify the Email `channel_payload.kind='email'` shape — additive-only (I-PROPOSED-BQ)
- ❌ Touch ORCH-0817 (RCS) or ORCH-0816 (ads research) work in this PR

---

## 13. CI / Strict-Grep Gates

New strict-grep gate `orch-0815-marketing-hub-phase-a.mjs` registered in
`.github/workflows/strict-grep-mingla-business.yml` per the registry pattern
(one script + one job, no parallel workflow file).

Required checks:
1. `marketing_audiences.query_definition` schema has discriminated `kind` field (TS type + Zod schema)
2. `marketing_campaigns.channel_payload` schema has discriminated `kind` field
3. `marketing-send/index.ts` dispatcher has `switch (kind)` with `default: throw`
4. `ChannelTabs.tsx` renders all three tabs (literal grep for `email`, `sms`, `rcs` in same file)
5. `BuyerRow.tsx` is single source — imported by both Customers and Buyers screens
6. Composer pre-fill route handler parses `audience={kind}:{id}` shape
7. No literal `crypto.randomUUID()` anywhere in new files (Hermes-safe rule)
8. No `oklch` / `oklab` / `lab(` / `lch(` / `color-mix` strings in new files
9. No bare `serviceClient()` call in any RPC-calling edge function that reads `auth.uid()`
10. Migration file has `DO $$` apply-time probes for all 6 tables
11. `MARKETING_SEND_LIVE_ENABLED` env-flag read present in `marketing-send/index.ts`
12. Negative-control proof: implementor demonstrates each gate fires on at least 3 different intentional regressions during local development

---

## 14. Failure Modes & Mitigation

| Failure | Mitigation |
|---|---|
| ORCH-0777 not closed; audiences empty | UI ships, audiences show "No buyers yet"; `Send` gate stays off; mock data available in dev mode for organiser preview |
| Resend domain not verified | `marketing-send` returns `provider_not_configured`; campaign marked `failed` with clear reason; operator alerted in admin |
| Recipient unsubscribed mid-send | `marketing-send` re-checks suppression list immediately before each Resend call; race-window <50ms; acceptable per CAN-SPAM 10-day cure window |
| Brand deletes event while campaign scheduled to its buyers | Audience resolution returns 0 contacts; campaign sends to 0 recipients; report shows "Audience changed since scheduling" |
| Campaign scheduled in past (clock drift) | pg_cron picks up; sends immediately; report shows actual send time |
| Resend webhook drops (open/click events lost) | Inferred from `marketing_clicks` rows; opens may under-report but conversions remain accurate |
| Cron miss (Supabase pg_cron outage) | Scheduled campaigns delay until cron resumes; admin dashboard surfaces "N campaigns past due" alert |
| User opens composer from event-context, then changes brand context mid-composer | Composer rejects audience-brand mismatch with "Audience belongs to different brand — start new campaign?" |

---

## 15. Open Questions for Operator (non-blocking)

These should be answered before implementor PR but do not block SPEC approval:

1. **Bottom-nav icon for Marketing tab.** Default proposal: `megaphone`. Alternatives: `mail`, `send`, `bullhorn`. Operator pick?
2. **Marketing tab default sub-surface.** Default: Overview. Alternative: Campaigns history (closer to action).
3. **Resend domain for sender.** Mingla owns sender (`{brand-handle}@mg.usemingla.com`?) or brand verifies their own? Phase A recommendation: Mingla-owned with "via Mingla" labelling (mirrors existing ticket emails).
4. **Mingla starter-pack template count and exact copy.** Default 5 templates listed in §5.9. Operator may want to revise copy, add/remove templates.
5. **Recipient timezone strategy for Phase A.** Single absolute time only? Or "best send hour" rule (10am–2pm window)?
6. **Pagination size for buyer rows.** Default 25/page. Tradeoff: 50 = fewer load-more taps; 25 = faster initial render.
7. **Customer masked-contact format.** `ale**@gmail.com` (default) or full email? Privacy vs operator utility.

---

## 16. Implementor Deliverables

The implementor PR closing this SPEC must include:

1. New migration `supabase/migrations/[timestamp]_orch_0815_marketing_hub_phase_a.sql` with 6 tables + indexes + RLS + apply-time probes + starter-pack seed
2. Three new edge functions: `marketing-send/`, `marketing-track-click/`, `marketing-unsubscribe/`
3. One pg_cron job inserting `marketing-send` every 1 minute (or pg_net + pg_cron pattern per ORCH-0788 precedent if vault secrets needed)
4. ~30 new `mingla-business/src/components/marketing/*.tsx` files (see §8.1)
5. ~10 new `mingla-business/src/hooks/marketing/*.ts` files (see §8.2)
6. ~5 new `mingla-business/src/services/marketing/*.ts` files (see §8.3)
7. ~10 new route files under `mingla-business/app/(tabs)/marketing/` and brand/event sub-routes
8. Updated `mingla-business/app/(tabs)/_layout.tsx` TABS array (4 tabs)
9. New strict-grep gate `.github/scripts/strict-grep/orch-0815-marketing-hub-phase-a.mjs`
10. New workflow job in `.github/workflows/strict-grep-mingla-business.yml`
11. New jest suite covering hooks + services (T-01..T-07, T-12..T-14)
12. New Deno suite covering edge functions (T-08..T-11, T-15)
13. Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0815_MARKETING_HUB_PHASE_A.md`
14. Negative-control evidence for all 12 strict-grep checks (each fires on at least one intentional regression)
15. tsc clean + jest green + Deno green + strict-grep green

**Before implementor dispatch:** mingla-designer skill MUST run a design pass
producing pixel-accurate component specs matching Mingla aesthetics. Output:
`Mingla_Artifacts/design/DESIGN_ORCH-0815_MARKETING_HUB_PHASE_A.md` (or
similar). Per memory `feedback_implementor_uses_ui_ux_pro_max.md`. Mingla-designer
preferred over ui-ux-pro-max because Mingla-bespoke.

---

## 17. Cross-References

- Strategy: `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` (§3.1–3.8 in scope; §3.9 Customers tab requirement)
- Epic: `Mingla_Artifacts/github/epics/cycle-b5.md` Phase A row
- Decision: `Mingla_Artifacts/DECISION_LOG.md` DEC-149 (dual-surface placement)
- Infrastructure gap: `Mingla_Artifacts/MARKETING_HUB_INFRASTRUCTURE_GAP_ANALYSIS.md`
- Sibling ORCHs: ORCH-0816 (ads research), ORCH-0817 (RCS strategy)
- Live-broadcast dependency: ORCH-0777 (production ticket checkout)
- Bottom-nav anticipation comment: `mingla-business/app/(tabs)/_layout.tsx:6-7`
- Mingla-bespoke design rules referenced: `feedback_keyboard_never_blocks_input.md`, `feedback_rn_sub_sheet_must_render_inside_parent.md`, `feedback_rn_color_formats.md`, `feedback_toast_needs_absolute_wrap.md`, `feedback_back_listener_disarm_pattern.md`, `feedback_rls_returning_owner_gap.md`, `feedback_zustand_persist_no_server_snapshots.md`, `feedback_implementor_uses_ui_ux_pro_max.md`

---

## 18. Working Tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Per DEC-135 / I-PROPOSED-AC override 2026-05-11, all work runs in the shared `Seth` working tree (no per-ORCH worktrees).
