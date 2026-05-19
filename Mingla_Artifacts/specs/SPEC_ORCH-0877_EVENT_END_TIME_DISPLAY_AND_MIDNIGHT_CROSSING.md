# SPEC — ORCH-0877 — Event end-time display + midnight-crossing single-day authoring (Path B)

**Status:** DRAFT — awaiting orchestrator REVIEW + implementor dispatch
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0877_EVENT_END_TIME_DISPLAY_AND_MIDNIGHT_CROSSING.md` — APPROVED 2026-05-18
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0877_EVENT_END_TIME_DISPLAY_AND_MIDNIGHT_CROSSING.md`
**Severity:** S1
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Operator decisions locked:** D1 visual `"Sat 10 PM – Sun 2 AM"` · D2 smart-infer + visible preview · D3 leave-as-is + edit-and-extend · Path B server-side When-edit RPC
**EAS OTA:** ELIGIBLE post-migration (no native modules; mobile bundle ships JS)

---

## 1. Executive summary

ORCH-0877 fixes a structural client-side display flaw + a mobile-only authoring constraint + a server-side persistence gap inherited from ORCH-0704 v2 [Full edit-after-publish]. The database, publish RPC, scanner, and views are already correct — every layer below the model is honest. The fix is:

1. **Widen the canonical client + server formatters** so end-time is renderable on every event display surface across consumer mobile, buyer-anon web, business creator, business web-preview, and email — same-day events render `"Sat · 10 PM – 11 PM"`; cross-midnight events render `"Sat 18 May · 10 PM – Sun 19 May · 2 AM"`.
2. **Widen the client-side model** with a populated `masterEndAtUtc` field (using the ORCH-0850 [End-not-start lifecycle parity] reserved hook) so the display layer carries calendar-day awareness for end-time.
3. **Remove the iOS/Android picker's `minimumDate = doorsOpen + 1min` constraint** and implement smart-infer at the model commit boundary (if `endsAt < doorsOpen`, treat as next-day silently; wizard preview line above the duration MUST show the cross-midnight string the moment smart-infer fires).
4. **Populate `doorsOpenLocal` + `endsAtLocal` in the consumer-app discover edge function** so consumer mobile renders end-time after the fix (today they're explicitly `null`).
5. **Fix the latent Constitution #9 violation** in ticket-confirmation ICS — pass real `endAtIso` instead of `null`-with-3h-fabrication.
6. **Repair `computeMasterEndAtUtc`** to read the new `masterEndAtUtc` field so ORCH-0850 lifecycle math no longer misclassifies cross-midnight events as past 20 hours before they start.
7. **Path B (new):** ship `business_patch_event_when` RPC server-side so operators can correct existing 23:55-workaround events and have buyers see the corrected end-times. Closes the ORCH-0704 v2 Zustand-only gap for When fields. CONSERVATIVE buyer-protection semantics — block whenMode / recurrence / multi-date structural changes when sold > 0; allow time-only edits freely.

After this ships, the wizard's existing `21:00 → 03:00` defaults work as intended end-to-end: operators can author a nightlife event that ends at 2 AM the next morning, buyers see the correct cross-midnight time on every surface, and existing events authored under the `23:55` workaround can be corrected via EditPublishedScreen.

---

## 2. Scope and non-goals

### In scope
- DB: 1 new migration adding `business_patch_event_when(uuid, jsonb, text, integer)` RPC.
- Edge functions: widen `_shared/email/dateLine.ts`, fix `_shared/email/calendar.ts` + `ticketBody.ts` ICS fabrication, widen `_shared/marketingEmailRender.ts` variables, add `endAt` to `ticket-confirmation-dispatch` body input, populate `doorsOpenLocal` + `endsAtLocal` in `discover-merged-events`.
- Shared edge-function helper: new `supabase/functions/_shared/dateTimeSplit.ts` (centralizes the `splitTimestampInTz` logic so client + server agree).
- Client utilities: widen `EventDateLike` + formatter signatures in `eventDateDisplay.ts`, repair `computeMasterEndAtUtc` in `eventDateMath.ts`, add new helper `computeEndsAtUtcWithSmartInfer` in `eventDateMath.ts`.
- Client model: add `masterEndAtUtc` + `masterStartAtUtc` to `LiveEvent` (promote from optional reserved to required at hydration sites); add `endsAtUtc` to `DraftEvent`; Zustand `persistOptions.migrate` for legacy drafts.
- Client services: populate `masterStartAtUtc` + `masterEndAtUtc` from view rows in `publicEventsService.ts` + `businessEvents.ts` mappers; add new `patchPublishedEventWhen` service function.
- Client wizard: remove `minimumDate` constraint at `CreatorStep2When.tsx:352-359`; add smart-infer commit hook; add wizard preview cross-midnight summary line.
- Client edit-published flow: detect When-section patches in `EditPublishedScreen.tsx` and route through new server RPC BEFORE the existing local `updateLiveEventFields` call. Server-success-then-local pattern.
- Consumer mobile: centralize 3 ad-hoc formatters (`formatDateChip`, `formatDateLine`, `formatLocalDate`) into new `app-mobile/src/utils/eventDateDisplay.ts` shared helper that accepts both start + end + timezone. Update all 4 consumer-side render sites.
- Marketing composer: render end-time in `EmailPreviewPane.tsx` event card + `ComposerV2/InsertionBar.tsx` event-chip + `ComposerV2/ComposerV2Editor.tsx`.
- Tests: implementor happy-path covering display + authoring + edit-published-When (3 tests, `fails-on-revert verified`); tester adversarial covering DIFFERENT angles — DST spring-forward, DST fall-back, year-boundary, concurrent-edit-race, persisted Zustand legacy-draft migration, Web HTML5 picker smart-infer, sold>0 reject (6+ tests, `fails-on-revert verified`).

### Out of scope
- Trips (`event_type='trip'`) — separate `trip_days` model. ORCH-0876 v2 territory.
- Ve experiences end-time UX — no end-time concept on that surface.
- Push-notification end-time inclusion — character-budget tight; default OMIT (Q11 below).
- Admin-web event-time renders — investigation confirmed no event-time render sites exist on admin. Operator sanity-checks at REVIEW; no scope additions expected.
- Auto-promotion / mass-edit of existing 23:55-workaround events — operator chose D3.
- Re-emission of already-issued ticket-confirmation emails — historical; fix new emails only.
- Replacing `updateLiveEventFields` — Path B is ADDITIVE; the Zustand mutation + edit log + notification stack stay.
- Server-side persistence for non-When EditPublishedScreen fields (name, description, venueName, tickets, settings) — those remain Zustand-only per ORCH-0704 v2; only the When path gets the server RPC in this ORCH.
- Recurrence/multi-date STRUCTURAL changes with active sales — RPC rejects them per Q-Path-B-Restructure-Scope below; operator can cancel + recreate or wait for tickets to refund.
- Push payload widening — see Q11.
- Server-side audit log for When edits — the audit log remains Zustand-only per ORCH-0704 v2 design. The server RPC writes only `events` + `event_dates`. Client `updateLiveEventFields` runs after server success and continues to write the audit log + notification stack.

### Assumptions
- DB schema unchanged for `event_dates`. CHECK `end_at > start_at` is correct.
- `business_publish_event_draft` RPC unchanged. Its midnight-wrap at `20260604000001_orch_0824_publish_rpc.sql:290-294` is correct and remains the contract that ORCH-0877's new RPC mirrors byte-identically.
- Postgres `AT TIME ZONE` continues to handle DST per documented semantics: spring-forward skips the missing hour; fall-back returns the earlier of the two ambiguous instants.
- ORCH-0850 reserved field `masterEndAtUtc` on `LiveEvent` ([eventDateMath.ts:140-148](mingla-business/src/utils/eventDateMath.ts#L140-L148)) is available for population.
- Buyer-protection guard rails in [publishedEventEditGuards.ts:20-133](mingla-business/src/utils/publishedEventEditGuards.ts#L20-L133) are the canonical client-side contract; server RPC mirrors a CONSERVATIVE subset (allow time-only edits; block whenMode / recurrence / multiDates structural change when sold>0).
- Tester has Maestro + iOS sim + Android emu + web browser available at TEST phase per `feedback_tester_canonical_and_platform_parity.md`.

---

## 3. Cross-Surface Impact (Phase 2.5 mandatory)

| # | Surface | In scope? | User-visible behaviour required | Files touched | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS | YES | Discover grid card, expanded event sheet, calendar row, PDF ticket all render end-time. Cross-midnight shows D1 format. | `app-mobile/src/components/discover/BusinessEventCard.tsx`, `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`, `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx`, `app-mobile/src/components/activity/TicketPdfSheet.tsx`, NEW `app-mobile/src/utils/eventDateDisplay.ts` | automatic with Android via shared RN bundle |
| 2 | Consumer Android | YES | Same as iOS | same files | automatic |
| 3 | Buyer-anon web | YES | `/e/{brandSlug}/{eventSlug}` hero, `/checkout/{eventId}/{index,buyer,payment,confirm}` headers, `/b/{brandSlug}` brand event list, `/o/{orderId}` order header all render end-time. | `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`, `app/checkout/[eventId]/{index,buyer,payment,confirm}.tsx`, `app/b/[brandSlug].tsx`, `app/o/[orderId].tsx`, `src/components/brand/PublicBrandPage.tsx`, `src/components/event/PublicEventPage.tsx` | automatic with business surfaces via shared formatter |
| 4 | Business iOS | YES | Hub event list, event dashboard, wizard Step 2 preview, EditPublishedScreen When accordion summary, marketing composer event-chip preview all render end-time. Authoring picker accepts cross-midnight. Wizard preview line shows D1 format the moment smart-infer activates. Edit-published When-section save persists to DB via new RPC. | `mingla-business/src/components/event/CreatorStep2When.tsx`, `EditPublishedScreen.tsx`, `EventListCard.tsx`, `PreviewEventView.tsx`, `PublicEventPage.tsx`, `CreatorStep7Preview.tsx`, `app/(tabs)/home.tsx`, `app/event/[id]/index.tsx`, `app/event/[id]/reconciliation.tsx`, `src/components/marketing/EmailPreviewPane.tsx`, `src/components/marketing/ComposerV2/{InsertionBar,ComposerV2Editor}.tsx` | automatic with Android |
| 5 | Business Android | YES | Same as iOS | same | automatic |
| 6 | Business web-preview | YES | Same as business iOS — Web HTML5 picker permits any time today (no `minimumDate`); smart-infer fires at model commit; display fix flows automatically via shared RN-Web bundle. | same shared code | automatic |
| 7 | Admin web | NO | Investigation confirmed no event-time render sites in `mingla-admin/`. Operator confirms at REVIEW; if found, register follow-up ORCH. | n/a | n/a |
| 8 | Email — ticket confirmation | YES | Body renders inline `"Sat 18 May · 10 PM – Sun 19 May · 2 AM"`. ICS attachment carries REAL `DTEND` from `event_dates.end_at` (no more 3-hour fabrication). | `supabase/functions/_shared/email/dateLine.ts`, `ticketBody.ts`, `calendar.ts`, `ticket-confirmation-dispatch/index.ts` | n/a (server single render) |
| 9 | Email — marketing blasts | YES | `{ends_at}` token substitutes correctly; `renderEventCard` adds end-time sub-line below date chip. | `supabase/functions/_shared/marketingEmailRender.ts` | n/a |
| 10 | Push notifications | NO (default) | OMIT end-time from push body per Q11. Re-evaluate per template at TEST. | n/a | n/a |
| 11 | Trips | NO | Separate `trip_days` model | n/a | n/a |
| 12 | Ve experiences | NO | No end-time concept | n/a | n/a |

**Parity model:** consumer iOS/Android share `app-mobile/` RN bundle (automatic). Business iOS/Android/web-preview share `mingla-business/` RN/RN-Web bundle (automatic). Buyer-anon web reads `business_public_events_view` and uses the same `formatDraftDateLine` as business surfaces (automatic). Email + marketing render server-side independently of client. **No manual per-platform code paths** — meaning SC-N-iOS, SC-N-Android, SC-N-Web success criteria are formally separate gates for the tester, but the implementor diff is single-source.

---

## 4. Layer specifications

### 4.1 Database — 1 new migration

**File:** `supabase/migrations/<YYYYMMDDHHMMSS>_orch_0877_patch_event_when_rpc.sql` (timestamp at implementor time; numerically AFTER existing `20260612*` migrations).

**Function:** `public.business_patch_event_when(p_event_id uuid, p_when_payload jsonb, p_reason text, p_client_revision integer DEFAULT NULL) RETURNS jsonb`.

**Behaviour:**
- `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path TO 'public', 'pg_temp'`
- Authentication: `auth.uid() IS NULL` → raise `not_authenticated`
- Permission: `biz_brand_effective_rank(v_event.brand_id, v_user_id) < biz_role_rank('event_manager')` → raise `insufficient_event_permission` (mirror taxonomy RPC at [20260604000004_orch_0824_patch_rpc_accept_address.sql:80-83](supabase/migrations/20260604000004_orch_0824_patch_rpc_accept_address.sql#L80-L83))
- Row lock: `SELECT ... FROM public.events WHERE id = p_event_id FOR UPDATE` — prevents concurrent edits + concurrent publish
- Soft-delete guard: `v_event.deleted_at IS NOT NULL` → raise `event_deleted`
- Status guard: `v_event.status NOT IN ('scheduled', 'live')` → raise `event_not_editable_status`
- Reason validation: `length(btrim(p_reason)) < 10 OR length(btrim(p_reason)) > 200` → raise `invalid_edit_reason` (matches client `publishedEventEditGuards.ts:30`). Empty/null reason → raise `missing_edit_reason`.
- whenMode validation: `v_when_mode := COALESCE(NULLIF(p_when_payload->>'whenMode', ''), 'single')`; `IF v_when_mode NOT IN ('single', 'multi_date', 'recurring')` → raise `event_date_required`
- Optional `p_client_revision` parameter for optimistic concurrency — if non-null AND not equal to current `events.client_revision`, raise `stale_client_revision`. If null, skip check.

**Buyer-protection guards (CONSERVATIVE — server-side):**

The RPC computes `v_sold_count` via:
```sql
SELECT count(*) INTO v_sold_count
FROM public.orders
WHERE event_id = p_event_id
  AND payment_status IN ('paid', 'partial_refund')
  AND deleted_at IS NULL;
```

When `v_sold_count > 0`, the RPC enforces the conservative subset:
- whenMode change (e.g., `single` → `recurring`, or `single` → `multi_date`, or vice versa): raise `when_mode_drops_active_date`
- recurrenceRule change in `recurring` mode (any field of the rule changes): raise `recurrence_drops_occurrence`
- multiDates entries REMOVED (length decreases, or any existing `id` no longer present): raise `multi_date_remove_with_sales`
- Date change for `single` mode while sold > 0: raise `multi_date_remove_with_sales` (re-uses code; same buyer-protection class)
- All TIME-ONLY edits (doorsOpen, endsAt, timezone) are ALLOWED regardless of sold count — this is the entire point of Path B.
- Adding new dates to a multiDates list IS allowed (no occurrence dropped).
- Reordering multiDates entries IS allowed.
- Changing per-entry start/end times within multiDates is allowed (time-only).

When `v_sold_count == 0`, all structural changes are allowed (no buyers to protect).

**Atomic rewrite of event_dates:**
```sql
DELETE FROM public.event_dates WHERE event_id = p_event_id;

IF v_when_mode IN ('single', 'recurring') THEN
  v_date_iso := NULLIF(v_when->>'date', '');
  IF v_date_iso IS NULL THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;
  v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
  v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
  v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
  v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
  -- Midnight wrap — IDENTICAL to business_publish_event_draft:290-294
  IF v_end <= v_start THEN
    v_end := v_end + INTERVAL '1 day';
  END IF;
  -- Zero-duration rejection (smart-infer means start==end never wraps; client should
  -- reject in wizard, but server is defensive)
  IF v_end = v_start THEN
    RAISE EXCEPTION 'event_end_must_differ_from_start';
  END IF;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (p_event_id, v_start, v_end, v_timezone, true);

ELSIF v_when_mode = 'multi_date' THEN
  -- Mirror business_publish_event_draft:298-332 multi-date loop
  IF v_multi_dates IS NULL OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_multi_dates) = 0 THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  SELECT min(
    (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone
  )
  INTO v_min_start
  FROM jsonb_array_elements(v_multi_dates) entry
  WHERE NULLIF(entry->>'date', '') IS NOT NULL;

  IF v_min_start IS NULL THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
  LOOP
    v_date_iso := NULLIF(v_date_entry->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    -- Per-entry midnight wrap
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    IF v_end = v_start THEN
      RAISE EXCEPTION 'event_end_must_differ_from_start';
    END IF;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_start, v_end, v_timezone, v_start = v_min_start);
  END LOOP;
END IF;
```

**Update events table:**
```sql
UPDATE public.events
SET timezone = v_timezone, updated_at = v_now
WHERE id = p_event_id AND status IN ('scheduled', 'live') AND deleted_at IS NULL
RETURNING * INTO v_updated;

IF NOT FOUND THEN
  RAISE EXCEPTION 'event_not_editable_race';
END IF;
```

**Return shape:**
```sql
RETURN jsonb_build_object(
  'event', to_jsonb(v_updated),
  'when_mode', v_when_mode,
  'sold_count', v_sold_count,
  'updated_at', v_now
);
```

**Grants:**
```sql
REVOKE ALL ON FUNCTION public.business_patch_event_when(uuid, jsonb, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_patch_event_when(uuid, jsonb, text, integer) TO authenticated;
```

**Function comment:**
```sql
COMMENT ON FUNCTION public.business_patch_event_when(uuid, jsonb, text, integer) IS
  'ORCH-0877 — server-side When-section edits for published events. Closes the ORCH-0704 v2 Zustand-only gap for When fields. Mirrors business_patch_event_taxonomy''s auth + permission + locking pattern. Midnight-wrap logic byte-identical to business_publish_event_draft:290-294 (I-PROPOSED-EVENT-WHEN-RPC-MIRRORS-PUBLISH-MIDNIGHT-WRAP). Conservative buyer-protection: blocks whenMode/recurrence/multi-date structural change when sold>0; allows time-only edits freely.';
```

**Error codes (full map):**
| Error code | Raised when |
|---|---|
| `not_authenticated` | `auth.uid()` is null |
| `event_not_found` | event row doesn't exist |
| `event_deleted` | `events.deleted_at IS NOT NULL` |
| `event_not_editable_status` | `events.status NOT IN ('scheduled', 'live')` |
| `insufficient_event_permission` | caller below event_manager rank for the brand |
| `missing_edit_reason` | `p_reason` null or empty trimmed |
| `invalid_edit_reason` | trimmed length not in [10, 200] |
| `stale_client_revision` | `p_client_revision` non-null but doesn't match current row |
| `event_date_required` | whenMode invalid, or required date missing in payload |
| `event_end_must_differ_from_start` | computed end == computed start (zero-duration) |
| `when_mode_drops_active_date` | whenMode change with sold>0 |
| `recurrence_drops_occurrence` | recurrenceRule change in recurring mode with sold>0 |
| `multi_date_remove_with_sales` | multiDates structural removal (or single-mode date change) with sold>0 |
| `event_not_editable_race` | UPDATE returned zero rows after the FOR UPDATE select (concurrent state change) |

### 4.2 Edge functions

#### 4.2.1 NEW shared helper — `supabase/functions/_shared/dateTimeSplit.ts`

```typescript
// ORCH-0877 — server-side split of a TIMESTAMPTZ into (date, time) in a target IANA timezone.
// Mirrors the client splitTimestampInTz at mingla-business/src/services/publicEventsService.ts:62-85.
// Used by discover-merged-events + any future server-side date-rendering site.

export interface SplitResult {
  date: string | null;  // YYYY-MM-DD in target tz
  time: string | null;  // HH:MM 24h in target tz
}

export function splitTimestampInTz(
  iso: string | null | undefined,
  tz: string | null | undefined,
): SplitResult {
  if (!iso) return { date: null, time: null };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { date: null, time: null };
  const timezone = tz && tz.length > 0 ? tz : "UTC";
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(dt);
    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      time: `${get("hour")}:${get("minute")}`,
    };
  } catch {
    return { date: null, time: null };
  }
}
```

#### 4.2.2 `discover-merged-events/index.ts`

Replace lines 437-438:
```typescript
// BEFORE
doorsOpenLocal: null, // derivable from master_start_at; client formats with timezone
endsAtLocal: null,

// AFTER
doorsOpenLocal: splitTimestampInTz(masterDate?.start_at ?? null, row.timezone).time,
endsAtLocal:   splitTimestampInTz(masterDate?.end_at   ?? null, row.timezone).time,
masterEndAtUtc: masterDate?.end_at ?? null,  // NEW — full UTC for cross-midnight resolution on client
```

Import `splitTimestampInTz` from `../_shared/dateTimeSplit.ts`.

Update the consumer-app schema (`app-mobile/src/types/discover.ts` or equivalent — locate at implementor time) to add `masterEndAtUtc: string | null` to the BusinessEventCard payload.

#### 4.2.3 `_shared/email/dateLine.ts`

```typescript
// ORCH-0877 — widened to accept endAtIso. Renders same-day or cross-midnight format.
// NEVER fabricates end-time (Constitution #9).

export function formatEventDateLine(
  startAtIso: string | null | undefined,
  endAtIso: string | null | undefined,        // NEW
  timezone: string | null | undefined,
): string {
  if (!startAtIso) return "";
  const startDate = new Date(startAtIso);
  if (Number.isNaN(startDate.getTime())) return "";
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";

  const fmtDate = (d: Date): string => new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: tz,
  }).format(d);
  const fmtDay = (d: Date): string => new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: tz,
  }).format(d);
  const fmtTime = (d: Date): string => new Intl.DateTimeFormat("en-GB", {
    hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short",
  }).format(d);

  const startStr = `${fmtDate(startDate)} · ${fmtTime(startDate)}`;

  if (!endAtIso) return startStr;
  const endDate = new Date(endAtIso);
  if (Number.isNaN(endDate.getTime())) return startStr;

  // Calendar-day comparison in target tz
  const startDay = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz,
  }).format(startDate);
  const endDay = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz,
  }).format(endDate);

  if (startDay === endDay) {
    // Same-day: render single date + time range, including tz suffix once
    const endTime = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric", minute: "2-digit", timeZone: tz,
    }).format(endDate);
    return `${fmtDate(startDate)} · ${fmtTime(startDate)} – ${endTime}`;
  }

  // Cross-midnight: render full weekday+day+month on both sides
  return `${fmtDay(startDate)} · ${fmtTime(startDate)} – ${fmtDay(endDate)} · ${fmtTime(endDate)}`;
}
```

Behaviour confirmed: if `endAtIso === null`, render start-only (Constitution #9 strict). Same-day inline range. Cross-midnight with explicit weekday prefix on end.

#### 4.2.4 `_shared/email/calendar.ts` + `ticketBody.ts`

**`calendar.ts`:** remove the 3-hour fabrication default. If `endAtIso` is null OR invalid, render the ICS event WITHOUT `DTEND` (RFC 5545 permits this; Google Calendar treats DTSTART-only as a 0-duration block, Outlook treats as a "to be confirmed" — both acceptable and HONEST). Do NOT fall back to `DURATION:PT3H` or `DTEND := DTSTART + 3h`. Operator confirms; if they prefer a documented default (e.g., 2h), capture as Q-ICS-Default-Duration in §5.

**`ticketBody.ts`** ([line 121-132](supabase/functions/_shared/email/ticketBody.ts#L121-L132)):
- Update `BuildTicketBodyInput.event` type to require `endAt: string | null` (currently likely optional or absent).
- Pass `endAtIso: input.event.endAt` (NOT `null`) to `buildCalendarLinks`.
- Update the `formatEventDateLine(event.startAt, event.timezone)` call at line ~59 to `formatEventDateLine(event.startAt, event.endAt, event.timezone)`.

#### 4.2.5 `ticket-confirmation-dispatch/index.ts`

Currently passes `startAt: masterDate?.start_at ?? null` to the email body. ADD `endAt: masterDate?.end_at ?? null` adjacent.

**COORDINATE:** this file is dirty on branch `Seth` (per git status — likely ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] or buyer-lifecycle in flight). Implementor must rebase carefully and resolve string-template conflicts at the call site. SPEC author at implementor dispatch time confirms current diff.

#### 4.2.6 `_shared/marketingEmailRender.ts`

Three changes:
1. Add `ends_at: string | null` to the `MarketingVariables` interface ([line 37-49](supabase/functions/_shared/marketingEmailRender.ts#L37-L49)).
2. Wire `{ends_at}` substitution alongside the existing `{event_time}` / `{doors_open}` branches around line 99.
3. In `renderEventCard` (around line 199-273), add an end-time sub-line below the existing date-chip OR extend the chip to inline-range. **Recommend separate sub-line** for legibility — date chip stays compact, sub-line below shows `"Ends Sun 2 AM"` or `"Ends 11 PM"` depending on calendar-day equality.

#### 4.2.7 Edge function deploys

Orchestrator owns deploys per `feedback_orchestrator_deploys_edge_functions.md`. Touched functions:
- `discover-merged-events` (direct edit)
- `ticket-confirmation-dispatch` (direct edit)
- Any function importing `_shared/email/*` (cascade redeploy required because `_shared` is bundled into each importer)
- Any function importing the new `_shared/dateTimeSplit.ts` (only `discover-merged-events` in this ORCH)

Verify version bumps via `mcp__supabase__list_edge_functions`. Preserve each function's existing `verify_jwt` setting (e.g., webhooks are typically `verify_jwt: false`).

### 4.3 Client utility — `mingla-business/src/utils/eventDateDisplay.ts`

```typescript
// ORCH-0877 — widen EventDateLike + formatters to carry + render end-time.
// masterEndAtUtc is the preferred source of truth (ORCH-0850 reserved hook now populated).
// endsAt + endsAtUtc remain on the type for back-compat with persisted Zustand drafts.

import type { MultiDateEntry, RecurrenceRule, WhenMode } from "../store/draftEventStore";
import { expandRecurrenceToDates, formatRecurrenceLabel } from "./recurrenceRule";

export interface EventDateLike {
  whenMode: WhenMode;
  date: string | null;
  doorsOpen: string | null;
  endsAt: string | null;
  masterStartAtUtc?: string | null;  // NEW (ORCH-0877; ORCH-0850 hook)
  masterEndAtUtc?: string | null;     // NEW (ORCH-0877; ORCH-0850 hook)
  timezone: string | null;
  recurrenceRule: RecurrenceRule | null;
  multiDates: MultiDateEntry[] | null;
}

/** "Sat 18 May · 10 PM – Sun 19 May · 2 AM" or "Sat 18 May · 10 PM – 11 PM" */
export const formatSingleDateLine = (
  date: string | null,
  doorsOpen: string | null,
  endsAt: string | null,
  endsAtDayOffset: 0 | 1,
  // ... implementation ...
): string => { /* see §4.5 of dispatch + behaviour locked in D1 */ };

export const formatDraftDateLine = (draft: EventDateLike): string => {
  // Branch 1: masterStartAtUtc + masterEndAtUtc both present
  //   → split each in timezone, render via formatSingleDateLine with dayOffset = (endDay - startDay) in tz
  // Branch 2: legacy (only date + doorsOpen + endsAt present)
  //   → apply smart-infer: dayOffset = (endsAt time < doorsOpen time) ? 1 : 0
  //   → render via formatSingleDateLine
  // Branch 3: incomplete (no date)
  //   → "Date TBD"
};

// formatDraftDateSubline + formatDraftDatesList + formatRecurringDatesList + formatMultiDateList all widened similarly.
```

**Per-occurrence rendering for recurring + multi-date:** each occurrence applies smart-infer independently. `formatMultiDateList` rendering each entry as `"Sun 19 May · 9 PM – Mon 20 May · 2 AM"` when the entry crosses midnight. `formatRecurringDatesList` similarly — but recurring uses the PARENT `(doorsOpen, endsAt)` for every occurrence, so the dayOffset is computed once and inherited.

### 4.4 Client utility — `mingla-business/src/utils/eventDateMath.ts`

#### 4.4.1 NEW helper

```typescript
/** Apply smart-infer + compute end-instant UTC.
 *  Returns null if inputs incomplete or tz parsing fails. */
export function computeEndsAtUtcWithSmartInfer(
  date: string | null,
  doorsOpen: string | null,
  endsAt: string | null,
  timezone: string | null,
): string | null {
  if (date === null || endsAt === null) return null;
  const tz = timezone || "UTC";
  const endsTime = /^\d{2}:\d{2}$/.test(endsAt) ? `${endsAt}:00` : endsAt;
  const candidate = localWallClockToUtcInstant(`${date}T${endsTime}`, tz);
  if (candidate === null) return null;

  if (doorsOpen === null) return candidate;
  const doorsTime = /^\d{2}:\d{2}$/.test(doorsOpen) ? `${doorsOpen}:00` : doorsOpen;
  const startInstant = localWallClockToUtcInstant(`${date}T${doorsTime}`, tz);
  if (startInstant === null) return candidate;

  // Smart-infer: if end <= start in UTC terms, wrap to next day
  if (Date.parse(candidate) <= Date.parse(startInstant)) {
    const wrapped = new Date(Date.parse(candidate) + 24 * 60 * 60 * 1000);
    return wrapped.toISOString();
  }
  return candidate;
}
```

#### 4.4.2 Repair `computeMasterEndAtUtc` ([line 159-178](mingla-business/src/utils/eventDateMath.ts#L159-L178))

```typescript
export function computeMasterEndAtUtc(event: LiveEvent): string | null {
  // 1. Persisted server projection — preferred
  const direct = (event as LiveEvent & { masterEndAtUtc?: string | null }).masterEndAtUtc;
  if (typeof direct === "string" && direct.length > 0) return direct;

  // 2. Compute via smart-infer from (date, doorsOpen, endsAt, timezone) when masterEndAtUtc absent
  //    (legacy persisted LiveEvents from pre-ORCH-0877 builds)
  if (event.date === null) return null;
  const inferred = computeEndsAtUtcWithSmartInfer(
    event.date, event.doorsOpen, event.endsAt, event.timezone,
  );
  if (inferred !== null) return inferred;

  // 3. Last-resort fallback (unchanged) — end-of-day in event's tz
  const tz = event.timezone || "UTC";
  return localWallClockToUtcInstant(`${event.date}T23:59:59`, tz);
}
```

This makes `isEventPast()` lifecycle-classify cross-midnight events correctly even for legacy persisted LiveEvents that don't yet carry `masterEndAtUtc`.

### 4.5 Client model — Zustand stores

#### 4.5.1 `liveEventStore.ts`

Add to `LiveEvent` interface (line 144+):
```typescript
masterStartAtUtc: string | null;  // NEW — ORCH-0877; populated by hydration mappers
masterEndAtUtc: string | null;    // NEW — ORCH-0877; populated by hydration mappers (ORCH-0850 reserved hook)
```

Add to `EditableLiveEventFields` (line 72): no change — these are server-projected fields, not directly user-editable. The wizard edits `(date, doorsOpen, endsAt, timezone, whenMode, recurrenceRule, multiDates)` and the server RPC re-derives + persists `event_dates.start_at` + `end_at`. On next refetch, mappers populate the new fields.

Persist migration: bump `persistOptions.version`. Migrator function: on rehydrate of an old-shape `LiveEvent` (no `masterStartAtUtc` / `masterEndAtUtc`), compute via `computeMasterStartAtUtc(legacyEvent)` + `computeMasterEndAtUtc(legacyEvent)` and write. Drafts missing required inputs default to null.

#### 4.5.2 `draftEventStore.ts`

Add `endsAtUtc: string | null` to `DraftEvent` interface (next to existing `endsAt: string | null` at line 256). This is a derived field; on every wizard commit of `endsAt` OR `doorsOpen` OR `date` OR `timezone`, recompute via `computeEndsAtUtcWithSmartInfer` and persist on the draft.

Persist migration: bump `persistOptions.version`. Migrator: on rehydrate of pre-ORCH-0877 draft (no `endsAtUtc`), if `(date, doorsOpen, endsAt, timezone)` all present, compute `endsAtUtc` via smart-infer. If any input missing, set `endsAtUtc: null`.

#### 4.5.3 Hydration mappers

**`publicEventsService.ts` ([line 333-422](mingla-business/src/services/publicEventsService.ts#L333-L422)):**
```typescript
// Add to the returned PublicEventRecord:
masterStartAtUtc: row.master_start_at,
masterEndAtUtc: row.master_end_at,
```
Keep existing `date: startSplit.date`, `doorsOpen: startSplit.time`, `endsAt: endSplit.time` for back-compat — DO NOT remove. They remain the display-friendly local-time projection. The new `masterEndAtUtc` carries calendar-day awareness.

**`businessEvents.ts` ([line 343-395](mingla-business/src/services/businessEvents.ts#L343-L395)):** same change pattern.

**`liveEventConverter.ts` + `liveEventAdapter.ts` + `serverDraftEventMapper.ts`:** propagate the new fields through draft ↔ live conversion. Each adapter touchpoint needs `masterStartAtUtc` / `masterEndAtUtc` plumbed through.

**`draftEventPristine.ts` ([line 13](mingla-business/src/utils/draftEventPristine.ts#L13)):** pristine check accommodates the new `endsAtUtc` field — a draft with `endsAtUtc: null` and `endsAt: null` is still pristine for that pair.

### 4.6 Authoring picker — `CreatorStep2When.tsx`

Three changes.

#### 4.6.1 Remove `minimumDate` constraint ([line 336-361](mingla-business/src/components/event/CreatorStep2When.tsx#L336-L361))

```typescript
// BEFORE
if (pickerMode === "endsAt" && draft.doorsOpen !== null) {
  const min = new Date();
  const parts = draft.doorsOpen.split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  min.setHours(h, m + 1, 0, 0);
  return min;
}

// AFTER — no constraint; smart-infer at model write boundary
// (Remove the entire `if (pickerMode === "endsAt" ...)` branch)
```

#### 4.6.2 Smart-infer + endsAtUtc commit ([line 243-261](mingla-business/src/components/event/CreatorStep2When.tsx#L243-L261))

```typescript
const commitPickerValue = useCallback(
  (mode: PickerMode, d: Date): void => {
    if (mode === "date") {
      const newDate = isoFromDate(d);
      // Recompute endsAtUtc on every date change (smart-infer depends on date)
      const newEndsAtUtc = computeEndsAtUtcWithSmartInfer(
        newDate, draft.doorsOpen, draft.endsAt, draft.timezone,
      );
      updateDraft({ date: newDate, endsAtUtc: newEndsAtUtc });
    } else if (mode === "doorsOpen") {
      const newDoors = hhmmFromDate(d);
      const newEndsAtUtc = computeEndsAtUtcWithSmartInfer(
        draft.date, newDoors, draft.endsAt, draft.timezone,
      );
      updateDraft({ doorsOpen: newDoors, endsAtUtc: newEndsAtUtc });
    } else if (mode === "endsAt") {
      const newEnds = hhmmFromDate(d);
      const newEndsAtUtc = computeEndsAtUtcWithSmartInfer(
        draft.date, draft.doorsOpen, newEnds, draft.timezone,
      );
      updateDraft({ endsAt: newEnds, endsAtUtc: newEndsAtUtc });
    } else if (mode === "untilDate" && draft.recurrenceRule !== null) {
      // ... unchanged ...
    }
  },
  [updateDraft, draft.recurrenceRule, draft.date, draft.doorsOpen, draft.endsAt, draft.timezone],
);
```

Similar updates to multi-date entry commits and timezone commits — recompute `endsAtUtc` whenever any of the four inputs changes.

#### 4.6.3 Wizard preview cross-midnight summary line

Insert ABOVE the existing duration label at [line 363-377](mingla-business/src/components/event/CreatorStep2When.tsx#L363-L377), inside the same parent View:

```typescript
const eventTimeRangeLabel = useMemo<string | null>(() => {
  if (draft.date === null || draft.doorsOpen === null || draft.endsAt === null) {
    return null;
  }
  // Render via the same canonical formatter buyers will see
  return formatSingleDateLine(
    draft.date, draft.doorsOpen, draft.endsAt,
    isEndsAtNextDay(draft.doorsOpen, draft.endsAt),
    draft.timezone,
  );
}, [draft.date, draft.doorsOpen, draft.endsAt, draft.timezone]);

// In JSX (above duration row):
{eventTimeRangeLabel !== null ? (
  <Text style={styles.eventTimeRangeLabel}>{eventTimeRangeLabel}</Text>
) : null}
```

The moment smart-infer fires (endsAt time < doorsOpen time), this label flips from `"Sat 18 May · 9 PM – 11 PM"` to `"Sat 18 May · 9 PM – Sun 19 May · 2 AM"` — operator visually confirms the wrap before publish.

**Same component is mounted by EditPublishedScreen** ([line 855](mingla-business/src/components/event/EditPublishedScreen.tsx#L855)), so all three changes flow automatically to the edit-published-When path.

### 4.7 EditPublishedScreen — Path B wire-up

At [EditPublishedScreen.tsx:782-801](mingla-business/src/components/event/EditPublishedScreen.tsx#L782-L801), add a new branch BEFORE the existing `updateLiveEventFields` call:

```typescript
const WHEN_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "whenMode", "date", "doorsOpen", "endsAt", "timezone",
  "recurrenceRule", "multiDates",
]);
const patchKeys = Object.keys(patch) as (keyof EditableLiveEventFields)[];
const isWhenPatch = patchKeys.some(k => WHEN_PATCH_KEYS.has(k));

if (isWhenPatch && liveEvent.serverEventId !== null) {
  try {
    await patchPublishedEventWhen({
      eventId: liveEvent.serverEventId,
      whenPayload: buildWhenPayload(patch, liveEvent),  // helper below
      reason: validation.trimmedReason,
      clientRevision: liveEvent.clientRevision ?? null,
    });
    invalidateServerEventCaches();
  } catch (error) {
    setSubmitting(false);
    setModal((prev) => ({ ...prev, visible: false }));
    const code = error instanceof Error ? error.message : "patch_failed";
    const message = mapWhenPatchErrorToCopy(code);  // see error map below
    showToast(message);
    return;
  }
}

// Then the existing local Zustand mutation (preserves edit-log + notification stack)
const result = updateLiveEventFields(
  liveEvent.id, patch, soldCountCtx, validation.trimmedReason,
);
// ... rest unchanged ...
```

**Helper `buildWhenPayload`:**
```typescript
function buildWhenPayload(patch: Partial<EditableLiveEventFields>, liveEvent: LiveEvent) {
  return {
    whenMode: patch.whenMode ?? liveEvent.whenMode,
    timezone: patch.timezone ?? liveEvent.timezone,
    when: {
      date: patch.date ?? liveEvent.date,
      doorsOpen: patch.doorsOpen ?? liveEvent.doorsOpen,
      endsAt: patch.endsAt ?? liveEvent.endsAt,
    },
    multiDates: patch.multiDates ?? liveEvent.multiDates,
    recurrenceRule: patch.recurrenceRule ?? liveEvent.recurrenceRule,
  };
}
```

**Helper `mapWhenPatchErrorToCopy`:**
```typescript
function mapWhenPatchErrorToCopy(code: string): string {
  switch (code) {
    case "missing_edit_reason":
    case "invalid_edit_reason":
      return "Add a brief reason (10–200 characters) for this change.";
    case "insufficient_event_permission":
      return "You don't have permission to edit this event.";
    case "event_not_editable_status":
      return "This event can't be edited — it may be ended or cancelled.";
    case "event_deleted":
      return "This event was deleted.";
    case "event_date_required":
      return "Set the event date before saving.";
    case "event_end_must_differ_from_start":
      return "End time must differ from start time.";
    case "when_mode_drops_active_date":
    case "recurrence_drops_occurrence":
    case "multi_date_remove_with_sales":
      return "This change would drop a date with active tickets. Cancel or refund those tickets first.";
    case "stale_client_revision":
    case "event_not_editable_race":
      return "Someone else updated this event. Tap to reload.";
    default:
      return "Couldn't save your changes. Tap to try again.";
  }
}
```

**Hard guard:** the server RPC runs BEFORE `updateLiveEventFields`. If the RPC fails, no local Zustand mutation occurs and the screen stays open with the toast. If RPC succeeds but `updateLiveEventFields` rejects (client-side guard disagrees with server) — this would be an architectural inconsistency we should never see, but if it does, trust the server (RPC already enforced its guards) and SUPPRESS the local rejection (log a `console.warn` but proceed with the local apply for edit-log purposes). SPEC author chose option (a) per dispatch §4.7.

### 4.8 Client service — `mingla-business/src/services/businessEvents.ts`

Add `patchPublishedEventWhen` mirroring `patchPublishedEventTaxonomy` at [line 697](mingla-business/src/services/businessEvents.ts#L697):

```typescript
/**
 * ORCH-0877 — patch the When section (date/time/timezone/whenMode/recurrence/multiDates)
 * of a PUBLISHED event. Calls business_patch_event_when RPC.
 * Conservative buyer-protection: server rejects structural changes when sold>0.
 * Time-only edits (doorsOpen/endsAt/timezone) succeed regardless of sold count.
 */
export const patchPublishedEventWhen = async (input: {
  eventId: string;
  whenPayload: {
    whenMode: WhenMode;
    timezone: string;
    when: { date: string | null; doorsOpen: string | null; endsAt: string | null };
    multiDates: MultiDateEntry[] | null;
    recurrenceRule: RecurrenceRule | null;
  };
  reason: string;
  clientRevision: number | null;
}): Promise<void> => {
  const { error } = await supabase.rpc("business_patch_event_when", {
    p_event_id: input.eventId,
    p_when_payload: input.whenPayload,
    p_reason: input.reason,
    p_client_revision: input.clientRevision,
  });
  if (error !== null) {
    const code = error.message ?? "patch_event_when_failed";
    throw new Error(code);
  }
};
```

### 4.9 Consumer-mobile centralization — new shared formatter

NEW file `app-mobile/src/utils/eventDateDisplay.ts` — mirrors mingla-business shape but consumes the consumer schema (`{masterDateUtc, masterEndAtUtc, doorsOpenLocal, endsAtLocal, timezone}`):

```typescript
// ORCH-0877 — centralized consumer-app date-line formatter.
// Replaces 3 ad-hoc formatters: BusinessEventCard.formatDateChip,
// ExpandedBusinessEventSheet.formatDateLine, BusinessEventCalendarRow.formatLocalDate.
// I-14 single-source pattern (mirror mingla-business/src/utils/eventDateDisplay.ts).

export interface ConsumerEventTimeFields {
  masterDateUtc: string | null;     // start
  masterEndAtUtc: string | null;     // end (NEW from discover-merged-events)
  timezone: string;
}

/** "Mon 12 May 2026 · 3:45pm" (start only, when no end) */
export function formatStartOnly(fields: ConsumerEventTimeFields): string;

/** "Mon 12 May 2026 · 3:45pm – 11:00pm UTC" (same-day) or
 *  "Mon 12 May · 9:00pm – Tue 13 May · 2:00am UTC" (cross-midnight). */
export function formatDateLineWithEnd(fields: ConsumerEventTimeFields): string;

/** Compact chip — "Mon 12 May" (no time). */
export function formatDateChip(fields: ConsumerEventTimeFields): string;

/** Compact local — "Mon 12 May · 21:00 → 02:00" (compact time-only range; for activity row) */
export function formatLocalRange(fields: ConsumerEventTimeFields): string;
```

Then update each of the 4 render sites:
- `BusinessEventCard.tsx` (grid card) → `formatDateChip` (start-only OK for compact grid; no end-time)
- `ExpandedBusinessEventSheet.tsx` → `formatDateLineWithEnd` (full sheet has room)
- `BusinessEventCalendarRow.tsx` → `formatLocalRange` (calendar row needs compact range)
- `TicketPdfSheet.tsx` → `formatDateLineWithEnd` (PDF has room)

### 4.10 Marketing composer — `EmailPreviewPane.tsx` + `ComposerV2/InsertionBar.tsx` + `ComposerV2/ComposerV2Editor.tsx`

For each event-chip render site:
- Extend the event payload type with `ends_at_label: string | null` (mirror `date_label`)
- Render `ends_at_label` as a secondary sub-line below the date chip when non-null
- Update the chip-payload-builder to compute `ends_at_label` from event data (using the same formatter as the canonical `formatDraftDateLine`)

---

## 5. Open SPEC questions (proposed defaults locked unless operator overrides at REVIEW)

| Q | Question | Proposed default |
|---|---|---|
| **Q1-S** | Same-day display format | `"Sat 18 May · 10 PM – 11 PM"` — date prefix once, time range with en-dash. Year omitted on same-day, included on cross-midnight (`"Sat 18 May 2026 · ..."` only on the start side, end side drops year for compactness). |
| **Q3-NULL** | Render when `masterEndAtUtc === null` | Start-only. No fabrication. Constitution #9. |
| **Q5-SAME** | Same start = end (zero-duration) | RPC rejects with `event_end_must_differ_from_start`. Wizard shows soft validation error before publish. |
| **Q11** | Push notification end-time inclusion | OMIT. Push body has tight character budget; include start-time only. Re-evaluate per template at TEST if budget allows. |
| **Q12** | Recurring + DST mid-series rendering | Each occurrence computes its own UTC instants from `(date, doorsOpen, endsAt, timezone)` via `expandRecurrenceToDates` + per-occurrence smart-infer. NOT derived from a single master `masterEndAtUtc`. JSDoc `eventDateMath.ts` documents this. |
| **Q-LegacyDraftMigration** | Zustand draft migration shape | `persistOptions.migrate` with version bump. On rehydrate, if `endsAtUtc === undefined` AND `(date, doorsOpen, endsAt, timezone)` all non-null, compute `endsAtUtc` via smart-infer. Else `endsAtUtc: null`. No data loss; legacy drafts continue to function with `endsAtUtc: null` until operator re-edits the When step. |
| **Q-MobileFormatterCentralization** | Centralize app-mobile formatters | YES. Build `app-mobile/src/utils/eventDateDisplay.ts` and replace all 4 ad-hoc helpers. Smaller diff long-term; matches I-14 invariant. |
| **Q-ICS-Default-Duration** | ICS DTEND when `endAtIso === null` | Render WITHOUT `DTEND` (RFC 5545 permits this). Do NOT fabricate `DURATION:PT3H`. If operator prefers a documented default duration for ICS-only fallback, capture and override here at REVIEW. |
| **Q-Path-B-Restructure-Scope** | New RPC behaviour on whenMode/recurrence/multi-date STRUCTURAL changes with sold>0 | CONSERVATIVE — reject with the existing `when_mode_drops_active_date` / `recurrence_drops_occurrence` / `multi_date_remove_with_sales` error codes. Time-only edits (doorsOpen/endsAt/timezone) ALWAYS succeed regardless of sold count. Operators who need restructure with active sales must cancel + recreate (existing flow). Defers a future ORCH that ports `computeDroppedDates` server-side. |
| **Q-Server-Edit-Log** | Does the new RPC write a server-side edit audit row? | NO. Edit log remains Zustand-only per ORCH-0704 v2 design. Client `updateLiveEventFields` runs after server success and continues to write the audit log + notification stack. |

---

## 6. Success criteria

### Display layer (all platforms in scope)
- **SC-01-iOS:** Open the iOS consumer app, view a published event whose `event_dates` has `start_at != end_at` on the same calendar day → expanded event sheet renders `"Sat 18 May · 10 PM – 11 PM"`.
- **SC-01-Android:** Same on Android emu.
- **SC-01-Web:** Same on buyer-anon web `/e/{brandSlug}/{eventSlug}`.
- **SC-02-iOS:** Open a cross-midnight event on iOS consumer expanded sheet → renders `"Sat 18 May · 10 PM – Sun 19 May · 2 AM"`.
- **SC-02-Android / SC-02-Web:** Same on respective platforms.
- **SC-03:** Buyer-anon `/checkout/{eventId}/{index,buyer,payment,confirm}` header renders end-time at every step.
- **SC-04:** Consumer mobile discover grid card renders `formatDateChip` (start-only OK — compact grid). Expanded sheet, calendar row, PDF ticket render end-time.
- **SC-05:** Business hub event list + event dashboard + EditPublishedScreen When summary + marketing composer event-chip preview all render end-time.
- **SC-06:** Brand profile (`/b/{brandSlug}`) event list + order page (`/o/{orderId}`) render end-time.

### Email + ICS
- **SC-07:** Ticket-confirmation email body renders `formatEventDateLine(startAt, endAt, timezone)` with cross-midnight format when applicable.
- **SC-08:** Ticket-confirmation ICS attachment carries `DTEND` matching `event_dates.end_at`. Closes Constitution #9 violation.
- **SC-09:** When `endAt === null`, email body renders start-only and ICS omits `DTEND`. No fabrication.
- **SC-10:** Marketing blast `{ends_at}` token substitutes correctly. Event-card render shows end-time sub-line.

### Authoring layer
- **SC-11-iOS:** On iOS sim business app, navigate to event wizard Step 2, set doorsOpen=22:00, attempt endsAt=02:00 — picker ACCEPTS (no minimumDate refusal). Wizard preview line above duration shows `"<today's date> · 10 PM – <next day> · 2 AM"`. Duration label shows `"4h event"`.
- **SC-11-Android:** Same on Android emu.
- **SC-11-Web:** Same on business web-preview (HTML5 picker accepts; smart-infer fires on commit).
- **SC-12:** Publishing a draft with doorsOpen=22:00 + endsAt=02:00 writes to `event_dates` with `end_at` = next-day 02:00 in correct timezone. Verify via Management API SQL probe.
- **SC-13:** Setting doorsOpen=22:00 + endsAt=22:00 (same time) shows wizard soft error and `business_publish_event_draft` rejects on submit. Likewise `business_patch_event_when` rejects.

### Edit-published Path B
- **SC-14:** Open an existing event (status=`scheduled` or `live`) with `event_dates.end_at` at `23:55` same calendar day as start. In EditPublishedScreen, change endsAt to `02:00`, enter reason of length 10-200, save. Server RPC `business_patch_event_when` succeeds. `event_dates.end_at` in DB updates to next-day 02:00. Buyer reload of `/e/{brandSlug}/{eventSlug}` shows the corrected time.
- **SC-15:** Same edit attempted on a `cancelled` or `ended` event → `event_not_editable_status` toast.
- **SC-16:** Same edit attempted by a non-event-manager+ caller → `insufficient_event_permission` toast.
- **SC-17:** Edit with `reason: ""` → `missing_edit_reason` toast. Edit with reason length 5 or 250 → `invalid_edit_reason`.
- **SC-18:** Edit that attempts whenMode change when sold > 0 → `when_mode_drops_active_date` toast.
- **SC-19:** Edit that attempts recurrenceRule structural change when sold > 0 → `recurrence_drops_occurrence` toast.
- **SC-20:** Edit that attempts multiDates entry removal when sold > 0 → `multi_date_remove_with_sales` toast.
- **SC-21:** Edit that changes ONLY endsAt (no structural change) when sold > 0 → SUCCEEDS. This is the entire point of Path B.

### Lifecycle math
- **SC-22:** `computeMasterEndAtUtc` returns the persisted `event.masterEndAtUtc` when present.
- **SC-23:** `computeMasterEndAtUtc` for a legacy LiveEvent (no `masterEndAtUtc`) with cross-midnight times computes the correct UTC instant via smart-infer.
- **SC-24:** `isEventPast()` for a cross-midnight event no longer returns `true` 20h before start. Regression test verifies.

### Edge cases
- **SC-25:** DST spring-forward — event from 11pm Sat → 2:30am Sun in `America/New_York` on Mar second Sunday. Postgres `AT TIME ZONE` produces correct UTC instant (2:30 EDT post-skip).
- **SC-26:** DST fall-back — event from 11pm Sat → 2:00am Sun in `America/New_York` on Nov first Sunday. Postgres returns the EARLIER ambiguous instant. Verify scanner window remains sensible.
- **SC-27:** Year boundary — event from Dec 31 11pm → Jan 1 1am. Smart-infer + INTERVAL '1 day' correctly rolls year.
- **SC-28:** Zustand legacy-draft migration — persisted draft with old shape (no `endsAtUtc`) rehydrates cleanly with computed `endsAtUtc` when inputs present; defaults to null otherwise.

---

## 7. Invariants

### Preserved
| ID | Source | Why preserved |
|---|---|---|
| `event_dates_end_after_start` CHECK | `20260505000000_baseline_squash_orch_0729.sql:8221` | Unchanged; ORCH-0877 doesn't touch schema |
| ORCH-0792 [matview promote] I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY | Spec | Strengthened — server is now authoritative for When edits via the new RPC, not just publish |
| ORCH-0793 [Biz ticket scan time window] scan window `[start - 120min, end + 360min]` | `20260528000000_orch_0793_scan_time_window.sql` | Unchanged; new RPC writes correct `end_at` |
| ORCH-0824 [publish RPC] midnight wrap `IF v_end <= v_start THEN v_end := v_end + INTERVAL '1 day'` | `20260604000001_orch_0824_publish_rpc.sql:292-294` | New RPC mirrors byte-identically |
| ORCH-0850 [End-not-start parity systemic] I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER | Spec | Unchanged; `computeMasterEndAtUtc` is repaired, not replaced |
| ORCH-0704 v2 [Full edit-after-publish] client-side edit-log + notification stack | Spec | Path B is additive; `updateLiveEventFields` continues to write log + fire notifications |
| Constitution #1, #2, #3, #9, #12 | Constitution | No dead taps, one owner per truth, no silent failures, no fabricated data, validate at right time — all preserved |
| `feedback_anon_buyer_routes.md` | Memory | Buyer-anon routes untouched-auth — unchanged |
| `feedback_zustand_persist_no_server_snapshots.md` | Memory | `endsAtUtc` on draft is a value, not a server record |

### NEW DRAFT (status `DRAFT — flips to ACTIVE on ORCH-0877 CLOSE`)
| ID | Description | Enforced by |
|---|---|---|
| **I-PROPOSED-EVENT-END-AT-RENDERED-EVERYWHERE** | Every event display surface that renders `start` MUST also render `end` when `event.masterEndAtUtc` is non-null. | Tester adversarial enumeration + strict-grep gate (find `formatDraftDateLine` callers without verifying end-time path) |
| **I-PROPOSED-EVENT-AUTHORING-SUPPORTS-CROSS-MIDNIGHT** | Wizard time picker accepts any HH:MM for endsAt; smart-infer applies at model commit boundary; wizard preview line renders the cross-midnight string the moment smart-infer fires. | Implementor source-pattern test on `CreatorStep2When.tsx` (no `minimumDate` constraint on endsAt picker) |
| **I-PROPOSED-EVENT-END-AT-FORMATTER-CENTRALIZED** | Event time rendering routes through `formatSingleDateLine` (client) or `formatEventDateLine` (server email) — no per-site ad-hoc time formatting. | Implementor source-pattern test: grep for `format(.*start.*Date)` / `toLocaleString` / inline time formatting outside the canonical helpers |
| **I-PROPOSED-EVENT-WHEN-EDIT-PERSISTS-TO-DB** | Every When-section edit on a published event MUST write to `event_dates` via `business_patch_event_when` RPC and become visible to buyers. Replaces ORCH-0704 v2 line-1303 Zustand-only stance for When fields. | Implementor wire-up test: EditPublishedScreen When patch calls RPC before `updateLiveEventFields`; tester adversarial: edit endsAt, refetch buyer view, verify new time |
| **I-PROPOSED-EVENT-END-TIME-NOT-FABRICATED** | Never fabricate an end-time when source is null. Calendar ICS, email body, push body, marketing variables all render-without-end when source is null. | Implementor + tester: grep for `?? 3` / `+ 3h` / `DURATION:PT3H` patterns; assert removed |
| **I-PROPOSED-EVENT-WHEN-RPC-MIRRORS-PUBLISH-MIDNIGHT-WRAP** | The new RPC's midnight-wrap MUST be byte-identical (logic-equivalent) to the publish RPC's wrap. Future changes to one MUST be reflected in the other. | Strict-grep CI gate: both functions contain the same `IF v_end <= v_start THEN v_end := v_end + INTERVAL '1 day'` pattern |

---

## 8. Test cases (mapped to success criteria)

### Implementor happy-path regression tests (mandatory per Step 0.5)

| Test | Scenario | Layer | SC link | Path |
|---|---|---|---|---|
| T-IMPL-01 | Single event, same-day, formatter renders inline range | Client util | SC-01 | `mingla-business/src/utils/__tests__/eventDateDisplay_cross_midnight.test.ts` |
| T-IMPL-02 | Single event, cross-midnight, formatter renders weekday-prefix on both | Client util | SC-02 | same file |
| T-IMPL-03 | CreatorStep2When picker accepts endsAt < doorsOpen on iOS+Android+Web (mock platform) | Component | SC-11 | `mingla-business/src/components/event/__tests__/CreatorStep2When_smart_infer.test.tsx` |
| T-IMPL-04 | Publish flow writes event_dates with cross-midnight end_at (jest + mock supabase) | Service | SC-12 | `mingla-business/src/services/__tests__/businessEventsPublish_cross_midnight.test.ts` |
| T-IMPL-05 | patchPublishedEventWhen calls RPC + handles each error code | Service | SC-14-21 | `mingla-business/src/services/__tests__/patchPublishedEventWhen.test.ts` |
| T-IMPL-06 | EditPublishedScreen When patch routes through server RPC before local mutation | Component | SC-14 | `mingla-business/src/components/event/__tests__/EditPublishedScreen_when_patch.test.tsx` |
| T-IMPL-07 | computeMasterEndAtUtc returns persisted field; falls back to smart-infer for legacy | Util | SC-22, SC-23 | `mingla-business/src/utils/__tests__/eventDateMath_smart_infer.test.ts` |
| T-IMPL-08 | Email formatEventDateLine renders same-day + cross-midnight + null-end correctly | Edge | SC-07, SC-09 | `supabase/functions/_shared/email/__tests__/dateLine.test.ts` |
| T-IMPL-09 | buildCalendarLinks with real endAtIso writes DTEND; with null endAtIso omits DTEND | Edge | SC-08, SC-09 | `supabase/functions/_shared/email/__tests__/calendar.test.ts` |
| T-IMPL-10 | discover-merged-events populates doorsOpenLocal + endsAtLocal + masterEndAtUtc | Edge | SC-04 | `supabase/functions/discover-merged-events/__tests__/end_time.test.ts` |

Each test MUST include a `fails-on-revert verified at <commit hash>` line. The test must FAIL when the relevant code change is reverted.

### Tester adversarial regression tests (mandatory per Step 0.5)

| Test | Adversarial angle | Layer | SC link | Path |
|---|---|---|---|---|
| T-ADV-01 | DST spring-forward — event 11pm Sat → 2:30am Sun in America/New_York on Mar second Sunday. Verify UTC instant correct post-skip. | DB + util | SC-25 | `mingla-business/src/utils/__tests__/eventDateMath_dst.adversarial.test.ts` |
| T-ADV-02 | DST fall-back — event 11pm Sat → 2:00am Sun in America/New_York on Nov first Sunday. Verify earlier ambiguous instant returned. | DB + util | SC-26 | same file |
| T-ADV-03 | Year boundary — Dec 31 23:30 → Jan 1 01:30. Verify rollover. | DB + util | SC-27 | same file |
| T-ADV-04 | Concurrent buyer purchase mid-edit — operator opens EditPublishedScreen, before save another browser publishes a refund (sold count changes). Verify RPC's FOR UPDATE lock + race detection (`event_not_editable_race`). | RPC | SC-14, race | `mingla-business/src/services/__tests__/patchPublishedEventWhen.adversarial.test.ts` |
| T-ADV-05 | Zustand legacy-draft migration — load a pre-ORCH-0877 persisted draft (no `endsAtUtc`), verify migrator computes correctly OR defaults to null gracefully. | Store | SC-28 | `mingla-business/src/store/__tests__/draftEventStore_migration.adversarial.test.ts` |
| T-ADV-06 | Web HTML5 picker smart-infer — Web user picks endsAt=02:00, doorsOpen=22:00 (already permitted today). Verify smart-infer fires at commit, endsAtUtc set to next day. | Component | SC-11-Web | `mingla-business/src/components/event/__tests__/CreatorStep2When_web_picker.adversarial.test.tsx` |
| T-ADV-07 | sold>0 reject — event has 1 paid order, operator attempts whenMode change. RPC rejects with `when_mode_drops_active_date`. Time-only endsAt edit succeeds. | RPC | SC-18, SC-21 | `mingla-business/src/services/__tests__/patchPublishedEventWhen.adversarial.test.ts` |

Each adversarial test MUST attack a different angle than the implementor's happy-path test — NOT a copy-with-renamed-`it()`-block. Each MUST include `fails-on-revert verified at <commit hash>`.

---

## 9. Implementation order

Numbered sequence for implementor. Database first, then edge functions, then client.

1. **DB:** write the new RPC migration `<YYYYMMDDHHMMSS>_orch_0877_patch_event_when_rpc.sql` per §4.1. Run `supabase db lint` locally. Operator applies via `supabase db push --linked`.
2. **Edge shared helper:** create `supabase/functions/_shared/dateTimeSplit.ts` per §4.2.1.
3. **Edge `_shared/email/dateLine.ts`:** widen signature + add cross-midnight branch per §4.2.3.
4. **Edge `_shared/email/calendar.ts` + `ticketBody.ts`:** remove 3-hour fabrication; pass real `endAtIso` per §4.2.4.
5. **Edge `_shared/marketingEmailRender.ts`:** add `{ends_at}` variable + event-card end-time render per §4.2.6.
6. **Edge `ticket-confirmation-dispatch/index.ts`:** add `endAt` to email body input per §4.2.5. COORDINATE with whoever is editing this file (dirty on `Seth`) — rebase carefully.
7. **Edge `discover-merged-events/index.ts`:** populate `doorsOpenLocal` + `endsAtLocal` + `masterEndAtUtc` per §4.2.2.
8. **Edge function deploys:** orchestrator deploys touched functions via local CLI per `feedback_orchestrator_deploys_edge_functions.md`. Verify version bumps via `mcp__supabase__list_edge_functions`.
9. **Client utility `eventDateDisplay.ts`:** widen formatters per §4.3.
10. **Client utility `eventDateMath.ts`:** add `computeEndsAtUtcWithSmartInfer` + repair `computeMasterEndAtUtc` per §4.4.
11. **Client model:** add `masterEndAtUtc` / `masterStartAtUtc` to `LiveEvent` per §4.5.1, `endsAtUtc` to `DraftEvent` per §4.5.2, with Zustand persist migrators.
12. **Client mappers:** populate new fields in `publicEventsService.ts`, `businessEvents.ts`, `liveEventConverter.ts`, `liveEventAdapter.ts`, `serverDraftEventMapper.ts`, `draftEventPristine.ts` per §4.5.3.
13. **Client wizard `CreatorStep2When.tsx`:** remove `minimumDate` constraint, add smart-infer commit, add wizard preview cross-midnight summary per §4.6.
14. **Client service `businessEvents.ts`:** add `patchPublishedEventWhen` per §4.8.
15. **Client EditPublishedScreen wire-up:** route When patches through server RPC per §4.7.
16. **Consumer-mobile centralization:** new `app-mobile/src/utils/eventDateDisplay.ts` per §4.9; update 4 consumer render sites.
17. **Marketing composer chips:** update `EmailPreviewPane.tsx` + `ComposerV2/InsertionBar.tsx` + `ComposerV2/ComposerV2Editor.tsx` per §4.10.
18. **Implementor regression tests** (10 tests per §8).
19. **TypeScript + jest pass locally;** `tsc --noEmit` clean across both apps.
20. **Implementation report** to `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0877_*.md` with `fails-on-revert` hash receipts for each happy-path test.

---

## 10. Hard guards (the implementor MUST NOT violate)

1. Do NOT touch `event_dates` schema. The CHECK is correct.
2. Do NOT modify `business_publish_event_draft` — its midnight-wrap stays the contract the new RPC mirrors.
3. Do NOT touch `computeMasterStartAtUtc` — only `computeMasterEndAtUtc` is repaired.
4. Do NOT regress ORCH-0704 v2 client-side edit-log + notification stack — Path B is ADDITIVE; `updateLiveEventFields` runs AFTER server RPC success.
5. Do NOT expose the new RPC to anon. `GRANT EXECUTE ... TO authenticated` only.
6. Do NOT fabricate end-time when source is null. Constitution #9 strict.
7. Do NOT touch trip surfaces. `event_type='trip'` out of scope.
8. Do NOT add a confirmation modal at the picker for smart-infer. Operator chose silent smart-infer + visible preview summary.
9. Do NOT bypass the new RPC's reason-required guard. `missing_edit_reason` / `invalid_edit_reason` MUST throw if reason outside [10, 200] chars trimmed.
10. Do NOT use `mcp__supabase__apply_migration`. Operator owns `supabase db push --linked`.
11. Do NOT touch files dirty on `Seth` (`buyerLifecycleAdapters.ts`, `process-scheduled-installments/index.ts`) unless step 6 requires it. Coordinate at commit time.
12. Do NOT skip the `fails-on-revert` proof on any happy-path regression test.
13. Do NOT widen the new RPC's permission model beyond `event_manager+`. No service-role bypass, no public exposure.
14. Do NOT add a server-side audit log to the new RPC (audit log remains Zustand-only per Q-Server-Edit-Log).
15. Do NOT change the orders.payment_status enum or buyer-protection thresholds. Use existing `('paid', 'partial_refund')` semantics.

---

## 11. Regression prevention

| Class of regression | Structural safeguard | Test that catches it |
|---|---|---|
| Future formatter sites that drop end-time | I-PROPOSED-EVENT-END-AT-RENDERED-EVERYWHERE + I-PROPOSED-EVENT-END-AT-FORMATTER-CENTRALIZED enforced via implementor source-pattern test (grep that every `formatDraftDateLine` caller passes a full `EventDateLike` including `masterEndAtUtc`) | T-IMPL-01, T-IMPL-02 + adversarial enumeration |
| Drift between new RPC and publish RPC midnight-wrap | I-PROPOSED-EVENT-WHEN-RPC-MIRRORS-PUBLISH-MIDNIGHT-WRAP enforced via strict-grep CI gate finding both functions and asserting their midnight-wrap blocks contain identical SQL | New strict-grep gate (implementor adds) |
| Reintroduction of `minimumDate` constraint on endsAt picker | Source-pattern test on `CreatorStep2When.tsx` that asserts no `minimumDate` is computed for `pickerMode === "endsAt"` | T-IMPL-03 |
| Reintroduction of ICS 3-hour fabrication | Source-pattern test on `_shared/email/calendar.ts` asserting no `PT3H` / `+ 3 * 60 * 60 * 1000` / `addHours(3)` patterns | T-IMPL-09 |
| Future When-edit paths that bypass server RPC | I-PROPOSED-EVENT-WHEN-EDIT-PERSISTS-TO-DB enforced via source-pattern test on `EditPublishedScreen.tsx` asserting WHEN_PATCH_KEYS branch calls `patchPublishedEventWhen` | T-IMPL-06 |
| Server RPC silently allowing whenMode/recurrence/multi-date change with sold>0 | Buyer-protection adversarial tests T-ADV-07 + server-side jest with mocked Supabase | T-ADV-07 |
| Lifecycle math silently misclassifying cross-midnight events | T-IMPL-07 + the existing `isEventPast` test suite + T-ADV-01/T-ADV-02 DST tests | Multiple |
| Persisted Zustand legacy drafts breaking on rehydrate | Persist version bump + migrator + T-ADV-05 | T-ADV-05 |

---

## 12. Layman summary

- **What's broken now (briefly).** Every Mingla event shows only the start time. End time exists in the database but the code that turns event data into screen text literally has no slot for end. Same flaw on emails. On top of that, the mobile event creator's time picker refuses to let you pick 2 AM if doors open at 10 PM. And — bonus — every ticket-confirmation email you've ever sent has been attaching a calendar block with a made-up "ends 3 hours later" duration, no matter the real event length.
- **What this SPEC fixes.** (1) The single formatter that 18+ screens call gets an `end` parameter, and end-time renders everywhere. (2) The mobile picker drops its hidden "must be after start" rule. (3) When you set end < start, the system silently assumes you meant next-morning (smart-infer) and the wizard preview line ABOVE the duration shows you `"Sat 18 May · 10 PM – Sun 19 May · 2 AM"` so you can confirm before publishing. (4) The ICS calendar attachment stops faking durations. (5) The lifecycle code that decides "is this event past?" stops misclassifying cross-midnight events as already-ended. (6) **New for Path B:** operators can now edit endsAt on already-published events (e.g. correct the 23:55 workaround to 02:00) and have buyers see the corrected time — this used to silently update only the operator's local device.
- **Visual format for cross-midnight events.** `"Sat 18 May · 10 PM – Sun 19 May · 2 AM"`. Both weekdays, both dates. Same-day events stay shorter: `"Sat 18 May · 10 PM – 11 PM"`.
- **Authoring shape (mobile + web).** Smart-infer. The picker accepts any HH:MM. If end-time < start-time, the system assumes next-morning silently. Wizard preview line confirms visually. No confirmation modal — operator explicitly chose silent + visible preview.
- **What we changed about your "leave existing events alone" plan.** Your original instinct was right — leave them in the DB as-is. But to make "edit and extend afterward" actually work for buyers, we have to ship Path B: a new server-side RPC `business_patch_event_when` that mirrors the existing taxonomy-patch RPC. Without Path B, your edit-to-correct would silently no-op for buyers (the ORCH-0704 v2 design was Zustand-only for When fields). With Path B, the edit writes to the database and buyers see the corrected time.
- **What stays unchanged.** Database schema. The publish RPC. The scanner. The buyer-protection logic in tickets (capacity / price / free toggle / tier delete). Trips. Ve experiences. Admin web (no event times there). The Zustand client-side edit-log + notification stack from ORCH-0704 v2.
- **Buyer protection on the new RPC.** Conservative — if your event has ANY paid orders, you CAN edit end-time / start-time / timezone freely (which fixes the 23:55 workaround); but you can NOT change whenMode (single ↔ recurring ↔ multi-date), can NOT structurally change the recurrence rule, and can NOT remove dates from a multi-date series. Those rejections fall back to the existing "cancel + recreate" pattern operators already know. If no tickets are sold, you can change anything.
- **Estimated scope.** ~27-33 files, single PR `Seth → main`. 1 new migration. 1 new RPC. 5 edge function changes (4 widenings + 1 new shared helper). ~10 client files (formatter + math + 5 hydration mappers + wizard + EditPublishedScreen + service). 4 consumer-mobile render sites. 3 marketing composer chip sites. Plus 17 regression tests (10 happy-path + 7 adversarial).
- **EAS OTA eligibility.** YES — the mobile bundle is pure JS. But the SQL migration must be applied via `supabase db push --linked` BEFORE you publish the OTA, otherwise users on the new app code will call an RPC that doesn't exist on the server yet and edit-published-When will throw.
- **Test surface.** Three platforms parity-mandatory (consumer iOS + consumer Android + business iOS + business Android + buyer-anon web + business web-preview). Mandatory adversarial tests: DST spring-forward + fall-back, year-boundary, concurrent edit race, persisted Zustand legacy-draft migration, Web picker smart-infer, sold>0 reject. Every test ships with a `fails-on-revert` hash.
- **Confidence on path forward.** SPEC is tight. 10 open questions all locked with defaults (most resolved by operator D1/D2/D3 + Path B; a few like Q-ICS-Default-Duration and Q11 Push are SPEC-author defaults the operator can override at REVIEW). New invariants are 6 in count and each has a structural enforcer. The contract is precise enough that implementor can ship without misinterpretation.

---

## 13. Confidence

**Investigation:** APPROVED 2026-05-18 with `probable` confidence (source-trace across 5 truth layers; operator can promote to `proven` via <60 s buyer-web tap + mobile-sim authoring tap).

**SPEC drafted at:** `probable` confidence on every layer specified. Reasons:
- DB RPC SQL skeleton is byte-identical to the proven publish-RPC midnight-wrap (low risk of semantic drift).
- Patch-RPC pattern is mirrored from `business_patch_event_taxonomy` (proven in production since ORCH-0824 [Hotfix-5]).
- Buyer-protection thresholds match the existing client-side `publishedEventEditGuards.ts:20-133` semantics exactly.
- Cross-platform parity is automatic (single RN bundle for consumer; single RN/RN-Web bundle for business + buyer-anon).
- Smart-infer logic is already validated semantically by the existing duration label at `CreatorStep2When.tsx:369-370` (`if (mins <= 0) mins += 24 * 60`).

**Confidence-blockers documented:**
- Q-Path-B-Restructure-Scope is CONSERVATIVE — defers the full server-side port of `computeDroppedDates` to a future ORCH. Operator may want to expand at REVIEW if 23:55 workaround events have heavy concurrent sales (run SQL probe in investigation §10).
- Q-ICS-Default-Duration recommends omitting `DTEND` when null — operator may prefer a documented default at REVIEW.
- Q11 Push omits end-time — operator may flip if push character-budget allows.

**Honest limitation:** sim live-fire NOT performed in this SPEC session. SPEC author trusts the investigation's `probable` confidence on the symptom; implementor performs live-fire on iOS+Android sims at implementation time before declaring tests pass.

---

NEXT HANDOFF — paste into Claude `mingla-orchestrator`:

SPEC RETURNED for ORCH-0877 [Event end-time display + midnight-crossing single-day authoring] (Path B). Investigation already APPROVED; SPEC drafted at `Mingla_Artifacts/specs/SPEC_ORCH-0877_EVENT_END_TIME_DISPLAY_AND_MIDNIGHT_CROSSING.md` with 13 sections including full DB RPC SQL skeleton (byte-identical midnight-wrap to publish RPC), 28 numbered success criteria (per-platform on cross-platform ones), 6 new DRAFT invariants, 10 implementor happy-path tests + 7 tester adversarial tests with paths + `fails-on-revert` requirement, 20-step implementation order, 15 hard guards, layman summary. Operator-locked decisions baked in: D1 visual `"Sat 18 May · 10 PM – Sun 19 May · 2 AM"`, D2 smart-infer + visible preview line, D3 leave-as-is + Path B edit-and-extend. New RPC `business_patch_event_when` mirrors `business_patch_event_taxonomy` shape exactly (auth + permission + FOR UPDATE lock + status guards + reason validation [10, 200] chars + error code map). Conservative buyer-protection: blocks whenMode/recurrence/multi-date structural changes when sold>0, allows time-only edits freely. ICS calendar fabrication closed (Constitution #9 violation fixed). 10 open SPEC questions all locked with defaults — operator may override Q-ICS-Default-Duration, Q11-Push, Q-Path-B-Restructure-Scope at REVIEW. Estimated scope ~27-33 files single PR Seth→main, 1 migration, ~17 regression tests, EAS OTA eligible (must apply migration first). Pipeline downstream: orchestrator REVIEW → optional `/ui-ux-pro-max` for cross-midnight indicator mockups (the wizard preview line is the most user-visible new UI) → Claude `mingla-implementor` (or Codex per operator routing) → orchestrator deploys touched edge functions after operator applies migration → Claude `mingla-tester` three-surface parity (iOS sim + Android emu + Web browser per `feedback_tester_canonical_and_platform_parity.md`) → CLOSE → EAS OTA. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
