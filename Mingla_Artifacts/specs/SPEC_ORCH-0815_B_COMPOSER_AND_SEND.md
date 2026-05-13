# SPEC — ORCH-0815-B Marketing Hub Composer + Email Send Pipeline

**ORCH:** ORCH-0815-B (sub-step of ORCH-0815; Phase A foundation shipped + closed on commit `b8d8b6f7`)
**Cycle:** B5 Phase A — completes the "compose + send" loop on top of the buyer-audience foundation
**Type:** missing-feature (UI + edge functions + pg_cron + Resend integration)
**Severity:** S2 — not launch-blocking; first product-grade revenue-generating organiser tool
**Date:** 2026-05-12
**Owner:** Seth Ogieva
**Author:** Claude `mingla-forensics` (SPEC mode)
**Mode:** SPEC (no code; contract for implementor)
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0815-B_SPEC_DISPATCH.md`

---

## 1. Plain-English Summary

Phase A built the foundation: 6 marketing tables, brand-rollup + per-event buyer
audiences, Marketing tab + sub-nav shell, Brand Blasts + Event Blasts surfaces
with sticky "Send Blast (N)" CTAs that currently fire a placeholder toast.

Phase B completes the loop: a single-page composer where brand operators write
the subject + body of an email, embed event cards, schedule a send time, see a
live preview, and tap Send. A `marketing-send` Resend-backed edge function
triggered by pg_cron picks up scheduled campaigns, resolves the audience,
filters unsubscribes, renders the email through the Mingla brand shell, sends
via Resend, writes per-recipient delivery + click tracking, and serves a one-
click unsubscribe redirect. The `MARKETING_SEND_LIVE_ENABLED` env-flag stays
OFF until ORCH-0777 (production checkout) closes — when off, the pipeline runs
end-to-end but never calls Resend, so the entire flow is buildable + testable
on the existing buyer dataset without sending real email.

When this ships, the placeholder toast on Brand Blasts + Event Blasts CTAs
becomes a real `router.push("/marketing/campaigns/compose?audience=...")` and
the Marketing Hub becomes a complete email-channel product.

---

## 2. Scope (In / Out)

### In scope (Phase B)

**UI (mingla-business):**
- Composer route at `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
- `AudiencePickerSheet` sub-sheet (lists system-generated audiences)
- `ChannelTabs` component (Email enabled, SMS + RCS visible-but-disabled per I-PROPOSED-BS)
- `EmailPreviewPane` component (mobile sub-sheet / tablet+web side pane)
- `EventCardInserter` sub-sheet (picks event, inserts `{{event:[id]}}` token)
- Composer state machine (INIT → editing → previewing → review → sending → sent_confirmation, with error transitions)
- Draft auto-save (800ms debounce) writing `marketing_campaigns.status='draft'`
- Composer dirty-state back-block (`feedback_back_listener_disarm_pattern.md`)
- Marketing → Campaigns history screen (`(tabs)/marketing/campaigns/index.tsx`) — replaces the placeholder
- Pre-fill from query param `audience={kind}:{id}` (I-PROPOSED-BU)
- BlastCustomersCta `onPress` rewire: replace the current "Composer ships next" toast with `router.push("/marketing/campaigns/compose?audience=...")` in both routes (`brand/[id]/blasts.tsx` + `event/[id]/blasts/index.tsx`)

**Edge functions (3 new):**
- `supabase/functions/marketing-send/index.ts` — cron-triggered campaign dispatcher
- `supabase/functions/marketing-track-click/index.ts` — public click-tracking redirect
- `supabase/functions/marketing-unsubscribe/index.ts` — public signed-token unsubscribe

**Database / cron:**
- New migration adding pg_cron + pg_net job invoking `marketing-send` every 1 minute (verbatim mirror of `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql`)
- No new tables, no new columns, no new RLS — Phase A schema is sufficient

**Resend integration:**
- HTML rendering via existing `_shared/email/` brand shell (shipped in ORCH-0785)
- Variable substitution: `{first_name}`, `{event_name}`, `{event_date}`, `{brand_name}`, `{event_url}`, plus `{{event:[id]}}` event-card module
- Per-link tracking ID generation in `marketing-send` (Deno `crypto.randomUUID()`)
- Unsubscribe footer auto-appended with signed token

**CI:**
- New strict-grep gate `orch-0815-b-composer-and-send.mjs` covering channel-extensibility invariants, env-flag presence, no-bare-crypto, no-oklch, no-SD-helper-in-RPC, etc.

**Jest + Deno tests:**
- Composer state machine + draft auto-save + pre-fill (jest)
- Audience picker rendering + selection (jest)
- ChannelTabs renders all 3 tabs with SMS/RCS disabled (jest)
- `marketing-send` dispatcher routing + env-flag gate + Resend call + status transitions (Deno)
- Click tracking redirect + UTM append + 302 (Deno)
- Unsubscribe token decode + scope='brand' insert (Deno)

### Out of scope (deferred to later phases)

| Deferred to | Item |
|---|---|
| **ORCH-0815-C** (analytics + templates polish) | Marketing → Overview revenue hero + funnel tiles + recent campaigns list (replaces placeholder) |
| **ORCH-0815-C** | Marketing → Audiences list screen (real audience cards instead of placeholder) |
| **ORCH-0815-C** | Marketing → Templates list screen (browse 5 starter-pack templates + user templates, "Use this template" CTA) |
| **ORCH-0815-C** | Campaign report screen (`/marketing/campaigns/[id].tsx`) — per-campaign revenue + funnel + sparkline + top buyers |
| Cycle B5 Phase B | SMS channel (Twilio 10DLC) |
| Cycle B5 Phase C | RCS channel (Twilio RBM, see `MINGLA_RCS_CONCIERGE_STRATEGY.md`) |
| Cycle B5 Phase 0 | Consent enforcement at checkout (`marketing_consent` schema + checkout flow updates) |
| Cycle B5 Phase D | Brand followers audience kind |
| Cycle B5 Phase F (M3) | AppsFlyer cross-platform attribution |
| Cycle B5 Phase F | Mingla-managed ads (Track 2) |
| Cycle B6 | Mingla Brain agent layer |
| Phase A+ | Per-recipient timezone-aware "smart-send" scheduling |
| Phase A+ | A/B testing of subject lines |
| Phase A+ | Marketing → Settings sub-surface (sender domain, suppression list management UI) |
| Phase A+ | Multi-language email templates |

### Live-broadcast gate

`MARKETING_SEND_LIVE_ENABLED` env-flag defaults `false`. When false,
`marketing-send` writes `marketing_messages` rows with
`status='preview_skipped'` and does NOT call Resend. Operator flips the flag
to `true` AFTER ORCH-0777 (production ticket checkout) closes — the buyer
audiences will then contain real `orders` rows worth blasting.

