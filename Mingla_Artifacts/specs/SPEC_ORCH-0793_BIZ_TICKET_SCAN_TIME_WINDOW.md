# SPEC ORCH-0793 — `biz_ticket_scan` Time-Window Enforcement

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0793 |
| Severity | S1 — high |
| Source investigation | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md` |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| Migration head (most recent) | `20260527000000_orch_0788_notification_retry_cron.sql` |
| New migration prefix | `20260528000000` (monotonic) |

---

## 1. Layman summary

Today the Mingla ticket scanner has no concept of time. A buyer who accidentally scans a ticket for a November event right now (showing a friend, camera bump, operator pre-event test) permanently burns it — and they'll be locked out at the door in November because the ticket is now `used`. Operators can't test their scanner setup without sacrificing a real buyer's ticket. Multi-day events / annual passes can't exist because Friday's scan burns Saturday's entry. ORCH-0793 makes `biz_ticket_scan` consult `event_dates`, refuse scans that fall outside the event's active window, and tell the operator clearly why (`Doors open in 4 hours` / `Event ended 3 days ago`). The ticket is NOT burned on an out-of-window scan, so the buyer can still use it when the event actually starts.

This is a **buyer-protection + product-enablement** fix, not a fraud fix. Fraud vectors (resale, replay, cross-event) are already blocked by the existing `duplicate` and `wrong_event` checks.

---

## 2. Scope, non-goals, assumptions

### Scope (this spec)
- Update `biz_ticket_scan` RPC body to consult `event_dates` and gate `success` on time-window membership.
- Add two new RPC discriminator values: `not_yet_open`, `event_ended`.
- Apply a configurable grace window: `GRACE_BEFORE_MINUTES = 120`, `GRACE_AFTER_MINUTES = 360` as in-RPC constants.
- Multi-date events: scan succeeds if `now()` is within ANY of the event's `event_dates` rows' grace-extended windows.
- Mobile scanner UI (`mingla-business`): two new overlay branches, both warning haptic, both recoverable.
- Service type union: extend `ServerScanResult.result` and `scanStore.ScanResult` to include the two new values.
- Audit: `scan_events` rows are written for the new results (no `tickets.status` mutation).
- Strict-grep CI gate: new script + new job under `.github/workflows/strict-grep-mingla-business.yml`.
- One Deno unit test asserting RPC body contains `event_dates` join + `now()` comparison.

### Non-goals (explicitly out of scope — surface as future ORCHs)
- **NO `events.status` auto-advance** (`scheduled → live → ended`). The RPC will read `event_dates` directly per I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY. The status-auto-advance work is registered as discovery D-0793-1; defer to operator.
- **NO ticket-type-level scan windows** (e.g. VIP early access). Event-level only. Discovery D-0793-2.
- **NO buyer-scan notification.** Today no email/push is sent to buyer on scan. Adding one would be defense-in-depth against undetected unauthorized scans but is independent of the time-window fix. Defer.
- **NO app-mobile changes.** Buyers don't scan; only `mingla-business` operators do.
- **NO `cancelled_order` overlay change.** That branch already exists; we add `not_yet_open` and `event_ended` parallel to it.
- **NO retroactive un-using of already-burned tickets.** The fix prevents future burns; recovering past accidental burns is a separate operator workflow (manual SQL or future admin tool).
- **NO grace-window tuning UI.** Constants live in the RPC body. Future ORCH may make them per-event configurable.

### Assumptions
- I-PROPOSED-AX (EVENT_HAS_MASTER_DATE) guarantees `event_dates` master row exists for `status IN ('scheduled', 'live')` events. Per investigation OBS-1, 8 of 9 of Seth's owned events confirm this empirically. If the master row is missing (e.g. cancelled or legacy event), the RPC falls through to existing behavior (no time check) — see §3.1 Decision-3 below.
- `event_dates.start_at` and `end_at` are `TIMESTAMPTZ` (UTC-anchored). The `timezone` column is for display only; the RPC's `now()` and the columns are all UTC, so direct `BETWEEN` comparison is safe.
- The existing scanner permission check (lines 29-38 of current RPC) and QR signature verification (lines 40-62) remain in place — they run BEFORE the new time-window check.

---

## 3. Layer-by-layer specification

### 3.1 Database — `biz_ticket_scan` RPC upgrade

**Migration file:** `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql`

**Definition (new authoritative version of the RPC):**

```sql
-- ORCH-0793 — biz_ticket_scan gains event_dates time-window enforcement.
-- Preserves I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY by reading start_at/end_at
-- from event_dates (not events table, not theme JSON).
--
-- Window membership rule: scan succeeds iff EXISTS event_dates row where
--   now() BETWEEN (start_at - GRACE_BEFORE) AND (end_at + GRACE_AFTER).
-- If no event_dates rows exist for this event (legacy/cancelled), the RPC
-- falls through to pre-0793 behavior (preserves backward compatibility per
-- spec §3.1 Decision-3; investigation OBS-1).
--
-- Cross-references:
--   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md
--   - INVESTIGATION: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md
--   - Invariant: I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED (proposed)
--   - Reinforces: I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY

