# SPEC — ORCH-0948 [Waitlist feature — schema + RPC + buyer-web "Join waitlist" CTA + planner notification when spot opens]

**Date:** 2026-05-24
**Mode:** SPEC (binding contract)
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0948-[waitlist-feature]/` on branch `ORCH-0948-waitlist-feature`
**Binding investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0948_WAITLIST_FEATURE.md`
**Severity:** S2-medium / `missing-feature`
**Pipeline:** SPEC → IMPLEMENT (Codex `implementor-mingla`) → TEST (Claude `mingla-tester`) → CLOSE.

---

## 1. Scope

Reuse `public.waitlist_entries` as the canonical waitlist persistence table. Harden its schema, add an anon-tolerant signup edge function, a deterministic spot-open detector that enqueues invite notifications via the existing `ticket_order_notifications` queue, an extension to `ticket-confirmation-dispatch` that handles the new `waitlist_spot_open` template key, a buyer-web `JoinWaitlistSheet` mounted from both the public event page and the checkout `QuantityRow` sold-out state, and a planner read surface inside `TicketTierEditSheet`. Wire `waitlistEnabled` end-to-end through `QuantityRow`'s package interface so the checkout entry points can render the CTA.

## 2. Non-Goals

- **No new `waitlist_signups` table.** Reuse `waitlist_entries`; investigation Q1 + §"Reuse vs Rebuild" prove the substrate is sufficient.
- **No trip waitlist surface in this ORCH.** Trip pricing tiers hard-code `waitlistEnabled: false` (investigation Q4, `mingla-business/app/trip/[id]/index.tsx:75-88`). Trip waitlist requires a separate ORCH because the trip pricing schema doesn't carry the flag.
- **No changes to `confirm.tsx` or `TicketQrCarousel.tsx`.** META-ORCH-0952 [buyer-web confirm pipeline deep forensics] owns those files; ORCH-0948 stays out (investigation Q10).
- **No new `waitlist_offers` or `waitlist_notifications` parallel table.** Invites ride the existing `ticket_order_notifications` queue with `order_id` NULL-able expansion (see §5.1).
- **No `app-mobile/` or `mingla-admin/` source edits.** Out of surface scope.
- **No client-side anon INSERT policy on `waitlist_entries`.** Service-role-only writes via edge function (anon-tolerant buyer-routes invariant — `feedback_anon_buyer_routes.md`).
- **No planner "manual invite" button in this cut.** Read-only list + count. Manual invite is a follow-up ORCH if operator wants it after Phase B feedback.

## 3. Assumptions