Implementor MUST ship with the flag default OFF. The implementor PR does NOT
include any code path that defaults the flag ON.

---

## 3. User Flows

### 3.1 Doorway A — Marketing tab → Campaigns → New campaign

```
Marketing tab → Campaigns sub-route
  ↓ tap "+ New campaign" FAB
/marketing/campaigns/compose (no audience pre-fill)
  ↓ user picks audience from AudiencePickerSheet (Step 1)
  ↓ user types subject + body, inserts event card (Step 2)
  ↓ user picks "Send now" or "Schedule {date}" (Step 3)
  ↓ Compliance footer is read-only (Step 4)
  ↓ tap "Review & schedule →"
review modal: audience summary + preview thumbnail + schedule time
  ↓ tap "Schedule" / "Send now"
sent_confirmation overlay
  ↓ "View in campaigns" CTA
/marketing/campaigns?status=scheduled OR ?status=sent
```

### 3.2 Doorway B — Event-context entry (existing, rewires Phase B)

```
event/[id] detail → tap Blasts ActionTile
event/[id]/blasts → tap "Send Blast (231) →" CTA
  → Phase A: showed "Composer ships next" toast
  → Phase B: router.push("/marketing/campaigns/compose?audience=event:[id]")
composer opens with Step 1 audience pre-filled to that event's buyers
  ↓ (same flow as Doorway A from Step 2 onward)
```

### 3.3 Doorway C — Brand-context entry (existing, rewires Phase B)

```
brand/[id] → Operations menu → Blasts row
brand/[id]/blasts → tap "Send Blast (387) →" CTA
  → Phase A: "Composer ships next" toast
  → Phase B: router.push("/marketing/campaigns/compose?audience=brand:[id]")
composer opens with Step 1 audience pre-filled to brand-rollup buyers
  ↓ (same flow as Doorway A from Step 2 onward)
```

### 3.4 Send pipeline (background)

```
pg_cron tick (every 1 min)
  ↓ pg_net.http_post → marketing-send edge function
marketing-send (Deno):
  ↓ SELECT campaigns WHERE status='scheduled' AND scheduled_for <= now() LIMIT 10
  ↓ UPDATE each → status='sending' (atomic)
  ↓ for each campaign:
    ↓ resolve audience via query_definition (call audience service via SQL)
    ↓ filter contacts against marketing_unsubscribes (brand + global)
    ↓ for each contact:
      ↓ INSERT marketing_messages (status='queued')
      ↓ generate per-link tracking IDs, INSERT marketing_clicks
      ↓ render Mingla brand-shell email with body + variables + event cards
      ↓ if MARKETING_SEND_LIVE_ENABLED:
        ↓ POST to Resend API
        ↓ on success: UPDATE marketing_messages → status='sent' + provider_message_id
        ↓ on failure: UPDATE marketing_messages → status='failed' + failure_reason
      ↓ else:
        ↓ UPDATE marketing_messages → status='preview_skipped' (no Resend call)
  ↓ UPDATE campaign → status='sent' + sent_at + recipient_count
```

### 3.5 Buyer unsubscribe flow

```
Buyer opens email → taps "Unsubscribe" footer link
  ↓ GET https://mingla.app/unsubscribe/{signed_token}
marketing-unsubscribe edge function:
  ↓ verify token signature (HS256 with shared secret)
  ↓ decode to { campaign_id, recipient_email, brand_id, expires_at }
  ↓ INSERT marketing_unsubscribes (scope='brand', channel='email', brand_id, contact_email)
  ↓ UPDATE marketing_messages → status='unsubscribed'
  ↓ render confirmation HTML: "You won't receive marketing emails from {brand} anymore."
  ↓ offer secondary link: "Unsubscribe from all Mingla brands" → re-POSTs with scope='global'
```

### 3.6 Buyer click flow

```
Buyer opens email → taps any link
  ↓ GET https://mingla.app/m/{trackingId}
marketing-track-click edge function:
  ↓ SELECT marketing_clicks WHERE tracking_id = {trackingId}
  ↓ UPDATE marketing_clicks → clicked_at = now() (first-click only)
  ↓ UPDATE marketing_messages → click_count++ + last_clicked_at
  ↓ append UTM params to destination_url
  ↓ 302 redirect to destination_url
```

---

## 4. Information Architecture

### 4.1 New routes

```
mingla-business/app/(tabs)/marketing/campaigns/
  compose.tsx                  → NEW Composer route
  index.tsx                    → REPLACES placeholder with real campaign list
```

### 4.2 No bottom-nav changes

`MarketingSubNav` already exists from Phase A — Campaigns pill already routes
to `(tabs)/marketing/campaigns`. Composer route is a child of Campaigns,
NOT a sub-nav tab — the composer hides the sub-nav (per Phase A SPEC §4.3).

### 4.3 Sub-sheet rendering

All sub-sheets (AudiencePickerSheet, EventCardInserter, EmailPreviewPane on
mobile) MUST render inside the composer's parent Sheet per
`feedback_rn_sub_sheet_must_render_inside_parent.md`. Verified pattern:
the Cycle 12 `CreatorStep5Tickets.tsx:1368-1386` precedent.

---

## 5. Screen Contracts

### 5.1 Composer — `(tabs)/marketing/campaigns/compose.tsx`

**Data dependencies:**
- Query params: optional `audience=brand:[id]` or `audience=event:[id]` for pre-fill
- Existing draft if `?draft=[id]`
- Brand profile (current brand from `useCurrentBrand`) for compliance auto-fill
- Audience service `resolveBrandBuyers` / `resolveEventBuyers` for reach counts (already shipped)

**State machine** (per Phase A SPEC §5.5):

```
INIT
  ↓ resolve pre-fill (if query param)
ready
  ↓ user types in any field
editing (debounced 800ms → save_draft → ready_with_draft)
editing
  ↓ tap "Preview email" → previewing
previewing
  ↓ dismiss → editing
editing
  ↓ tap "Review & schedule →" (gated on all required fields present)
review (modal)
  ↓ tap "Back to edit" → editing
review
  ↓ tap "Schedule" / "Send now" → sending
sending
  ↓ success → sent_confirmation
  ↓ error → editing (with error banner)
sent_confirmation
  ↓ auto-dismiss 3s OR tap CTA → navigate to /campaigns
```

**Layout** (per design §5.5, single-page vertical):