CREATE OR REPLACE FUNCTION public.biz_ticket_scan(
  p_event_id uuid,
  p_qr_payload text,
  p_scanner_user_id uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  -- Grace constants — see SPEC §3.1 Decision-1.
  c_grace_before constant interval := interval '120 minutes';
  c_grace_after  constant interval := interval '360 minutes';

  v_match text[];
  v_ticket_id uuid;
  v_token text;
  v_ticket record;
  v_scan_result text;
  v_scan_id uuid;
  v_qr_token_pepper text;
  v_scan_event_id uuid;
  v_has_event_dates boolean;
  v_in_window boolean;
  v_next_start timestamptz;
  v_last_end timestamptz;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  IF NOT EXISTS (
    SELECT 1
      FROM public.event_scanners es
     WHERE es.event_id = p_event_id
       AND es.user_id = p_scanner_user_id
       AND es.removed_at IS NULL
       AND COALESCE((es.permissions ->> 'scan')::boolean, true)
  ) THEN
    RAISE EXCEPTION 'scanner_not_authorized';
  END IF;

  v_match := regexp_match(
    p_qr_payload,
    '^mingla:v1:ticket:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$'
  );

  IF v_match IS NULL THEN
    v_scan_result := 'not_found';
  ELSE
    v_ticket_id := v_match[1]::uuid;
    v_token := v_match[2];

    SELECT t.*, o.buyer_name, o.payment_status, tt.name AS ticket_name
      INTO v_ticket
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.id = v_ticket_id
     FOR UPDATE OF t;

    IF NOT FOUND OR p_qr_payload IS DISTINCT FROM public.biz_ticket_checkout_qr_payload(v_ticket_id, v_ticket.qr_token_hash, v_qr_token_pepper) THEN
      v_scan_result := 'not_found';
    ELSIF v_ticket.event_id <> p_event_id THEN
      v_scan_result := 'wrong_event';
    ELSIF v_ticket.payment_status <> 'paid' THEN
      v_scan_result := 'void';
    ELSIF v_ticket.status = 'used' THEN
      v_scan_result := 'duplicate';
    ELSIF v_ticket.status <> 'valid' THEN
      v_scan_result := 'void';
    ELSE
      -- ORCH-0793 — event time-window check. Reads event_dates per
      -- I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY. Multi-date events
      -- succeed if now() lies in ANY date row's grace-extended window
      -- (most-permissive policy — SPEC §3.1 Decision-2).
      SELECT EXISTS (
        SELECT 1 FROM public.event_dates ed
         WHERE ed.event_id = p_event_id
      ) INTO v_has_event_dates;

      IF NOT v_has_event_dates THEN
        -- Decision-3: legacy/cancelled events with no event_dates rows
        -- fall through to existing behavior. Refusing the scan here would
        -- regress operator workflow on pre-0792 events.
        v_scan_result := 'success';
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.event_dates ed
           WHERE ed.event_id = p_event_id
             AND now() BETWEEN (ed.start_at - c_grace_before)
                            AND (ed.end_at   + c_grace_after)
        ) INTO v_in_window;

        IF v_in_window THEN
          v_scan_result := 'success';
        ELSE
          -- Determine which side of the window we're on for the discriminator.
          -- "Next upcoming start" = MIN(start_at) where start_at > now().
          -- If none, the event has fully ended for all dates → event_ended.
          SELECT MIN(ed.start_at) INTO v_next_start
            FROM public.event_dates ed
           WHERE ed.event_id = p_event_id
             AND ed.start_at - c_grace_before > now();

          IF v_next_start IS NOT NULL THEN
            v_scan_result := 'not_yet_open';
          ELSE
            v_scan_result := 'event_ended';
            SELECT MAX(ed.end_at) INTO v_last_end
              FROM public.event_dates ed
             WHERE ed.event_id = p_event_id;
          END IF;
        END IF;
      END IF;

      IF v_scan_result = 'success' THEN
        UPDATE public.tickets
           SET status = 'used',
               used_at = now(),
               used_by_scanner_id = p_scanner_user_id
         WHERE id = v_ticket.id;
      END IF;
    END IF;
  END IF;

  IF v_ticket_id IS NOT NULL THEN
    v_scan_event_id := CASE
      WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id
      ELSE p_event_id
    END;

    INSERT INTO public.scan_events (
      ticket_id, event_id, scanner_user_id, scan_result, client_offline,
      synced_at, metadata
    ) VALUES (
      v_ticket_id, v_scan_event_id, p_scanner_user_id, v_scan_result, false, now(),
      jsonb_build_object(
        'source', 'scan-ticket',
        'requestedEventId', p_event_id,
        'buyerName', COALESCE(v_ticket.buyer_name, ''),
        'ticketName', COALESCE(v_ticket.ticket_name, ''),
        'nextStartAt', v_next_start,
        'lastEndAt', v_last_end
      )
    )
    RETURNING id INTO v_scan_id;
  END IF;

  RETURN jsonb_build_object(
    'result', v_scan_result,
    'scanId', v_scan_id,
    'ticketId', v_ticket_id,
    'orderId', v_ticket.order_id,
    'buyerName', v_ticket.buyer_name,
    'ticketName', v_ticket.ticket_name,
    'nextStartAt', v_next_start,
    'lastEndAt', v_last_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role;

-- Verification probe — fail loudly at migration time if the contract drifted.
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'biz_ticket_scan';

  IF v_body NOT LIKE '%event_dates%' THEN
    RAISE EXCEPTION 'ORCH-0793 probe failed: biz_ticket_scan body lacks event_dates reference';
  END IF;
  IF v_body NOT LIKE '%now()%' THEN
    RAISE EXCEPTION 'ORCH-0793 probe failed: biz_ticket_scan body lacks now() comparison';
  END IF;
  IF v_body NOT LIKE '%not_yet_open%' OR v_body NOT LIKE '%event_ended%' THEN
    RAISE EXCEPTION 'ORCH-0793 probe failed: biz_ticket_scan body missing new discriminator values';
  END IF;
END$$;
```

**Decisions encoded above:**

| # | Decision | Value | Rationale |
|---|---|---|---|
| Decision-1 | Grace window | 120 min before, 360 min after | Matches investigation §8 recommendation. Long enough for early operator setup (2h) + late-arrival/cleanup (6h) without enabling next-day burns. |
| Decision-2 | Multi-date policy | Most permissive (succeeds in ANY date's window) | Matches buyer expectation ("My festival pass works any night"). Investigation OBS-2. |
| Decision-3 | Missing `event_dates` | Fall through to existing pre-0793 behavior | Safer than refusing. Investigation OBS-1. I-PROPOSED-AX guarantees rows for scheduled/live events, so this branch only fires for cancelled/legacy. |
| Decision-4 | Late-arrival inside grace | Accept (status flips to `used`) | Already covered — grace_after extends the success window. After grace_after, result is `event_ended` and ticket stays unused. |
| Decision-5 | New result writes audit row, no status mutation | Yes | `not_yet_open`/`event_ended` insert scan_events but do NOT update `tickets`. Buyer can retry inside the window. |
| Decision-6 | Audit metadata | Adds `nextStartAt` (for `not_yet_open`) and `lastEndAt` (for `event_ended`) | Future ops UI can show "this scan was attempted 3 days after event ended". |

**Migration discipline:**
- File MUST NOT use `mcp__supabase__apply_migration`. Operator runs `supabase db push --linked`.
- File timestamp `20260528000000` is strictly greater than current head `20260527000000` (ORCH-0788 cron).
- Single statement: `CREATE OR REPLACE FUNCTION` — fully replaces the existing definition.

### 3.2 Edge function — `scan-ticket`

**File:** `supabase/functions/scan-ticket/index.ts`

**Change:** none — the edge function already passes the RPC result through unmodified. Verify (do not modify) that:
- The function does not constrain `result` to the old enum
- The response JSON shape passes `nextStartAt` and `lastEndAt` through transparently

If the function has a TypeScript type narrowing `result` to the old enum, widen it to include the two new values. No business logic change.

### 3.3 Service layer — `scanTicketService.ts`

**File:** `mingla-business/src/services/scanTicketService.ts`

**Change:** extend `ServerScanResult` interface:

```ts
export interface ServerScanResult {
  result:
    | "success"
    | "duplicate"
    | "wrong_event"
    | "not_found"
    | "void"
    | "not_yet_open"   // ORCH-0793
    | "event_ended";   // ORCH-0793
  scanId: string | null;
  ticketId: string | null;
  orderId: string | null;
  buyerName: string | null;
  ticketName: string | null;
  nextStartAt: string | null;  // ORCH-0793 — ISO8601, present when result='not_yet_open'
  lastEndAt: string | null;    // ORCH-0793 — ISO8601, present when result='event_ended'
}
```

No other changes. `ScanTicketError` remains unchanged.

### 3.4 Scan store — `scanStore.ts`

**File:** `mingla-business/src/store/scanStore.ts`

**Change:** extend `ScanResult` union:

```ts
export type ScanResult =
  | "success"
  | "duplicate"
  | "wrong_event"
  | "not_found"
  | "void"
  | "cancelled_order"
  | "not_yet_open"   // ORCH-0793
  | "event_ended";   // ORCH-0793
```

No persistence migration needed (the store persists string values; new values round-trip cleanly).

### 3.5 Mobile scanner UI — `mingla-business/app/event/[id]/scanner/index.tsx`

**Changes:**

**(a) `overlaySpec` switch** — add two new branches before the `default` exhaustiveness sentinel:

```ts
case "not_yet_open":
case "event_ended":
  return {
    iconName: "flag",
    iconColor: accent.warm,
    badgeBg: "rgba(235, 120, 37, 0.18)",
  };
```

**(b) `handleBarcodeScanned` message ladder** — replace the existing fall-through message construction with explicit branches:

```ts
let message: string;
let detail: string | undefined = result.ticketName ?? undefined;

if (kind === "duplicate") {
  message = "Already checked in";
} else if (kind === "wrong_event") {
  message = "Different event";
} else if (kind === "void") {
  message = "Ticket not valid";
} else if (kind === "not_yet_open") {
  // ORCH-0793 — doors not open yet. Ticket is NOT burned.
  if (result.nextStartAt) {
    const opens = new Date(result.nextStartAt);
    message = "Doors aren't open yet";
    detail = `Opens ${formatDoorTime(opens)}`;
  } else {
    message = "Doors aren't open yet";
  }
} else if (kind === "event_ended") {
  // ORCH-0793 — event already ended. Ticket is NOT burned.
  if (result.lastEndAt) {
    const ended = new Date(result.lastEndAt);
    message = `Event ended ${formatRelativePast(ended)}`;
  } else {
    message = "Event ended";
  }
} else {
  message = "Ticket not found";
}

showResult({ kind, message, detail });

void Haptics.notificationAsync(
  kind === "duplicate" || kind === "not_yet_open" || kind === "event_ended"
    ? Haptics.NotificationFeedbackType.Warning
    : Haptics.NotificationFeedbackType.Error,
);
```

Where `formatDoorTime` and `formatRelativePast` are small local helpers:
- `formatDoorTime(d)` — for a same-day future time, `"at 9:00 PM"`. For tomorrow, `"tomorrow 9:00 PM"`. For >1 day out, `"Fri Nov 14, 9:00 PM"`. Use existing `RELATIVE_TIME_MS` constants in the file if helpful; otherwise compose with `Intl.DateTimeFormat`.
- `formatRelativePast(d)` — reuse the existing relative-time formatter pattern at lines ~80-90 of the scanner file.

**(c) Accessibility labels** — keep parity with existing overlay; no new label IDs required.

**(d) Constitutional compliance check** — Rule #3 (No silent failures): both new branches surface a clear message + warning haptic. Rule #12 (Validate at right time): the server validates time, the UI surfaces the result; no client-side time math drifts.

### 3.6 Strict-grep CI gate

**Script:** `.github/scripts/strict-grep/orch-0793-scan-time-window.mjs`

Plug in to existing workflow under one new job. Six checks (mirrors the ORCH-0795 pattern):

1. `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql` exists and references `event_dates`, `now()`, `not_yet_open`, `event_ended`, and `c_grace_before`, `c_grace_after`.
2. `mingla-business/src/services/scanTicketService.ts` contains `"not_yet_open"` and `"event_ended"` in the `ServerScanResult` union.
3. `mingla-business/src/services/scanTicketService.ts` declares `nextStartAt` and `lastEndAt` fields.
4. `mingla-business/src/store/scanStore.ts` `ScanResult` union contains `"not_yet_open"` and `"event_ended"`.
5. `mingla-business/app/event/[id]/scanner/index.tsx` has `case "not_yet_open"` and `case "event_ended"` somewhere in the file (catches removal of the overlay branches).
6. No surviving copies of the pre-0793 `biz_ticket_scan` SELECT block that lacks `event_dates` — i.e. no migration prefix `> 20260528000000` may contain a `CREATE OR REPLACE FUNCTION public.biz_ticket_scan` body without `event_dates`.

**Workflow file:** `.github/workflows/strict-grep-mingla-business.yml` — add ONE new job `orch-0793-scan-time-window` calling the script. Mirror the structure of the existing `orch-0795-*` job. Do NOT create a parallel workflow file (see memory `feedback_strict_grep_registry_pattern.md`).

### 3.7 Deno introspection test

**File:** `supabase/functions/scan-ticket/__tests__/biz_ticket_scan_contract.test.ts`

Asserts on the migration SQL text:

```ts
Deno.test("biz_ticket_scan migration references event_dates + now() + new discriminators", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20260528000000_orch_0793_scan_time_window.sql",
      import.meta.url,
    ),
  );
  assert(sql.includes("event_dates"));
  assert(sql.includes("now()"));
  assert(sql.includes("'not_yet_open'"));
  assert(sql.includes("'event_ended'"));
  assert(sql.includes("c_grace_before"));
  assert(sql.includes("c_grace_after"));
});
```

Run via `deno test supabase/functions/scan-ticket/__tests__/` from project root. If Deno is unavailable in the implementor's session, the implementation report must note "Deno gate deferred — operator must run before deploy."

---

## 4. Success criteria

| # | Criterion | Observable | Test |
|---|---|---|---|
| SC-1 | Scanning a paid valid ticket when `now()` is inside `[start_at - 2h, end_at + 6h]` returns `result='success'` and flips `tickets.status='used'`. | SQL probe: `SELECT result FROM biz_ticket_scan(...)` returns `success`; subsequent SELECT of the ticket shows `status='used'`. | T-01 |
| SC-2 | Scanning the same ticket when `now() < start_at - 2h` returns `result='not_yet_open'`, `nextStartAt` populated, and `tickets.status` REMAINS `'valid'`. | SQL probe; row inspection. | T-02 |
| SC-3 | Scanning the same ticket when `now() > end_at + 6h` returns `result='event_ended'`, `lastEndAt` populated, and `tickets.status` REMAINS `'valid'`. | SQL probe; row inspection. | T-03 |
| SC-4 | Multi-date event with one date today and one date next month: scanning during today's window succeeds; ticket is consumed. | Manual test against a test event with two `event_dates` rows; the second scan attempt during next month's window correctly returns `duplicate` (consistent with single-use ticket policy). | T-04 |
| SC-5 | Event with no `event_dates` rows (cancelled / legacy): scanner behavior identical to pre-0793 RPC (returns `success` for paid+valid+unused). | Insert a row in a test event with no event_dates, scan, observe `success`. | T-05 |
| SC-6 | `scan_events` audit row is written for `not_yet_open` and `event_ended` with `metadata.nextStartAt` / `metadata.lastEndAt` populated. | SELECT * FROM scan_events WHERE ticket_id = ... after each test. | T-06 |
| SC-7 | Mobile scanner UI overlay shows `Doors aren't open yet` (with start time) on `not_yet_open` and `Event ended Xh ago` on `event_ended`. Warning haptic on both. Overlay is dismissible. Ticket can be re-scanned later within window. | iOS Simulator + Android Emulator + Web browser parity (per memory `feedback_tester_canonical_and_platform_parity.md`). | T-07, T-08, T-09 |
| SC-8 | Existing scanner contracts unchanged: `duplicate`, `wrong_event`, `void`, `not_found`, `scanner_not_authorized` all return the same shape as pre-0793. | Regression test suite + manual smoke. | T-10 |
| SC-9 | Strict-grep CI gate `orch-0793-scan-time-window` is green on `Seth` and `main`. | PR check status. | T-11 |
| SC-10 | Deno introspection test passes. | `deno test supabase/functions/scan-ticket/` returns 0. | T-12 |