1. **A1 — Real sold-out signal arrives via ORCH-0946.** ORCH-0946 [remaining-capacity exposure] will eventually expose `remainingCapacity` (or equivalent) to buyer-web. Until it ships, ORCH-0948 uses the existing `capacity === 0` check from `QuantityRow` and treats it as the trigger condition — this matches today's stub behaviour on the public event page. When ORCH-0946 lands, the CTA trigger condition tightens automatically because `capacity` will become real remaining capacity. **No code change in ORCH-0948 should depend on ORCH-0946 shipping first.** Both can ship independently; ORCH-0948 is correctness-compatible with both states.
2. **A2 — `ticket-confirmation-dispatch` is the unified dispatcher.** Template-key routing already exists (`supabase/functions/ticket-confirmation-dispatch/index.ts:767-771`). Adding a new `waitlist_spot_open` handler in the same commit is required because unknown template keys fail terminally by design.
3. **A3 — Resend + Twilio creds are live in the project.** No new provider secrets.
4. **A4 — Brand-team RLS SELECT policy already exists** on `waitlist_entries` (investigation Q1, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:14194-14196`) and is correct as-is for planner reads. No new policy needed for read.

## 4. Cross-Surface Impact (mandatory)

| Surface | In scope? | Behaviour the spec demands | Parity |
|---|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | **NO** | n/a — `app-mobile/` doesn't render ticket buyer flows. | — |
| Consumer Android (`app-mobile/` Android) | **NO** | n/a — same reason. | — |
| Buyer/anonymous Web (`mingla-business/` `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`) | **YES** | (a) Sold-out + `waitlistEnabled === true` tickets render "Join waitlist" CTA in `QuantityRow` AND in the public event page sold-out row. (b) Tapping opens `JoinWaitlistSheet` with email + phone + qty stepper + consent line. (c) Submit calls `/waitlist-signup` edge fn; success toast + sheet-close + idempotent re-submit handling. (d) Anon access — no auth redirect. | Automatic — single shared `JoinWaitlistSheet` component. SC-1 + SC-2 cover both entry points. |
| Business iOS (`mingla-business/` iOS) | **YES** | (a) `TicketTierEditSheet` gains a "Waitlist signups" read-only block (count + most-recent 5 list + "see all" link to a full-list sheet) when `waitlistEnabled === true` AND the ticket type has saved rows. (b) Real-time count updates via `useEventWaitlist` hook subscription. | Manual code path — see Business Android row; same React Native code renders both. SC-3 covers both. |
| Business Android (`mingla-business/` Android) | **YES** | Same as Business iOS. | Same RN code; SC-3-android verified separately on emulator. |
| Admin Web (`mingla-admin/`) | **NO** | No admin equivalent for waitlist signups in v1. If ops needs it, register follow-up ORCH. | — |
| Business Web preview (`mingla-business/` web dev build) | **YES** (parity check only) | Planner Waitlist block must render correctly under Expo Web — read-only data, no native-only API used. | Shared code; SC-3-web is a smoke-only parity check. |

## 5. Dependencies & Sequencing

- **ORCH-0946 [remaining-capacity exposure]** — soft dependency. ORCH-0948 ships correctness-compatible with both pre- and post-ORCH-0946 states (per A1). When ORCH-0946 lands, the CTA trigger improves automatically; no code coordination required.
- **META-ORCH-0952 [buyer-web confirm pipeline deep forensics]** — hard exclusion. ORCH-0948 implementor MUST NOT touch `confirm.tsx`, `TicketQrCarousel.tsx`, or any file inside `mingla-business/app/checkout/[eventId]/confirm/` or `mingla-business/app/checkout-trip/[tripEventId]/confirm/`. If META-ORCH-0952 rewrites the checkout entry/listing area later, ORCH-0948's CTA wiring in `QuantityRow` survives because it's at the package-component layer below the page layer.
- **Notification queue (ORCH-0788)** — reused as-is. Schema unchanged except for the `order_id` nullability assertion in §6.1.

---

## 6. Database Layer

### 6.1 Migration: `supabase/migrations/<TIMESTAMP>_orch_0948_waitlist_feature.sql`

**Single migration, idempotent (`IF NOT EXISTS` / `DROP IF EXISTS` patterns).**

#### 6.1.a — Harden `waitlist_entries`

```sql
ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS qty_requested int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'buyer_web',
  ADD COLUMN IF NOT EXISTS notified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS notification_id uuid NULL
    REFERENCES public.ticket_order_notifications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_order_id uuid NULL
    REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE public.waitlist_entries
  ADD CONSTRAINT waitlist_entries_qty_requested_positive
    CHECK (qty_requested > 0 AND qty_requested <= 20) NOT VALID;
ALTER TABLE public.waitlist_entries VALIDATE CONSTRAINT waitlist_entries_qty_requested_positive;

ALTER TABLE public.waitlist_entries
  ADD CONSTRAINT waitlist_entries_source_known
    CHECK (source IN ('buyer_web','buyer_app','planner_manual','migration')) NOT VALID;
ALTER TABLE public.waitlist_entries VALIDATE CONSTRAINT waitlist_entries_source_known;

ALTER TABLE public.waitlist_entries
  ADD CONSTRAINT waitlist_entries_contact_present
    CHECK (
      (email IS NOT NULL AND length(btrim(email)) > 0)
      OR (phone IS NOT NULL AND length(btrim(phone)) > 0)
    ) NOT VALID;
ALTER TABLE public.waitlist_entries VALIDATE CONSTRAINT waitlist_entries_contact_present;
```

**Dedupe indexes — block double-signup at the DB layer:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_dedupe_email_idx
  ON public.waitlist_entries (ticket_type_id, lower(email))
  WHERE status IN ('waiting','invited') AND email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_dedupe_phone_idx
  ON public.waitlist_entries (ticket_type_id, phone)
  WHERE status IN ('waiting','invited') AND phone IS NOT NULL AND (email IS NULL OR length(btrim(email)) = 0);

CREATE INDEX IF NOT EXISTS waitlist_entries_fifo_idx
  ON public.waitlist_entries (ticket_type_id, created_at)
  WHERE status = 'waiting';
```

#### 6.1.b — Assert `ticket_order_notifications.order_id` is nullable

The waitlist invite notification has no parent order. Investigation Q8 confirms the queue's `order_id` column exists; SPEC requires it be nullable. If a future migration tightens this to NOT NULL, ORCH-0948 breaks — add an invariant test (§9).

```sql
DO $$
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ticket_order_notifications' AND column_name = 'order_id') = 'NO'
  THEN
    RAISE EXCEPTION 'ORCH-0948 requires ticket_order_notifications.order_id to be NULLABLE for waitlist invites';
  END IF;
END$$;
```

If currently NOT NULL: prepend `ALTER TABLE public.ticket_order_notifications ALTER COLUMN order_id DROP NOT NULL;` to the migration. Implementor MUST verify against latest migration state before writing the file and add the ALTER if needed.

#### 6.1.c — Spot-open detector trigger

Trigger fires AFTER UPDATE on `public.tickets` when `status` transitions from a capacity-consuming value (`valid`, `used`, `transferred`) to a capacity-freeing value (`refunded`, `cancelled`, `void`). The trigger calls a helper function that:

1. Computes freed quantity for the `ticket_type_id`.
2. Selects the FIFO N waiting `waitlist_entries` rows where `notified_at IS NULL` AND `status = 'waiting'`, summing `qty_requested` until ≥ freed quantity. Caps N at the row that first satisfies the sum (do not split).
3. For each selected row, INSERT into `ticket_order_notifications` with `order_id = NULL`, `channel` = `'email'` (if email present) and/or `'sms'` (if phone present and no email), `recipient` = email-or-phone, `status = 'pending'`, `payload = jsonb_build_object('template_key','waitlist_spot_open','waitlist_entry_id', we.id, 'event_id', we.event_id, 'ticket_type_id', we.ticket_type_id, 'qty_requested', we.qty_requested, 'invite_expires_at', (now() + interval '24 hours'))`, `idempotency_key = 'waitlist_invite:' || we.id`.
4. UPDATE `waitlist_entries` row: `status = 'invited'`, `invited_at = now()`, `notified_at = now()`, `notification_id = <new row id>`.
5. Wrap insert + update in single transaction.

Trigger SQL:

```sql
CREATE OR REPLACE FUNCTION public.fn_waitlist_drain_on_capacity_freed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_freed int;
  v_running int := 0;
  v_entry record;
  v_notification_id uuid;
  v_channel text;
  v_recipient text;
BEGIN
  -- Only fire on capacity-freeing transitions.
  IF NEW.status NOT IN ('refunded','cancelled','void') THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('valid','used','transferred') THEN RETURN NEW; END IF;
  IF NEW.ticket_type_id IS NULL THEN RETURN NEW; END IF;

  v_freed := 1; -- one row = one freed unit; trigger fires per ticket row.

  FOR v_entry IN
    SELECT id, event_id, ticket_type_id, email, phone, qty_requested
    FROM public.waitlist_entries
    WHERE ticket_type_id = NEW.ticket_type_id
      AND status = 'waiting'
      AND notified_at IS NULL
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_running >= v_freed;

    IF v_entry.email IS NOT NULL AND length(btrim(v_entry.email)) > 0 THEN
      v_channel := 'email';
      v_recipient := v_entry.email;
    ELSIF v_entry.phone IS NOT NULL AND length(btrim(v_entry.phone)) > 0 THEN
      v_channel := 'sms';
      v_recipient := v_entry.phone;
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.ticket_order_notifications
      (order_id, channel, recipient, status, payload, idempotency_key, attempt_count)
    VALUES
      (NULL, v_channel, v_recipient, 'pending',
       jsonb_build_object(
         'template_key','waitlist_spot_open',
         'waitlist_entry_id', v_entry.id,
         'event_id', v_entry.event_id,
         'ticket_type_id', v_entry.ticket_type_id,
         'qty_requested', v_entry.qty_requested,
         'invite_expires_at', (now() + interval '24 hours')
       ),
       'waitlist_invite:' || v_entry.id::text,
       0)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_notification_id;

    IF v_notification_id IS NOT NULL THEN
      UPDATE public.waitlist_entries
      SET status = 'invited',
          invited_at = now(),
          notified_at = now(),
          notification_id = v_notification_id
      WHERE id = v_entry.id;
      v_running := v_running + v_entry.qty_requested;
    END IF;
  END LOOP;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_waitlist_drain_on_capacity_freed ON public.tickets;
CREATE TRIGGER trg_waitlist_drain_on_capacity_freed
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_waitlist_drain_on_capacity_freed();
```

**Idempotency:** `ticket_order_notifications.idempotency_key` already exists (investigation Q8). The `ON CONFLICT ... DO NOTHING` ensures the same waitlist row is never invited twice even if the trigger fires twice (e.g., refund retry).

#### 6.1.d — RPC: `event_waitlist_get(p_event_id uuid)`

Planner read RPC. SECURITY INVOKER (relies on existing brand-team SELECT RLS on `waitlist_entries`). Returns one row per ticket_type with aggregate count + most-recent N rows.

```sql
CREATE OR REPLACE FUNCTION public.event_waitlist_get(p_event_id uuid, p_recent_limit int DEFAULT 5)
RETURNS TABLE (
  ticket_type_id uuid,
  ticket_type_name text,
  waitlist_enabled boolean,
  waiting_count int,
  invited_count int,
  recent jsonb
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    tt.id AS ticket_type_id,
    tt.name AS ticket_type_name,
    tt.waitlist_enabled,
    COALESCE((SELECT count(*)::int FROM public.waitlist_entries we
              WHERE we.ticket_type_id = tt.id AND we.status = 'waiting'), 0) AS waiting_count,
    COALESCE((SELECT count(*)::int FROM public.waitlist_entries we
              WHERE we.ticket_type_id = tt.id AND we.status = 'invited'), 0) AS invited_count,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', we.id, 'name', we.name, 'email', we.email, 'phone', we.phone,
              'qty_requested', we.qty_requested, 'status', we.status, 'created_at', we.created_at
            ) ORDER BY we.created_at DESC)
            FROM (SELECT * FROM public.waitlist_entries
                  WHERE ticket_type_id = tt.id
                  ORDER BY created_at DESC LIMIT p_recent_limit) we), '[]'::jsonb) AS recent
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL
    AND tt.waitlist_enabled = true
  ORDER BY tt.display_order ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.event_waitlist_get(uuid, int) TO authenticated;
```

Per `feedback_rls_returning_owner_gap.md`, do NOT add an aggregate SECURITY DEFINER helper; the brand-team SELECT RLS on `waitlist_entries` (`supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:14194-14196`) handles row visibility, and SECURITY INVOKER preserves that.

---

## 7. Edge Function Layer

### 7.1 New function: `supabase/functions/waitlist-signup/index.ts`

**Anon-tolerant** (registered in `supabase/config.toml` with `verify_jwt = false`, mirroring buyer routes).

**Request:**

```ts
POST /waitlist-signup
Content-Type: application/json
{
  "event_id": string (uuid),
  "ticket_type_id": string (uuid),
  "email"?: string,
  "phone"?: string,
  "name"?: string,
  "qty_requested": number (1..20),
  "consent": true  // must be literally true; rejects otherwise
}
```

**Response — success:**

```ts
200 { "ok": true, "waitlist_entry_id": string, "status": "waiting" | "already_waiting" }
```

**Response — error:**

```ts
400 { "error": "invalid_input", "detail": "..." }
404 { "error": "ticket_type_not_found_or_waitlist_disabled" }
409 { "error": "already_waiting", "waitlist_entry_id": string }  // friendly dedupe
422 { "error": "missing_contact" }  // neither email nor phone supplied
500 { "error": "internal" }
```

**Behaviour:**

1. Parse + validate body (zod-like manual validation, no new lib). Reject `consent !== true`.
2. SELECT `ticket_types` where `id = ticket_type_id AND event_id = event_id AND waitlist_enabled = true AND deleted_at IS NULL`. 404 on miss.
3. Service-role INSERT into `waitlist_entries` with `status = 'waiting'`, `source = 'buyer_web'`, `consent_at = now()`. Use the dedupe unique indexes (§6.1.a) — on `23505` unique-violation, SELECT the existing row and return `409 already_waiting` with the existing entry id.
4. Return `200 ok` with the new row id.

**Hard guards:**
- No PII logged. Log only event_id + ticket_type_id + outcome.
- Rate-limit: rely on existing Supabase edge gateway throttling; if needed, add a simple in-memory token bucket per (`x-forwarded-for`, `ticket_type_id`) of 5 req/min — implementor may defer if Supabase gateway proves sufficient (note in implementation report).
- Service-role key read from `SUPABASE_SERVICE_ROLE_KEY` env (already wired in other anon-tolerant functions; do NOT inline).

### 7.2 Extension: `supabase/functions/ticket-confirmation-dispatch/index.ts`

Add a `waitlist_spot_open` branch to the template-key switch (currently at `supabase/functions/ticket-confirmation-dispatch/index.ts:782-979`). The branch:

1. Reads `payload.waitlist_entry_id`, `event_id`, `ticket_type_id`, `qty_requested`, `invite_expires_at`.
2. SELECTs event + brand + ticket-type for copy.
3. Renders email via new template at `supabase/functions/_shared/email/templates/waitlistSpotOpen.ts` exporting `renderWaitlistSpotOpenEmail({brand, event, ticketType, qtyRequested, expiresAt, claimUrl})` returning `{subject, html, text}`. Claim URL is `${PUBLIC_BUYER_BASE_URL}/checkout/${event_id}?wl=${waitlist_entry_id}` (the `?wl=` query param is informational — checkout does not consume it in v1; reserved for a future "auto-select tier" enhancement).
4. Renders SMS via `renderWaitlistSpotOpenSms(...)` returning short body with claim URL.
5. Calls `sendResendEmailWithAttachment` (no attachment — pass `attachments: []`) for email, `sendTwilioMessage` for SMS, using existing helpers.
6. On success: marks `ticket_order_notifications` row `sent` per existing pattern; ALSO updates `waitlist_entries.notification_id` is already set by trigger (no extra write).
7. On failure: existing retryable/terminal classification applies.

**Hard guard:** add `waitlist_spot_open` AFTER `buyer_ticket_confirmation` and refund branches, BEFORE the unknown-template terminal-fail else-branch. Do not change behaviour of existing branches.

### 7.3 `supabase/config.toml`

Add:

```toml
[functions.waitlist-signup]
verify_jwt = false
```

Mirror the entry style of `ticket-checkout-create` and other buyer-anon functions.

---

## 8. Client Layer (`mingla-business/` + `packages/event-rendering/`)

### 8.1 Package extension — `packages/event-rendering/QuantityRow.tsx`

Extend `QuantityRowTicket` with optional `waitlistEnabled?: boolean` (default false) and `QuantityRowProps` with optional `onJoinWaitlist?: (ticketId: string) => void`. When `capacity === 0 && ticket.waitlistEnabled && onJoinWaitlist`, replace the existing "Sold out" badge with a tappable "Join waitlist" affordance (same visual footprint as the sold-out badge, accent color, full a11y label "Join waitlist for <ticket name>"). All other states unchanged.

**Backwards compat:** when `onJoinWaitlist` is undefined OR `waitlistEnabled` is false, falls back to existing "Sold out" badge. Consumer app and any non-business host stays identical.

### 8.2 `packages/event-rendering/types.ts`

Add `waitlistEnabled?: boolean` to `PublicTicketProps` if not already present in a sibling type used by `QuantityRow`. (Investigation Q3 confirms `waitlistEnabled` already exists in some `types.ts` shapes; the implementor must reconcile with `QuantityRowTicket` so the same boolean reaches both renderers.)

### 8.3 Buyer-web component — `mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx` (new)

Bottom-sheet modal (`Sheet` primitive — per Claude memory rule `feedback_rn_sub_sheet_must_render_inside_parent.md`). Renders inside parent sheet/page tree; never a Fragment sibling. Fields:

- Email (TextInput, type="email-address", autocapitalize="none")
- Phone (TextInput, type="phone-pad") — optional if email present, required if email empty
- Name (optional)
- Qty stepper (1–6 visible; clamps to `ticket.maxPurchaseQty ?? 6`)
- Consent checkbox: "I'm OK with Mingla emailing or texting me only about this event's waitlist." Required true to enable Submit.
- Submit calls `useJoinWaitlistMutation` (§8.4); on success show Toast "You're on the waitlist." (per Claude memory rule `feedback_toast_needs_absolute_wrap.md` — wrap toast in absolute-positioned wrapper) and close. On 409 `already_waiting` show "You're already on the waitlist." and close. On other errors show toast "Couldn't add you to the waitlist. Try again." and keep sheet open.

Keyboard-blocks-input rule applies — Claude memory rule `feedback_keyboard_never_blocks_input.md`. Mirror the Cycle 3 wizard root pattern (Keyboard listener + dynamic paddingBottom).

### 8.4 Buyer-web service + hook

**Service** — `mingla-business/src/services/waitlistService.ts` (new):

```ts
export interface JoinWaitlistInput {
  eventId: string;
  ticketTypeId: string;
  email?: string;
  phone?: string;
  name?: string;
  qtyRequested: number;
  consent: true;
}
export interface JoinWaitlistResult {
  waitlistEntryId: string;
  status: 'waiting' | 'already_waiting';
}
export async function joinWaitlist(input: JoinWaitlistInput): Promise<JoinWaitlistResult>
```

Calls supabase functions invoke `waitlist-signup`. Uses `app-mobile/src/utils/edgeFunctionError.ts` equivalent for error parsing (or its mingla-business mirror — investigation Q5 + memory `feedback_supabase_error_handling`). Maps 409 to `{status: 'already_waiting'}` instead of throwing.

**Hook** — `mingla-business/src/hooks/useJoinWaitlistMutation.ts` (new): React Query `useMutation` wrapping `joinWaitlist`. On success, invalidate `['event-waitlist', eventId]` (used by planner).

### 8.5 Public event page wiring

Replace the toast-only `onJoinWaitlist` at `mingla-business/src/components/event/PublicEventPage.tsx:203-210` with a state hook that opens `JoinWaitlistSheet` with the tapped ticket id. Pass through `ticketType.waitlistEnabled` (already plumbed per investigation Q2).

### 8.6 Checkout entry wiring

`mingla-business/app/checkout/[eventId]/index.tsx` (sold-out path at `:167-185` and the QuantityRow render at `:258-276`): when any visible ticket has `capacity === 0 && waitlistEnabled === true`, pass `onJoinWaitlist={(id) => openWaitlistSheet(id)}` into `QuantityRow`. Same for `/e/{brandSlug}/{eventSlug}` route renderers. Mount `JoinWaitlistSheet` inside the parent page (never as Fragment sibling).

**Hard exclusion:** do NOT touch `mingla-business/app/checkout/[eventId]/confirm/` or `mingla-business/app/checkout-trip/[tripEventId]/confirm/`. Those belong to META-ORCH-0952.

### 8.7 Trip checkout

Out of scope. `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` is not modified; trip pricing tier mapping at `mingla-business/app/trip/[id]/index.tsx:75-88` continues to hard-code `waitlistEnabled: false`. Add a `// ORCH-0948: trip waitlist deferred to a future ORCH — see SPEC §2 non-goal` comment.

### 8.8 Planner read surface

**Hook** — `mingla-business/src/hooks/useEventWaitlist.ts` (new): React Query `useQuery` keyed `['event-waitlist', eventId]`, calling RPC `event_waitlist_get(eventId)`. `staleTime: 30_000`. Subscribes to Realtime channel filtered on `waitlist_entries` rows where `event_id = eventId` for invalidation on insert/update.

**Component changes** — `mingla-business/src/components/event/TicketTierEditSheet.tsx`:

At the existing waitlist-toggle block (`:952-964`), append a read-only "Waitlist signups" panel that renders ONLY when `waitlistEnabled === true` AND `useEventWaitlist(eventId).data` has matching row with `waiting_count + invited_count > 0`:

- Header: "Waitlist · N waiting · M invited"
- Most-recent 5 list rows with name (or "Anonymous"), masked email (`a***@x.com`), qty.
- "See all" button → opens `WaitlistEntriesSheet` (new sub-sheet, mounted inside `TicketTierEditSheet` per sub-sheet rule) showing full paginated list (page size 25).

No edit affordances in v1 — read-only.

### 8.9 Notification template files

- `supabase/functions/_shared/email/templates/waitlistSpotOpen.ts` — subject: "A spot just opened: {{eventTitle}}". Body: brief, claim URL, expiry warning ("This invite expires in 24 hours"), unsubscribe note ("You're getting this because you joined the waitlist for {{eventTitle}}").
- `supabase/functions/_shared/sms/templates/waitlistSpotOpen.ts` — short: "Mingla: A {{ticketTypeName}} spot just opened for {{eventTitle}}. Claim within 24h: {{claimUrl}}"

Sender per existing constants at `supabase/functions/_shared/email/senders.ts:24-33`. Use the existing buyer sender (no new sender identity needed).

---

## 9. Success Criteria

| ID | Criterion | Verifiable on surface |
|---|---|---|
| SC-1-web | On `/e/{brandSlug}/{eventSlug}` with a sold-out (`capacity === 0`) tier whose `waitlist_enabled = true`, the row shows a tappable "Join waitlist" affordance instead of a dead "Sold out" badge. Tapping opens `JoinWaitlistSheet`. | buyer-web |
| SC-2-web | On `/checkout/{eventId}` with the same conditions, `QuantityRow` shows the same "Join waitlist" affordance and opens the same sheet. | buyer-web |
| SC-3-iOS / SC-3-android / SC-3-web | In `TicketTierEditSheet` on a saved ticket with `waitlistEnabled = true` and ≥1 waitlist row, the "Waitlist signups" panel renders with correct counts and most-recent list. Real-time insert from a buyer signup updates the count without page refresh. | business iOS + Android + web preview (separately verified) |
| SC-4 | `JoinWaitlistSheet` submit with valid email + consent inserts one `waitlist_entries` row (`status = 'waiting'`, `source = 'buyer_web'`, `consent_at` populated). | DB |
| SC-5 | Re-submitting the same email for the same ticket_type returns HTTP 409 `already_waiting` and the sheet shows "You're already on the waitlist." (does NOT create a duplicate row, does NOT show generic error). | edge fn + UI |
| SC-6 | When a `tickets` row transitions from `valid` to `refunded`/`cancelled`/`void` for a ticket_type with ≥1 waiting waitlist row, the trigger inserts a `ticket_order_notifications` row with `template_key = 'waitlist_spot_open'`, status `pending`, and updates the waitlist row to `status = 'invited'`, `notified_at = now()`. | DB |
| SC-7 | `ticket-confirmation-dispatch` invoked against a `waitlist_spot_open` row sends an email via Resend (or SMS via Twilio if no email) with the claim URL, marks the notification `sent`, and does NOT regress any other template branch. | edge fn |
| SC-8 | Submitting with `consent !== true` returns HTTP 400 `invalid_input` and the row is NOT created. | edge fn |
| SC-9 | Submitting with neither email nor phone returns HTTP 422 `missing_contact`. | edge fn |
| SC-10 | All anon access paths (`/waitlist-signup`, public event page, checkout) work with no auth session — no redirect to sign-in. | buyer-web |
| SC-11 | No console error, no constitutional violation (no dead taps, no silent failures, no fabricated data, no logout-survivor PII). | all surfaces |
| SC-12 | `confirm.tsx` and `TicketQrCarousel.tsx` diffs are empty (META-ORCH-0952 exclusion preserved). | git diff at PR |

---

## 10. Invariants

### Preserved

| ID | Invariant | How preserved |
|---|---|---|
| I-ANON-BUYER-ROUTES | Anon buyer routes live outside `app/(tabs)/` and never call `useAuth`. | `JoinWaitlistSheet` is mounted from existing anon routes only; no `useAuth` import. |
| I-RLS-RETURNING-OWNER-GAP | Pair owner-callable mutations with direct RLS predicates. | `event_waitlist_get` uses SECURITY INVOKER + existing brand-team SELECT RLS. No SECURITY DEFINER short-circuit. |
| I-ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS | Persist IDs, not server records. | Waitlist data is React Query only; no Zustand persistence. |
| I-NO-FABRICATED-DATA | Missing = hidden, never faked. | "Waitlist signups" panel only renders when `waiting + invited > 0`. |
| I-KEYBOARD-NEVER-BLOCKS-INPUT | TextInput always above keyboard. | `JoinWaitlistSheet` uses Cycle 3 wizard root pattern. |
| I-TOAST-NEEDS-ABSOLUTE-WRAP | Toast wrapped in absolute-positioned wrapper. | Toast usage in sheet follows pattern. |
| I-SUB-SHEET-INSIDE-PARENT | Sub-sheets render inside parent Sheet children, not Fragment siblings. | `WaitlistEntriesSheet` inside `TicketTierEditSheet`; `JoinWaitlistSheet` inside its host page. |
| I-RN-INLINE-COLORS | hex/rgb/hsl/hwb only — no oklch/lab. | Sheet styles use existing theme tokens. |

### New (added by this ORCH)

| ID | Invariant | Enforcement |
|---|---|---|
| I-WAITLIST-DEDUPE-DB | A buyer cannot appear twice in `waiting` or `invited` status for the same ticket_type_id on the same contact. | Partial unique indexes §6.1.a + edge-fn 409 mapping. Regression test §11 (T-WL-05). |
| I-WAITLIST-INVITE-IDEMPOTENT | The drain trigger never inserts two notification rows for the same waitlist_entry_id. | `ON CONFLICT (idempotency_key) DO NOTHING` + `idempotency_key = 'waitlist_invite:' || we.id`. Regression test §11 (T-WL-08). |
| I-WAITLIST-FIFO | When N spots free, the N oldest `waiting` rows (by `created_at`) get invited. | Trigger loop ORDER BY `created_at ASC`. Regression test §11 (T-WL-07). |
| I-WAITLIST-NOTIFICATION-ORDER-ID-NULLABLE | `ticket_order_notifications.order_id` must be nullable so waitlist invites can be enqueued without a parent order. | Migration guard §6.1.b raises if NOT NULL. Regression test §11 (T-WL-09). |
| I-WAITLIST-CONFIRM-EXCLUSION | ORCH-0948 PR diff contains zero lines touching `confirm.tsx` or `TicketQrCarousel.tsx`. | Strict-grep CI gate added in `.github/scripts/strict-grep/orch-0948-waitlist-feature.mjs` per `feedback_strict_grep_registry_pattern.md`. Failing gate blocks merge. |

---

## 11. Regression Tests (mandatory — Step 0.5 gate)

Per `feedback_close_commit_precommit_checks.md` + ORCH-0840 enforcement: implementor MUST ship happy-path tests with `fails-on-revert verified at <commit hash>`. Tester ships adversarial tests at different angles.

### Implementor happy-path tests (ship in IMPLEMENT commit)

| ID | Path | What it asserts |
|---|---|---|
| T-WL-01 | `supabase/functions/waitlist-signup/__tests__/signup-happy.test.ts` | POST with valid email + consent returns 200 + new row; row exists in DB with correct columns. |
| T-WL-02 | `supabase/functions/waitlist-signup/__tests__/signup-dedupe.test.ts` | Second POST with same email + ticket_type returns 409 `already_waiting` with existing id; no duplicate row. |
| T-WL-03 | `mingla-business/src/components/waitlist/__tests__/JoinWaitlistSheet.test.tsx` | Renders fields; Submit disabled until consent ticked + at least one contact present; success path closes sheet + shows toast. |
| T-WL-04 | `mingla-business/src/components/checkout/__tests__/QuantityRow.waitlist.test.tsx` | When `capacity === 0 && waitlistEnabled && onJoinWaitlist`, renders Join-waitlist affordance; calls `onJoinWaitlist(ticket.id)` on tap. |
| T-WL-05 | `supabase/migrations/__tests__/orch_0948_dedupe.spec.sql` (or TS migration test if jest-pg available) | Inserting two rows with same `(ticket_type_id, lower(email))` and `status = 'waiting'` raises `23505`. |
| T-WL-06 | `supabase/functions/_shared/email/templates/__tests__/waitlistSpotOpen.test.ts` | Renders subject, html, text correctly with claim URL; no XSS in interpolated event title. |

### Tester adversarial tests (ship in TEST commit, different angles from above)

| ID | Path | What it asserts |
|---|---|---|
| T-WL-07 | `supabase/migrations/__tests__/orch_0948_fifo.spec.ts` | Insert 3 waiting rows at distinct `created_at`; free 2 capacity units (UPDATE 2 tickets to refunded); assert oldest 2 rows become `invited` and 3rd stays `waiting`. |
| T-WL-08 | `supabase/migrations/__tests__/orch_0948_trigger_idempotent.spec.ts` | Update same ticket from valid→refunded→valid→refunded; assert exactly ONE notification row exists for the corresponding waitlist entry. |
| T-WL-09 | `supabase/migrations/__tests__/orch_0948_notification_order_id_nullable.spec.ts` | Assert `ticket_order_notifications.order_id` is nullable; assert insert with `order_id = NULL` and `payload->>'template_key' = 'waitlist_spot_open'` succeeds. |
| T-WL-10 | `supabase/functions/ticket-confirmation-dispatch/__tests__/waitlist-spot-open.adversarial.test.ts` | (a) Malformed payload (missing `waitlist_entry_id`) → notification marked failed with non-retryable detail; (b) SMS-only path when buyer has phone but no email; (c) unknown email provider error → retryable. |
| T-WL-11 | `mingla-business/src/components/waitlist/__tests__/JoinWaitlistSheet.adversarial.test.tsx` | (a) Consent ticked then unticked re-disables Submit; (b) email format invalid blocks Submit + shows inline error; (c) network error keeps sheet open + shows toast. |
| T-WL-12 | `.github/scripts/strict-grep/__tests__/orch-0948-confirm-exclusion.test.ts` | Strict-grep gate fails the build when a hypothetical diff touches `confirm.tsx` or `TicketQrCarousel.tsx` (META-ORCH-0952 exclusion). |

**Pass requirement:** every test above lands with a documented `fails-on-revert verified at <commit hash>` line in the implementation/QA report — proving it actually exercises the change.

**Append-only:** all tests above are protected by `.github/workflows/tests-append-only.yml`. Future modification requires a new ORCH and `[TEST-MOD-APPROVED ORCH-NNNN]` in the commit body.

---

## 12. Implementation Order

1. **DB migration** (`supabase/migrations/<TIMESTAMP>_orch_0948_waitlist_feature.sql`) — §6.1.a → §6.1.b (guard) → §6.1.c (trigger) → §6.1.d (RPC).
2. **Migration tests** T-WL-05, T-WL-07, T-WL-08, T-WL-09.
3. **Edge function — extension** — add `waitlist_spot_open` branch to `ticket-confirmation-dispatch` + new template files (§7.2, §8.9).
4. **Edge function — new** — `waitlist-signup` (§7.1) + `supabase/config.toml` entry (§7.3) + edge tests T-WL-01, T-WL-02, T-WL-06.
5. **Package** — extend `packages/event-rendering/QuantityRow.tsx` + types (§8.1, §8.2) + test T-WL-04.
6. **Service + hook** — `waitlistService.ts` + `useJoinWaitlistMutation.ts` (§8.4) + `useEventWaitlist.ts` (§8.8).
7. **Component** — `JoinWaitlistSheet.tsx` (§8.3) + test T-WL-03.
8. **Wiring** — public event page (§8.5) + checkout entry (§8.6) + planner panel in `TicketTierEditSheet` (§8.8) + `WaitlistEntriesSheet`.
9. **Strict-grep gate** — `.github/scripts/strict-grep/orch-0948-waitlist-feature.mjs` registering I-WAITLIST-CONFIRM-EXCLUSION + integration into `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md`.
10. **Adversarial tests** (added by TEST phase, not IMPLEMENT): T-WL-10, T-WL-11, T-WL-12.

**Backend allowlist gate:** per `feedback_close_commit_precommit_checks.md`, add the touched edge function names + migration filename to `ORCH_0948_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (or equivalent registry file at implementor time — implementor must verify the current registry filename) in the SAME commit as backend changes.

---

## 13. Operator action required (between IMPLEMENT and TEST)

Per Mingla orchestrator memory `feedback_orchestrator_deploys_edge_functions.md`:

- **Operator:** `supabase db push --linked` (DB migration).
- **Orchestrator (this skill's parent):** `supabase functions deploy waitlist-signup` and `supabase functions deploy ticket-confirmation-dispatch` via local CLI.
- **Verification:** `mcp__supabase__list_edge_functions` confirms version bumps; `mcp__supabase__list_migrations` confirms migration applied.

---

## 14. Regression Prevention

- DB invariant tests T-WL-05/07/08/09 catch any future schema drift or trigger logic regression.
- Strict-grep gate I-WAITLIST-CONFIRM-EXCLUSION blocks accidental edits to META-ORCH-0952 files.
- Append-only tests workflow protects all 12 regression tests from silent weakening.
- Dispatcher's existing unknown-template-key terminal-fail guarantees that any future template removal surfaces loudly.
- Backend allowlist registry catches any future PR touching backend without explicit ORCH allowlisting.

---

## 15. CLOSE banner requirements

When this ORCH CLOSEs, the banner MUST include:

- Two test paths (one implementor, one tester) with `fails-on-revert verified at <commit>` lines (Step 0.5 gate).
- `[deploy]` tag in commit subject (buyer-web changes ship to all 3 Vercel projects).
- Backend allowlist update reference (migration filename + edge fn names added to registry).
- DIAG-marker grep result: `[ORCH-0948-DIAG]` returns zero matches.
- Worktree reap: `~/Desktop/mingla-orchs/ORCH-0948-[waitlist-feature]/` + branch `ORCH-0948-waitlist-feature`.
- Registry row deletion line in commit per `feedback_orchestrator_removes_registry_row_in_close_commit.md`.

---

## 16. Open questions (none blocking — surfaced for operator awareness)

1. **Invite expiry enforcement.** Spec writes `invite_expires_at = now() + 24h` in the notification payload but no DB job demotes expired `invited` rows back to `waiting` (so the next freed spot can invite the next FIFO row). v1 accepts this — a later ORCH can add a cron sweep. Risk: a fixed pipeline of expired invites silently consumes freed capacity. Operator may want this raised to MUST in v1.
2. **Trip waitlist.** Trip pricing tiers can't waitlist today (schema gap). Register follow-up ORCH if product wants parity.
3. **Manual planner invite override.** Read-only v1. Add follow-up ORCH if planners ask after first real campaigns.

---

**SPEC ends. Implementor: read this end-to-end before writing any code. Tester: read this end-to-end before writing any adversarial test.**