1. Page header — back chevron + "New campaign" + "Save draft" right action
2. Step 1 (Who): audience picker Pressable → opens AudiencePickerSheet; below shows "N people · M with marketing consent"
3. Step 2 (What):
   - ChannelTabs row (Email tab active, SMS/RCS visible disabled)
   - Subject TextInput (48pt, single-line, placeholder "What's this campaign about?")
   - Body multiline TextInput (120pt min, grows to 320pt max, placeholder "Hi {first_name}, ...")
   - "[+ Insert event card]" inline ghost button → opens EventCardInserter
   - "[Preview email →]" link → opens preview sheet on mobile (already-visible side pane on tablet+web)
4. Step 3 (When):
   - Radio: ○ Send now / ● Schedule
   - DateTimePicker visible when Schedule selected
   - Helper text "Brand's local time · best between 10am–2pm"
5. Step 4 (Compliance) — read-only locked card:
   - "From: {Brand} via Mingla"
   - "Reply-to: {brand.contact_email}"
   - "Unsubscribe: link added automatically"
   - "Brand address: {brand.address}"
   - Info note (semantic.infoTint background): "Your buyers can opt out anytime — Mingla honors this across all your brands."
6. Sticky footer — "[Save draft]" ghost + "[Review & schedule →]" primary (disabled until all required fields)

**Hard requirements:**
- TextInputs MUST follow `feedback_keyboard_never_blocks_input.md`
- Save-draft writes every 800ms debounce after first dirty field
- Draft restore: opening with `?draft=[id]` SELECTs the row and restores every field
- Cancel from review returns to editing with state intact
- Dirty-state back-block: leaving composer with unsaved edits prompts "Save draft? · Discard · Cancel" per `feedback_back_listener_disarm_pattern.md`

**All states designed:**
- Loading (pre-fill resolution): skeleton hero card
- Error (audience pre-fill fails): banner above Step 1 "Couldn't load audience — pick one below"
- Empty (no audiences exist for this brand): Step 1 picker disabled with caption "No audiences yet — your buyers fill in as people purchase tickets"
- Populated: per design §5.5
- Submitting: footer button → spinner + "Scheduling…"
- Sent confirmation: full-screen overlay (per design §5.5)

**Accessibility:**
- Every Pressable has `accessibilityLabel`
- All inputs have `accessibilityLabel` describing purpose
- Step headers have `accessibilityRole="header"`
- Compliance card has `accessibilityRole="none"` + label describing the locked nature

### 5.2 Campaigns history — `(tabs)/marketing/campaigns/index.tsx`

**Replaces the Phase B-foundation placeholder.**

**Data:** all campaigns the account has authored, descending by `created_at`, with optional `?status=` filter.

**Layout** (per design §5.4):
1. MarketingSubNav (sticky)
2. Filter pills row: All · Scheduled · Sent · Drafts · Failed
3. Card list per campaign:
   - Status icon (⏰ scheduled / ✉ sent / 📝 draft / ⚠ failed) + name + meta
   - For scheduled: "Scheduled for {date} · N recipients" + [Edit] [Cancel] buttons
   - For sent: "Sent {date} · N recipients · X% opened · Y% clicked" + [View report (deferred to C)]
   - For draft: "Saved {time} ago" + [Resume]
   - For failed: "Failed {date} · {reason}" + [Retry] [Delete]
4. FAB "[+ New campaign]" bottom-right

**Loading/error/empty:**
- Loading: 4 skeleton campaign cards
- Error: toast banner + cached campaigns (or empty state)
- Empty: per design §7.4 empty state with rocket icon + "Your first campaign starts here"

### 5.3 BlastCustomersCta — Phase A rewire (no shape change)

The component's `onPress` callsites in `brand/[id]/blasts.tsx` and
`event/[id]/blasts/index.tsx` change from the placeholder toast handler to:

```typescript
const handleBlast = useCallback(
  (kind: BlastAudienceKind, targetId: string): void => {
    router.push(
      `/marketing/campaigns/compose?audience=${kind}:${targetId}` as never,
    );
  },
  [router],
);
```

**No changes to BlastCustomersCta.tsx itself** — only its consumers' onPress
handlers. The "Composer ships next" toast state + setTimeout in each route
can be removed (along with the `composerToast` useState + the toast view).

---

## 6. Schema Deltas

**None.** Phase A schema is sufficient. Phase B reads/writes existing tables.

The only DB-layer change is one new migration for the pg_cron job (§8 below).

### 6.1 Constraints verified against current schema

- `marketing_campaigns.status` allows: `draft | scheduled | sending | sent | failed | cancelled` ✓
- `marketing_messages.status` allows: `queued | sent | delivered | opened | clicked | bounced | failed | unsubscribed | preview_skipped` ✓ (preview_skipped already added in A1)
- `marketing_clicks.tracking_id` is UNIQUE ✓
- `marketing_unsubscribes` `(contact_email, channel, scope, brand_id, account_id)` unique-on-non-null ✓
- `mkt_brand_min_rank(uuid, text)` non-SD helper available for any RLS-aware SQL ✓

### 6.2 No schema deltas needed because

- Campaign drafts use `marketing_campaigns.status='draft'` — no new state
- Sent / opened / clicked / bounced tracking uses existing `marketing_messages` columns
- Click tracking uses existing `marketing_clicks` table
- Unsubscribes use existing `marketing_unsubscribes` table

---

## 7. Edge Functions

### 7.1 `supabase/functions/marketing-send/index.ts`