---

## 5. Test cases

| ID | Scenario | Inputs | Expected | Layer |
|---|---|---|---|---|
| T-01 | In-window scan | Event with master `event_dates` row covering now() | `result='success'`, ticket → `used` | DB+RPC |
| T-02 | Pre-window scan | Event starts in 5 hours (> 2h grace_before) | `result='not_yet_open'`, `nextStartAt` set, ticket remains `valid` | DB+RPC |
| T-03 | Post-window scan | Event ended 65h ago (> 6h grace_after) | `result='event_ended'`, `lastEndAt` set, ticket remains `valid` | DB+RPC |
| T-04 | Multi-date hit | Two event_dates rows: today (active) + next month | `result='success'` on today's scan; second scan next month → `duplicate` (because ticket is single-use) | DB+RPC |
| T-05 | No event_dates fallback | Event with zero event_dates rows | `result='success'` (pre-0793 behavior) | DB+RPC |
| T-06 | Audit metadata | Any not_yet_open or event_ended scan | `scan_events` row exists with `metadata.nextStartAt` or `metadata.lastEndAt` | DB |
| T-07 | iOS overlay — not_yet_open | Scan early ticket on iOS Simulator | "Doors aren't open yet — opens at 9:00 PM" overlay, warning haptic, dismissible | iOS UI |
| T-08 | Android overlay — event_ended | Scan late ticket on Android Emulator | "Event ended 3 days ago" overlay, warning haptic | Android UI |
| T-09 | Web overlay — both | Scan early then late ticket on Expo web | Both overlays render correctly | Web UI |
| T-10 | Regression — duplicate | Re-scan a `used` ticket | `result='duplicate'` (unchanged) | DB+UI |
| T-11 | CI gate — strict-grep | Push to PR | `orch-0793-scan-time-window` job green | CI |
| T-12 | CI gate — Deno introspection | Run `deno test` | All assertions pass | CI |
| T-13 | Buyer-burn prevention | Scan a future-dated ticket accidentally, verify ticket can still be scanned later when event opens | First scan → `not_yet_open` (no burn); later in-window scan → `success` | DB+RPC |
| T-14 | Grace boundary — start | Scan at `start_at - 119min` then `start_at - 121min` | First → success; second → not_yet_open | DB+RPC |
| T-15 | Grace boundary — end | Scan at `end_at + 359min` then `end_at + 361min` | First → success; second → event_ended | DB+RPC |

---

## 6. Invariants

### Preserved invariants

| Invariant | How preserved |
|---|---|
| I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY | RPC reads `event_dates.start_at`/`end_at`, never `events.*` timestamps or theme JSON. |
| I-PROPOSED-AX EVENT_HAS_MASTER_DATE | Not affected — RPC reads ANY event_dates row for the event, not specifically the master. |
| I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER | Untouched — scanner authorization check (lines 29-38) preserved verbatim. |
| Constitution #3 (No silent failures) | The two new branches surface clear UI messaging with warning haptic. |
| Constitution #12 (Validate at right time) | Server validates time using TIMESTAMPTZ + UTC `now()`; UI does not duplicate the math. |
| `scan_events` trigger contract (`event_id = tickets.event_id`) | HF-2 respected — new audit rows always write `event_id = p_event_id` because they only fire when the ticket DID belong to this event. |

### NEW invariant (proposed by this SPEC)

| ID | Name | Statement | Enforcement |
|---|---|---|---|
| I-PROPOSED-BB | SCAN_TIME_WINDOW_ENFORCED | Every `biz_ticket_scan` returning `result='success'` MUST be the consequence of either (a) `EXISTS event_dates row where now() BETWEEN (start_at - grace_before) AND (end_at + grace_after)`, OR (b) `NOT EXISTS event_dates row for this event_id` (the legacy fallback). | Strict-grep gate `orch-0793-scan-time-window.mjs` checks 1, 6 + Deno introspection test + RPC body verification probe in migration §3.1. |