**Trigger:** pg_cron job every 1 min OR direct HTTP POST for "send now" path
(the composer's "Send now" flow calls this directly via `userClient(req)`).

**verify_jwt:** `false` (cron-triggered + direct service-role only)

**Request schema** (when called by cron or directly):
```typescript
// pg_cron path: no body — function self-discovers scheduled campaigns
// "Send now" direct path:
{
  campaign_id: string; // UUID — flips status='scheduled'→'sending' immediately
}
```

**Response schema:**
```typescript
{
  processed: number;      // count of campaigns processed
  succeeded: number;
  failed: number;
  preview_skipped: number; // counted when MARKETING_SEND_LIVE_ENABLED=false
  errors: Array<{ campaign_id: string; reason: string }>;
}
```

**Logic** (verbatim — implementor follows this exactly):

```
1. Parse env: const LIVE = Deno.env.get('MARKETING_SEND_LIVE_ENABLED') === 'true';
2. Parse env: const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
   const RESEND_FROM = Deno.env.get('RESEND_MARKETING_FROM') ?? 'tickets@usemingla.com';
3. If LIVE && !RESEND_API_KEY → return 503 { error: 'resend_not_configured' }
4. Build service-role Supabase client.
5. Atomically lock + fetch up to 10 campaigns:
   UPDATE marketing_campaigns
   SET status='sending', updated_at=now()
   WHERE id IN (
     SELECT id FROM marketing_campaigns
     WHERE status='scheduled' AND scheduled_for <= now()
     ORDER BY scheduled_for ASC
     LIMIT 10
     FOR UPDATE SKIP LOCKED
   )
   RETURNING id, account_id, brand_id, audience_id, channel, channel_payload, name;
6. For each campaign:
   a. Channel dispatch — switch (channel_payload.kind):
      case 'email': await sendEmail(campaign);
      case 'sms':   throw new Error('sms_not_yet_enabled'); // Phase B
      case 'rcs':   throw new Error('rcs_not_yet_enabled'); // Phase C
      default:      throw new Error(`unknown_channel_kind:${kind}`);
   b. On thrown error → UPDATE marketing_campaigns SET status='failed', updated_at=now() WHERE id=campaign.id; INCREMENT failed counter.
   c. On sendEmail success → continue to step 7.
7. sendEmail(campaign):
   a. Resolve audience: SELECT marketing_audiences WHERE id=campaign.audience_id.
      Based on query_definition.kind:
        - 'brand_buyers': call resolveBrandBuyersSql(brand_id) — see §7.1.a below
        - 'event_buyers': call resolveEventBuyersSql(event_id)
   b. For each resolved contact (BuyerRowData shape):
        - Compute message_id = crypto.randomUUID()
        - INSERT marketing_messages (id=message_id, campaign_id, recipient_email, channel='email', status='queued')
        - Per-link tracking: scan body_html for href="..." links, replace each with
          https://mingla.app/m/{tracking_id} where tracking_id = crypto.randomUUID()
          and INSERT marketing_clicks (campaign_id, message_id, destination_url=original, tracking_id).
        - Compute unsubscribe_token = sign({ campaign_id, recipient_email, brand_id, exp: now()+90d })
          using HS256 with Deno.env.get('UNSUBSCRIBE_TOKEN_SECRET').
        - Render email HTML via _shared/email/ brand shell:
            wrap(campaign.channel_payload.body_html, {
              brand: campaign.brand_id,
              variables: { first_name: contact.display_name.split(' ')[0], ... },
              embedded_events: campaign.channel_payload.embedded_events,
              unsubscribe_url: `https://mingla.app/unsubscribe/${unsubscribe_token}`,
            });
        - If !LIVE:
            UPDATE marketing_messages SET status='preview_skipped' WHERE id=message_id;
            increment preview_skipped counter.
          Else:
            POST https://api.resend.com/emails with Authorization: Bearer RESEND_API_KEY
              { from: RESEND_FROM, to: [contact.raw_email], subject, html, text }
            On 2xx → UPDATE marketing_messages SET status='sent', sent_at=now(), provider_message_id=response.id.
            On non-2xx → UPDATE marketing_messages SET status='failed', failure_reason=responseBody.
   c. UPDATE marketing_campaigns SET status='sent', sent_at=now(), recipient_count=contacts.length, updated_at=now() WHERE id=campaign.id.
8. Return aggregated result.
```

**§7.1.a — audience resolution from inside the edge function:**

Mirror the client-side `resolveBrandBuyers` / `resolveEventBuyers` logic in
Deno using direct Supabase JS calls. The functions live in `_shared/marketingAudience.ts`
(new file) with identical aggregation logic to the client. **DRY note:** TS shared
code between RN client + Deno edge does NOT work directly (RN can't import Deno-
specific paths). Acceptable to duplicate the aggregation function ONCE in
`_shared/marketingAudience.ts` and reference Phase A's
`mingla-business/src/services/marketing/marketingAudienceService.ts` in a code
comment as the parallel source-of-truth.

**Channel routing invariant (I-PROPOSED-BR):**

```typescript
function dispatchByKind(kind: ChannelPayloadKind, campaign: Campaign): Promise<void> {
  switch (kind) {
    case 'email':
      return sendEmail(campaign);
    case 'sms':
      throw new Error('sms_not_yet_enabled');
    case 'rcs':
      throw new Error('rcs_not_yet_enabled');
    default:
      // Exhaustiveness check — TS errors at compile time if a new kind is added
      // without a case branch. Runtime throw for defense.
      throw new Error(`unknown_channel_kind:${(kind as { kind?: string })?.kind ?? String(kind)}`);
  }
}
```

**Error handling:**
- Resend 4xx (bad request, invalid email): mark message `status='failed'`, continue to next contact.
- Resend 5xx (Resend outage): mark message `status='failed'`, continue. pg_cron will not retry this campaign because status is now 'sending'/'sent'. Failed messages can be retried by a future ORCH (out of scope).
- Resend rate limit (429): exponential backoff inside the function (max 3 retries with 1s/3s/9s sleep), then mark `status='failed'`.
- Database error mid-campaign: try/catch the whole campaign loop, on failure UPDATE marketing_campaigns SET status='failed' to avoid stuck `status='sending'` rows.

### 7.2 `supabase/functions/marketing-track-click/index.ts`

**Trigger:** Public HTTP GET endpoint mounted at `/m/{tracking_id}` (caller is the buyer's email client opening a link).

**verify_jwt:** `false` (public, anonymous, signed-token semantically is just an opaque UUID lookup).

**Request schema:** path param only — `tracking_id` is the UUID stored in `marketing_clicks.tracking_id`.

**Logic:**

```
1. const trackingId = url.pathname.split('/').pop();
   if (!trackingId || !UUID_RE.test(trackingId)) return 400 invalid;
2. SELECT mc.id, mc.campaign_id, mc.message_id, mc.destination_url, mc.clicked_at,
          mm.click_count, mm.id as msg_id, mm.last_clicked_at
   FROM marketing_clicks mc
   LEFT JOIN marketing_messages mm ON mm.id = mc.message_id
   WHERE mc.tracking_id = trackingId;