Status flips to ACTIVE on CLOSE.

---

## 7. Implementation order

Database first, then types, then UI, then CI gate, then tests.

1. **Migration** — `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql` (per §3.1)
2. **Operator runs `supabase db push --linked`** (deploy gate)
3. **Service type extension** — `mingla-business/src/services/scanTicketService.ts` (per §3.3)
4. **Store type extension** — `mingla-business/src/store/scanStore.ts` (per §3.4)
5. **Scanner UI** — `mingla-business/app/event/[id]/scanner/index.tsx` (per §3.5)
6. **Edge function verify** — `supabase/functions/scan-ticket/index.ts` — confirm no type narrowing blocks new result values (per §3.2)
7. **Strict-grep script** — `.github/scripts/strict-grep/orch-0793-scan-time-window.mjs` (per §3.6)
8. **Strict-grep workflow job** — `.github/workflows/strict-grep-mingla-business.yml` (per §3.6)
9. **Deno introspection test** — `supabase/functions/scan-ticket/__tests__/biz_ticket_scan_contract.test.ts` (per §3.7)
10. **Implementor runs `deno check` + `deno test`** for the scan-ticket function (parity rule #8)
11. **No edge function deploy required** — `scan-ticket` source unchanged (verify step in §3.2). If edge function source IS changed during step 6, then orchestrator deploys via `supabase functions deploy scan-ticket --project-ref gqnoajqerqhnvulmnyvv`.

---

## 8. Regression prevention

- **Structural safeguard:** I-PROPOSED-BB invariant + migration verification probe (§3.1) + strict-grep gate (§3.6) + Deno introspection test (§3.7). Four independent layers all assert the same contract.
- **Protective comment:** the migration file's header block (per §3.1) documents the rule and cites I-PROPOSED-BB. Future developers reading the RPC see the rationale.
- **CI gate:** the strict-grep script's check #6 explicitly blocks future migrations that would `CREATE OR REPLACE FUNCTION biz_ticket_scan` without `event_dates`.

---

## 9. Implementor must-knows

- **Use the implementor's pre-flight `/ui-ux-pro-max` skill** for the scanner UI overlay copy + icon + haptic choices (per memory `feedback_implementor_uses_ui_ux_pro_max.md`). Constraints to feed into it: two new states, both **recoverable** (no destructive haptic), warning-tone icon + amber color (consistent with `duplicate`).
- **Do NOT use `mcp__supabase__apply_migration`** (memory hard rule). Operator runs `supabase db push --linked`.
- **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
- **Migration filename** strictly greater than `20260527000000`. Use `20260528000000`.
- **No edge function deploy unless §3.2 verification finds a narrowing** that requires source edits.
- **Solo + collab parity:** N/A — scanner is operator-only, not buyer-facing.
- **Mobile + admin parity:** N/A — admin has no scanner surface.
- **iOS + Android + Web parity required** for scanner UI overlay branches (per memory `feedback_tester_canonical_and_platform_parity.md`).
- **No buyer-notification work in this ORCH** (out of scope §2; surface as discovery).

---

## 10. Discoveries to surface during implementation

If during implementation you find:
- The edge function `scan-ticket` narrows the result type → widen the union, do NOT change runtime logic.
- A test event with no event_dates that should have one → that's an I-PROPOSED-AX violation; flag separately, do not fix here.
- `events.status = 'scheduled'` on an event that ended → that's D-0793-1; do not fix here.

Document any such surface in the implementation report's "Discoveries for Orchestrator" section. Do not silently expand scope.

---

## 11. Routing

After implementation: Claude `mingla-tester` for TARGETED QA on iOS + Android + Web parity (per memory `feedback_tester_canonical_and_platform_parity.md`); after PASS, Claude `mingla-orchestrator` (or Codex equivalent) for CLOSE.