3. If row not found → 404 (or 302 to https://mingla.app — operator decides).
4. If clicked_at IS NULL (first click): UPDATE marketing_clicks SET clicked_at=now() WHERE id=mc.id.
   Always: UPDATE marketing_messages SET click_count=click_count+1, last_clicked_at=now() WHERE id=msg_id.
5. Compute destination_url + UTM:
   const url = new URL(mc.destination_url);
   url.searchParams.set('utm_source', 'mingla');
   url.searchParams.set('utm_medium', 'email');
   url.searchParams.set('utm_campaign', mc.campaign_id);
   url.searchParams.set('utm_content', mc.id); // for fine-grained per-click attribution
6. Capture user_agent + ip_hash:
   UPDATE marketing_clicks SET user_agent=req.headers['user-agent'], ip_hash=sha256(req.headers['x-forwarded-for']);
7. 302 redirect to url.toString().
```

**Edge cases:**
- Pre-warmed link clicks (Gmail / Outlook bots): operator may want to flag these. Out of scope for Phase B — `user_agent` capture + future ORCH analyzes patterns.

### 7.3 `supabase/functions/marketing-unsubscribe/index.ts`

**Trigger:** Public HTTP GET at `/unsubscribe/{token}` from the email footer link.

**verify_jwt:** `false` (public, anonymous, signed-token authenticated).

**Token signing:** HS256 JWT-style with `Deno.env.get('UNSUBSCRIBE_TOKEN_SECRET')`.
Payload: `{ campaign_id, recipient_email, brand_id, exp }`.

**Logic:**

```
1. const token = url.pathname.split('/').pop();
   if (!token) return 400.
2. Verify signature + expiration via Deno's standard library jose / djwt.
   On invalid: 400 with HTML page "This unsubscribe link is invalid or expired."
3. Decode payload → { campaign_id, recipient_email, brand_id }.
4. Optional scope query param: ?scope=global escalates from brand-scope.
5. INSERT into marketing_unsubscribes ON CONFLICT DO NOTHING:
   - scope='brand' (default) or 'global' (if escalation)
   - channel='email'
   - contact_email=recipient_email
   - brand_id=brand_id (only when scope='brand'; NULL when 'global')
   - reason='one_click_unsubscribe_link'
6. UPDATE marketing_messages SET status='unsubscribed'
   WHERE campaign_id=campaign_id AND recipient_email=recipient_email;
7. Render confirmation HTML inline (no template engine — keep it simple):
   <html>
     <head>...</head>
     <body>
       <p>You won't receive marketing emails from {brand_name} anymore.</p>
       <a href="/unsubscribe/{token}?scope=global">
         Unsubscribe from all Mingla brands
       </a>
     </body>
   </html>
8. Return 200 with the HTML body.
```

**Brand name lookup:** SELECT brands.display_name WHERE id=brand_id. Cache for 5 min in-process.

**Token rotation:** secret rotation handled by operator at the env var level — function reads the current secret per request.

### 7.4 Live-broadcast gate (env-flag)

`MARKETING_SEND_LIVE_ENABLED` lives as a Supabase Function secret:
```bash
supabase secrets set MARKETING_SEND_LIVE_ENABLED=false --project-ref gqnoajqerqhnvulmnyvv
```

Implementor's migration / setup doc reminds operator to set the secret. Default
behavior when secret is absent: treat as `false` (fail-safe).

When flipping to `true` post-ORCH-0777:
```bash
supabase secrets set MARKETING_SEND_LIVE_ENABLED=true --project-ref gqnoajqerqhnvulmnyvv
```

---

## 8. pg_cron Migration

New migration: `supabase/migrations/[ts]_orch_0815_b_marketing_send_cron.sql`.

Mirror of `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql`
verbatim with the function URL swapped. Apply-time `DO $$` probes verify:
- pg_cron + pg_net extensions are enabled
- `vault.secrets` contains `supabase_url` + `service_role_key`
- Cron job `orch-0815-b-marketing-send` is registered with schedule `* * * * *`

Implementor copies the ORCH-0788 migration, renames identifiers, swaps the
edge function endpoint to `/functions/v1/marketing-send`, runs the same
apply-time verification probes.

---

## 9. Component Architecture

### 9.1 New components (mingla-business)

```
mingla-business/src/components/marketing/
  ChannelTabs.tsx                  — 3 tabs (Email/SMS/RCS), Email active, SMS+RCS disabled
  ComposerHeader.tsx               — back chevron + "New campaign" + Save-draft action
  ComposerStepWho.tsx              — Audience picker pressable + reach counts
  ComposerStepWhat.tsx             — Subject + body inputs + Insert event card + Preview link
  ComposerStepWhen.tsx             — Send-now/Schedule radio + DateTimePicker
  ComposerStepCompliance.tsx       — read-only compliance card with info note
  ComposerFooter.tsx               — sticky Save-draft + Review-and-schedule buttons
  ComposerReviewSheet.tsx          — modal sheet shown after "Review & schedule"
  ComposerSentConfirmation.tsx     — full-screen overlay with check + "View in campaigns"
  AudiencePickerSheet.tsx          — sub-sheet listing audiences (system-generated)
  EventCardInserter.tsx            — sub-sheet to pick event + insert {{event:id}} token
  EmailPreviewPane.tsx             — WebView-based preview render (mobile sheet / desktop pane)
  CampaignCard.tsx                 — campaigns history list row
  CampaignFilterPills.tsx          — filter row above campaign list
```

### 9.2 New hooks

```
mingla-business/src/hooks/marketing/
  useComposerDraft.ts              — debounced draft auto-save + restore
  useCampaigns.ts                  — paginated campaign list with filter
  useScheduleCampaign.ts           — mutation: write campaign + flip status
  useSendNow.ts                    — mutation: invoke marketing-send directly via userClient
  useResolveAudience.ts            — wraps useBrandCustomers / useEventBuyers for the composer
```

### 9.3 New services

```
mingla-business/src/services/marketing/
  marketingCampaignService.ts      — campaign CRUD (createDraft, scheduleSend, sendNow, cancelScheduled, deleteDraft)
  marketingTemplateService.ts      — templates list/read (write deferred to Phase C)
  marketingRenderingService.ts     — body variable substitution preview (client-side)
```

### 9.4 Shared utilities

```
supabase/functions/_shared/
  marketingAudience.ts             — server-side audience resolver mirroring marketingAudienceService.ts
  marketingTokens.ts               — sign/verify unsubscribe + tracking tokens (HS256)
  marketingEmailRender.ts          — wrap composer body in Mingla brand shell
```

### 9.5 Component rules (Mingla-bespoke)

All apply per Phase A SPEC §8.4. Notably:
- TextInputs in Composer use `feedback_keyboard_never_blocks_input.md` pattern
- AudiencePickerSheet + EventCardInserter + EmailPreviewPane (mobile) MUST render INSIDE composer's parent Sheet per `feedback_rn_sub_sheet_must_render_inside_parent.md`
- Composer dirty-state back-block per `feedback_back_listener_disarm_pattern.md`
- No oklch/lab/lch/color-mix colors
- ≥44pt touch targets with `accessibilityLabel`
- Toasts wrapped in absolute-positioned wrappers
- All `useMutation` calls have `onError` handlers (Constitution #3 — no silent failures)
- Hermes-safe `randomId` from `mingla-business/src/utils/randomId.ts` for any client-side UUID generation

---

## 10. Channel-Extensibility Invariants (carries forward from Phase A)

All Phase A invariants I-PROPOSED-BP..BU continue to apply. Phase B adds no
new invariants but the new edge function dispatcher (I-PROPOSED-BR) gets its
first real consumer. The strict-grep gate verifies:

| ID | Invariant | Phase B enforcement |
|---|---|---|
| I-PROPOSED-BP | query_definition discriminated union | unchanged from A |
| I-PROPOSED-BQ | channel_payload discriminated union | unchanged from A |
| I-PROPOSED-BR | marketing-send switch + default throw | enforced via Deno test + strict-grep check on `marketing-send/index.ts` |
| I-PROPOSED-BS | ChannelTabs renders all three | enforced via strict-grep check on `ChannelTabs.tsx` (literal `email`, `sms`, `rcs` strings present) |
| I-PROPOSED-BT | BuyerRow single shared source | unchanged from A |
| I-PROPOSED-BU | composer pre-fill query param shape `{kind}:{id}` | enforced via jest test + grep on `compose.tsx` |

---

## 11. Success Criteria

| SC | Criterion |
|---|---|
| SC-B1 | Composer route exists at `(tabs)/marketing/campaigns/compose.tsx` and renders all 4 numbered steps |
| SC-B2 | Composer pre-fills audience when query param `audience=brand:[id]` or `audience=event:[id]` present |
| SC-B3 | ChannelTabs renders Email (enabled) + SMS (disabled, label "pending") + RCS (disabled, label "pending") |
| SC-B4 | Subject + body inputs accept text; variable tokens `{first_name}` render in `accent.warm` inline |
| SC-B5 | "Insert event card" opens EventCardInserter sub-sheet (inside parent Sheet); selecting an event inserts `{{event:[id]}}` token at cursor |
| SC-B6 | Live preview renders email body with first-buyer-name substituted (mobile = sub-sheet, tablet+web = side pane) |
| SC-B7 | Schedule radio reveals DateTimePicker; valid schedule time enables Review CTA |
| SC-B8 | Compliance card is read-only, shows brand From/Reply-to/Address/Unsubscribe |
| SC-B9 | Review modal shows audience summary + preview thumbnail + schedule time |
| SC-B10 | Tap "Schedule" writes `marketing_campaigns` row with `status='scheduled'` + `scheduled_for` |
| SC-B11 | Tap "Send now" writes `status='scheduled'` with `scheduled_for=now()` AND invokes `marketing-send` directly (faster than waiting for cron) |
| SC-B12 | Draft auto-save: typing in any field triggers a `marketing_campaigns` UPDATE within 1s |
| SC-B13 | Draft restore: opening with `?draft=[id]` restores every field exactly |
| SC-B14 | Dirty back-block: attempting to leave composer with unsaved edits shows "Save draft / Discard / Cancel" prompt |
| SC-B15 | Campaigns history screen replaces placeholder; shows status-filtered list with proper icons |
| SC-B16 | BlastCustomersCta `onPress` in brand/event routes now navigates to `/marketing/campaigns/compose?audience=...` instead of showing toast |
| SC-B17 | pg_cron triggers `marketing-send` every minute (verified by `cron.job_run_details`) |
| SC-B18 | `marketing-send` atomically flips scheduled campaigns to `status='sending'` with `FOR UPDATE SKIP LOCKED` |
| SC-B19 | With `MARKETING_SEND_LIVE_ENABLED=false`: every `marketing_messages` row writes `status='preview_skipped'`; ZERO Resend API calls fire |
| SC-B20 | With `MARKETING_SEND_LIVE_ENABLED=true`: Resend POST fires with correct payload (sandbox sender during dev); `provider_message_id` written |
| SC-B21 | Per-link tracking IDs generated for every href in body_html; `marketing_clicks` rows inserted |
| SC-B22 | Email footer contains a signed unsubscribe link `https://mingla.app/unsubscribe/{token}` |
| SC-B23 | `/m/{tracking_id}` redirects 302 to destination_url with UTM params appended; updates `marketing_clicks.clicked_at` + `marketing_messages.click_count` |
| SC-B24 | `/unsubscribe/{token}` writes brand-scope suppression; renders confirmation HTML; offers global escalation link |
| SC-B25 | After unsubscribe, subsequent campaigns to same brand skip that contact |
| SC-B26 | Channel-extensibility invariants I-PROPOSED-BR/BS/BU all hold (verified via strict-grep) |
| SC-B27 | tsc clean; jest green (new + existing); Deno green for 3 new edge functions |
| SC-B28 | iOS Simulator + Android Emulator parity (composer keyboard, sub-sheets, preview pane) verified by tester |
| SC-B29 | All design tokens used; no oklch/lab; no bare `crypto.randomUUID()` in client code; sub-sheets inside parent Sheet |

---

## 12. Test Matrix

| ID | What | Where | Pass criteria |
|---|---|---|---|
| T-B01 | Composer pre-fill via query param | jest hook test | `audience=brand:abc` resolves to audience and renders Step 1 selected |
| T-B02 | Composer draft auto-save 800ms debounce | jest hook test | UPDATE fires 800ms after last keystroke; not before |
| T-B03 | Composer review CTA disabled until required fields | jest component test | Returns disabled when subject/body/audience/time missing |
| T-B04 | Composer dirty back-block | jest component test | beforeRemove listener intercepts; ConfirmDialog appears |
| T-B05 | EventCardInserter inserts token at cursor | jest component test | Body string contains `{{event:abc}}` at expected position |
| T-B06 | ChannelTabs renders 3 tabs with SMS/RCS disabled | jest component test | DOM has 3 tab elements; SMS/RCS have `accessibilityState.disabled` |
| T-B07 | `marketing-send` dispatcher switch with `default: throw` | Deno test | Calling with unknown kind throws `unknown_channel_kind:X` |
| T-B08 | `marketing-send` env-flag gate (LIVE=false) | Deno test | No Resend mock call; rows marked `preview_skipped` |
| T-B09 | `marketing-send` env-flag gate (LIVE=true) | Deno test | Resend mock called with correct payload |
| T-B10 | `marketing-send` atomic FOR UPDATE SKIP LOCKED | Deno test (with real Postgres) | Two concurrent invocations don't double-process |
| T-B11 | `marketing-send` Resend 4xx → mark failed, continue | Deno test | Status='failed' + failure_reason; next contact processed |
| T-B12 | `marketing-send` Resend 429 backoff | Deno test | 3 retries with 1s/3s/9s sleep before giving up |
| T-B13 | `marketing-track-click` 302 with UTM | Deno test | Response 302 with `utm_source=mingla&utm_medium=email&utm_campaign=...` in Location |
| T-B14 | `marketing-track-click` first-click vs subsequent | Deno test | clicked_at only set on first click; click_count increments every time |
| T-B15 | `marketing-unsubscribe` brand-scope insert | Deno test | Row in marketing_unsubscribes with scope='brand' |
| T-B16 | `marketing-unsubscribe` global escalation | Deno test | scope='global' on second visit with `?scope=global` |
| T-B17 | `marketing-unsubscribe` invalid token rejected | Deno test | Returns 400 with friendly HTML |
| T-B18 | Unsubscribed contact skipped on subsequent send | Deno test + jest service | Audience resolution filters out unsubscribed |
| T-B19 | Composer iOS Simulator | Tester live | Keyboard never blocks subject TextInput; preview sheet renders inside parent Sheet |
| T-B20 | Composer Android Emulator | Tester live | Same as T-B19 + ActionTile back-block fires correctly |
| T-B21 | Composer Web (mingla-business expo-web) | Tester live | Side-by-side preview pane at viewport ≥768pt |
| T-B22 | Pre-fill from brand Blasts CTA | Tester live | Tap "Send Blast (N)" on brand/[id]/blasts → composer opens with brand audience pre-selected |
| T-B23 | Pre-fill from event Blasts CTA | Tester live | Tap "Send Blast (N)" on event/[id]/blasts → composer opens with event audience pre-selected |
| T-B24 | End-to-end preview-mode send (LIVE=false) | Tester live | Schedule a campaign, wait 60s, verify rows in marketing_messages with status='preview_skipped' |
| T-B25 | End-to-end live send (LIVE=true, Resend sandbox) | Tester live (after operator gate) | Schedule a campaign, verify email lands in sandbox inbox |

---

## 13. Hard Guards (Implementor MUST NOT)

- ❌ Modify the Phase A migration `20260602000003_orch_0815_marketing_hub_phase_a.sql` — schema frozen
- ❌ Add new tables in Phase B — campaigns/messages/clicks/templates/unsubscribes all present
- ❌ Wire `MARKETING_SEND_LIVE_ENABLED=true` by default — must default `false`
- ❌ Send real email to real addresses during dev — Resend sandbox sender only until operator-gated
- ❌ Use `biz_brand_effective_rank_for_caller` in any marketing query (SECURITY DEFINER banned per Phase A SPEC §6.5) — use `mkt_brand_min_rank(uuid, text)` from A1 migration
- ❌ Use bare `crypto.randomUUID()` in any mingla-business CLIENT code — use `mingla-business/src/utils/randomId.ts` (Hermes ReferenceError per DEC-148). Deno edge functions CAN use `crypto.randomUUID()` freely (no Hermes constraint)
- ❌ Bypass the channel-extensibility invariants I-PROPOSED-BR/BS/BU
- ❌ Inline PostgREST filter strings with caller-supplied IDs — use `assertUuid()` helper from `marketingAudienceService.ts` (commit `b8d8b6f7` precedent)
- ❌ Use `oklch`/`oklab`/`lab(`/`lch(`/`color-mix` colors per `feedback_rn_color_formats.md`
- ❌ Render sub-sheets as Fragment siblings — INSIDE parent Sheet per `feedback_rn_sub_sheet_must_render_inside_parent.md`
- ❌ Skip the keyboard rule on TextInputs per `feedback_keyboard_never_blocks_input.md`
- ❌ Skip `accessibilityLabel` on any Pressable (I-39)
- ❌ Use Zustand persist for server records (I-PROPOSED-J)
- ❌ Use `.neq()` on nullable columns per `feedback_supabase_neq_null.md`
- ❌ Call SECURITY DEFINER RPCs from edge functions using `serviceClient()` when the RPC reads `auth.uid()` — use `userClient(req)` (DEC-148)
- ❌ Implement campaign report screen `/marketing/campaigns/[id].tsx` — that's Sub-ORCH-0815-C scope
- ❌ Implement Marketing → Overview real metrics — placeholder is fine for Phase B (Sub-ORCH-0815-C)
- ❌ Implement Marketing → Audiences real list — placeholder is fine for Phase B (Sub-ORCH-0815-C)
- ❌ Implement Marketing → Templates real list — placeholder is fine for Phase B (Sub-ORCH-0815-C)
- ❌ Touch ORCH-0817 (RCS) or ORCH-0818 (ads research) work in this PR
- ❌ Apply database migrations directly — operator runs `supabase db push --linked`

---

## 14. CI / Strict-Grep Gates

New gate `orch-0815-b-composer-and-send.mjs` registered in
`.github/workflows/strict-grep-mingla-business.yml` per the registry pattern.

Required checks (target count: 12):

1. `marketing-send/index.ts` has `switch (kind)` with `default: throw` (I-PROPOSED-BR)
2. `ChannelTabs.tsx` renders 3 tabs (literal grep for `email`, `sms`, `rcs` in same file) (I-PROPOSED-BS)
3. `compose.tsx` parses query param shape `audience={kind}:{id}` (I-PROPOSED-BU)
4. No bare `crypto.randomUUID()` in any new `mingla-business/src/**/*.ts(x)` file (Hermes safety)
5. No `oklch` / `oklab` / `lab(` / `lch(` / `color-mix` in any new file
6. No `biz_brand_effective_rank_for_caller` reference in any `marketing-*` edge function (banned for marketing)
7. `marketing-send/index.ts` reads `MARKETING_SEND_LIVE_ENABLED` env (live-broadcast gate present)
8. `marketing-send/index.ts` uses `FOR UPDATE SKIP LOCKED` (atomic claim pattern)
9. `marketing-track-click/index.ts` appends `utm_source=mingla` (UTM contract)
10. `marketing-unsubscribe/index.ts` verifies signed token (does NOT trust path param without signature check)
11. New pg_cron migration follows ORCH-0788 pattern (DO $$ probes for extensions + vault secrets + job presence)
12. Negative-control proof: implementor demonstrates each gate fires on at least 3 different intentional regressions

---

## 15. Failure Modes & Mitigation

| Failure | Mitigation |
|---|---|
| Resend API key missing | `marketing-send` returns 503 `resend_not_configured`; campaign marked `failed` with clear reason. Operator alerted via admin |
| Resend domain not verified (DKIM/SPF/DMARC) | Resend rejects with 401/403; campaign marked failed. Operator unblocks via Resend dashboard |
| pg_cron disabled mid-cycle | Scheduled campaigns delay until cron resumes. Admin dashboard surfaces "N campaigns past due" alert (out of scope for Phase B; defer to follow-up) |
| Campaign scheduled in past (clock drift) | pg_cron picks up immediately. Report shows actual send time |
| Audience changes between schedule + send (event deleted, brand removed) | Audience resolution returns 0 contacts; campaign sends to 0 recipients; report shows "Audience changed since scheduling" |
| Recipient unsubscribes between schedule + send | `marketing-send` re-checks suppression list immediately before each Resend call; race window <50ms |
| Two `marketing-send` invocations overlap | `FOR UPDATE SKIP LOCKED` prevents double-processing |
| Resend rate limit (429) | Exponential backoff inside function (3 retries: 1s/3s/9s); on final failure mark message failed |
| Resend webhook drops (open/click events lost) | Opens inferred from `marketing_clicks` rows; opens may under-report but conversions remain accurate (via UTM → orders) |
| Unsubscribe token tampered with | HS256 signature verification fails → 400 with friendly HTML "This unsubscribe link is invalid or expired" |
| User opens composer from event-context then changes brand mid-edit | Composer rejects audience-brand mismatch with confirmation "Audience belongs to a different brand — start a new campaign?" |
| Edge function exceeds Supabase 60s timeout on large audience | Process in batches of 50 contacts per invocation; resume on next cron tick. Defer batch-resume design to follow-up if 60s isn't enough |
| Composer crash mid-edit | Draft auto-save (800ms debounce) ensures last 1s of edits are recoverable |
| Operator forgets to set `RESEND_API_KEY` secret | `marketing-send` returns 503 with `resend_not_configured`; admin dashboard surfaces alert (out of scope; defer) |

---

## 16. Open Questions for Operator (non-blocking)

These should be answered before implementor PR closes but do not block SPEC approval:

1. **Resend sender domain.** SPEC §15 q3 default was Mingla-owned `tickets@usemingla.com` (or `marketing@mg.usemingla.com`) with "via Mingla" labelling. Confirm — or specify a per-brand verified sender.
2. **EventCardInserter render — full MJML card or text token?** Recommendation: ship the simple `{{event:[id]}}` token replaced server-side with a single styled `<table>` block (no MJML; ~50 lines of HTML in `marketingEmailRender.ts`). Operator can override to full MJML if desired (+200 lines).
3. **Schedule confirmation choreography.** Design §4.1 specifies multi-step animation (modal slide + card scale + icon rotation + accent pulse + medium haptic). Recommend SHIPPING the full choreography; operator may downgrade to "fade + toast" if implementor velocity is the bottleneck.
4. **pg_cron interval.** Default `* * * * *` (every 1 min). Operators with cost concerns may prefer `*/5 * * * *`. Recommend 1 min for Phase B; revisit only if Supabase Postgres pricing flags the cron.
5. **"Send now" path — invoke edge function directly or write status='scheduled' with scheduled_for=now()?** Recommendation: direct invocation via the composer (`userClient(req).functions.invoke('marketing-send', { body: { campaign_id } })`) for snappier UX; cron picks up missed campaigns as a safety net.
6. **Per-brand sender display name.** Currently the `From:` line will read `{Brand} via Mingla <{from_address}>`. Operator may want a different format (e.g., `Mingla on behalf of {Brand}`). Recommend the SPEC §5.1 Step 4 wording verbatim.
7. **Unsubscribe global-escalation copy.** Default: "Unsubscribe from all Mingla brands". Operator may want softer copy ("Stop all Mingla emails"). Defer to operator.

---

## 17. Implementor Deliverables

The implementor PR closing this SPEC must include:

1. New migration `supabase/migrations/[ts]_orch_0815_b_marketing_send_cron.sql` (pg_cron job)
2. Three new edge functions: `marketing-send/`, `marketing-track-click/`, `marketing-unsubscribe/`
3. New shared utilities: `_shared/marketingAudience.ts`, `_shared/marketingTokens.ts`, `_shared/marketingEmailRender.ts`
4. ~13 new `mingla-business/src/components/marketing/*.tsx` files (per §9.1)
5. ~5 new `mingla-business/src/hooks/marketing/*.ts` files (per §9.2)
6. ~3 new `mingla-business/src/services/marketing/*.ts` files (per §9.3)
7. New route files:
   - `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
   - REPLACE: `mingla-business/app/(tabs)/marketing/campaigns/index.tsx` (real list, not placeholder)
8. Modified route files (composer rewire):
   - `mingla-business/app/brand/[id]/blasts.tsx` (replace handleBlast toast with router.push)
   - `mingla-business/app/event/[id]/blasts/index.tsx` (same)
9. New strict-grep gate `.github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs`
10. New workflow job in `.github/workflows/strict-grep-mingla-business.yml`
11. New jest suite covering composer + hooks + services (T-B01..T-B06, T-B18)
12. New Deno suite covering 3 edge functions (T-B07..T-B17)
13. Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0815_B_COMPOSER_AND_SEND.md`
14. Negative-control evidence for all 12 strict-grep checks
15. tsc clean + jest green + Deno green + strict-grep green
16. **Before TEST dispatch:** orchestrator deploys all 3 new edge functions via local Supabase CLI per `feedback_orchestrator_deploys_edge_functions.md`. Implementor does NOT deploy.

---

## 18. Cross-References

- Parent SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0815_MARKETING_HUB_UI_PHASE_A.md` (§5.5 composer design contract, §6 schema, §7 edge functions, §9 invariants, §10 success criteria, §11 test matrix, §12 hard guards)
- Design spec: `Mingla_Artifacts/design/DESIGN_ORCH-0815_MARKETING_HUB_PHASE_A.md` (§5 Composer pixel-accurate layout, §10 accessibility)
- Strategy: `Mingla_Artifacts/MINGLA_BUSINESS_MARKETING_HUB_STRATEGY.md` §3.1–3.7
- QA report (Phase A): `Mingla_Artifacts/reports/QA_ORCH-0815_A2_COMBINED_REPORT.md`
- Decision log: DEC-149 (dual-surface placement)
- Live migration: `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql` (the schema this phase consumes)
- Live A2 code shipped on commit `6b3c95e0` + P1 fixes on `b8d8b6f7`
- pg_cron pattern precedent: `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql`
- Email brand-shell precedent: `supabase/functions/_shared/email/` (ORCH-0785)
- Hermes randomId pattern: `mingla-business/src/utils/randomId.ts` (DEC-148)
- userClient pattern for SECURITY DEFINER RPCs: `supabase/functions/_shared/ticketCheckout.ts` (DEC-148)
- UUID validation precedent: `assertUuid()` in `mingla-business/src/services/marketing/marketingAudienceService.ts` (ORCH-0815-A2-B commit `b8d8b6f7`)
- Mingla-bespoke rules: `feedback_keyboard_never_blocks_input.md`, `feedback_rn_sub_sheet_must_render_inside_parent.md`, `feedback_rn_color_formats.md`, `feedback_toast_needs_absolute_wrap.md`, `feedback_back_listener_disarm_pattern.md`, `feedback_zustand_persist_no_server_snapshots.md`, `feedback_orchestrator_deploys_edge_functions.md`

---

## 19. Working Tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. All Phase B artifacts (this SPEC, future implementation report, future QA report) live in the shared checkout. No worktree (per DEC-135 / I-PROPOSED-AC override 2026-05-11).
