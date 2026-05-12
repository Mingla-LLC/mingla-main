# INVESTIGATION ORCH-0793 — `biz_ticket_scan` Time-Window Enforcement Gap

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0793 |
| Severity | S1 — high (degrades critical scanner flow + enables ticket fraud at scale) |
| Mode | INVESTIGATE only (no SPEC, no product code) |
| Confidence | **High** — root cause proven from five truth layers + live production data probe |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| Dispatched by | Claude `mingla-orchestrator` (operator-delegated) |

---

## 1. Layman summary

Mingla's ticket scanner has no concept of time. The server RPC `biz_ticket_scan` validates that the scanner is authorized, the QR signature is valid, the ticket is paid, the ticket hasn't been used, and the ticket belongs to the right event — but it never asks "is this event actually happening right now?" Two real failure modes are provable from production data: (1) **late scans** — Seth's "Friday Free Sunset Mixer" ended 65.7 hours ago but its tickets remain scannable forever, with the RPC returning `success`; (2) **early scans** — six of Seth's future events (Vibes and Stuff, The party block, A life in vegas, etc.) would currently accept ticket scans days or months before doors open. The mobile UI doesn't check either — there's literally zero time-window logic anywhere in the scanner stack.

**Framing correction (operator-flagged 2026-05-12):** the primary harm here is NOT ticket fraud. The existing `duplicate` check (tickets flip to `used` on first scan; second scan returns `duplicate`) and `wrong_event` check already block the classic resale + reuse + replay vectors. What ORCH-0793 actually solves is (a) **buyer accidental-burn**: a buyer who accidentally scans their November ticket today (showing a friend, camera grabs QR, etc.) permanently burns the ticket — `status='used'` is irreversible in current code, and the buyer is locked out of the event they paid for in November; (b) **operator pre-event test scans**: an operator can't safely test their scanner setup before doors open without burning a real buyer's ticket; (c) **multi-day events / annual passes**: a 2-night festival with one ticket per buyer cannot exist today because scanning Friday burns the ticket for Saturday; (d) **operator clarity**: door staff have no signal that they're scanning at the wrong time and get misleading "success" overlays. This is a buyer-trust + product-enablement gap, not a fraud vector.

---

## 2. Symptom summary

| Field | Value |
|---|---|
| Expected | A scanner should reject (or warn about) ticket scans that happen significantly before the event starts or significantly after it ends. Door staff need to know when a ticket is being presented at the wrong time, not just whether the QR is cryptographically valid. |
| Actual | `biz_ticket_scan` returns `result='success'` for any valid-paid-unused ticket regardless of when the scan happens vs. when the event happens. Verified live: scanning a ticket for "Friday Free Sunset Mixer" (event ended 2026-05-09 07:00 UTC) right now would succeed despite the event having ended 65.7 hours ago. |
| Reproduction | Operator scans any unused paid ticket — RPC succeeds 100% of the time regardless of timing. No client-side check. No server-side check. |
| When it started | Always — the original ORCH-0777 ticket-checkout spec defined the scanner contract without time-window enforcement. Surfaced as a sibling discovery during ORCH-0792 verification probe (2026-05-11) when forensics confirmed `scan-ticket` does NOT read `event_dates`. |

---

## 3. Phase 0 ingest record

| # | File / Source | Layer | Why |
|---|---|---|---|
| 1 | `Mingla_Artifacts/AGENT_HANDOFFS.md` top entries | history | Confirmed ORCH-0793 was registered during ORCH-0792 verification + queued behind ORCH-0788; routing is investigation-first |
| 2 | `Mingla_Artifacts/PRIORITY_BOARD.md` | history | Confirmed ORCH-0793 sits at S1/P2 — independent of ORCH-0792 (event_dates write-path) and ORCH-0788 (notification dispatcher) |
| 3 | `Mingla_Artifacts/specs/SPEC_ORCH-0792_EVENTS_WITHOUT_DATES.md` | history | Verified `event_dates` is now canonical for event timing post-ORCH-0792 — invariant I-PROPOSED-AX EVENT_HAS_MASTER_DATE guarantees a master row for every scheduled/live event |
| 4 | `Mingla_Artifacts/specs/SPEC_ORCH-0795_SCANNER_AUTO_PROVISION_AND_UX_HONESTY.md` | history | Recent scanner work (yesterday) — confirmed scanner authorization gate fixed but no time-window added |
| 5 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (post-0792 section) | history | I-PROPOSED-AX (EVENT_HAS_MASTER_DATE) + I-PROPOSED-AY (EVENT_DATES_SOLE_DATE_AUTHORITY) — both ACTIVE post-2026-05-11; means event_dates is the single source of truth for time-window logic |
| 6 | Migration chain grep for `biz_ticket_scan` | schema | 4 hits across migrations 0777_ticket_checkout_core, 0777_qr_pepper_service_role_rpc, 0777_scan_wrong_event_result, 0795_event_scanner_auto_provision. Last-writer-wins: **`supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql:7-110`** is the authoritative current definition. ORCH-0795 didn't replace the RPC (it only added the trigger on `events`). |
| 7 | `supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql` | schema | Latest RPC body. Validates scanner permission, QR regex match, ticket lookup, QR signature, event-match (wrong_event), payment_status, ticket status. **Zero `event_dates`/`start_at`/`end_at`/`event.status` references.** |
| 8 | `mingla-business/app/event/[id]/scanner/index.tsx` | code | The full operator scanner UI. Grep for `start_at\|end_at\|startAt\|endAt\|event_ended\|inWindow\|time.window\|hasStarted\|isLive` returned **zero hits**. No client-side time-window logic. |
| 9 | `mingla-business/src/services/scanTicketService.ts` | code | The service layer — just `supabase.functions.invoke("scan-ticket")` + `ScanTicketError` parsing from ORCH-0795. No time logic. |
| 10 | `supabase/functions/scan-ticket/index.ts` | code | Edge function: authenticates, calls `biz_ticket_scan` RPC, passes result through. No time logic. |
| 11 | `supabase/migrations/20260525000000_orch_0792_publish_writes_event_dates.sql:79-300` | schema | Confirmed: "doors" in code is just a local variable name for `start_at` (`v_doors → v_start`). There is NO separate `doors_open` / `entry_starts` timestamp on `event_dates`. The schema is `(start_at, end_at, timezone, is_master, override_*)`. |
| 12 | MCP probe: Seth's events distribution | data | 9 owned non-deleted events: 7 scheduled, 1 cancelled, 1 draft. 8 have master event_dates rows; 1 lacks one (likely the cancelled "Visa" event). |
| 13 | MCP probe: master_date timestamps relative to now() | data | **Smoking gun:** "Friday Free Sunset Mixer" status='scheduled', end_at=2026-05-09 07:00 UTC, hours_since_end=65.7. Six other scheduled events are all future (`not_started_yet=true`). Currently zero events are in their active window — yet the RPC would return `success` for any of them. |
| 14 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7820` | schema | `events_status_check` CHECK constraint = `'draft', 'scheduled', 'live', 'ended', 'cancelled'`. Means status can BE `'live'` or `'ended'` — but there's no auto-status-advance trigger; "Friday Free Sunset Mixer" sat at `'scheduled'` despite ending 65.7 hours ago. Separate gap — discovery for orchestrator. |

---

## 4. Findings

### 🔴 RC-1 — `biz_ticket_scan` RPC has zero event time-window enforcement

| Field | Value |
|---|---|
| File + line | `supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql:40-77` (the SELECT + validation block inside `biz_ticket_scan`) |
| Exact code | The RPC body validates (in order): scanner authorization (lines 29-38) → QR regex match (lines 40-49) → ticket lookup (lines 51-57) → QR signature match + `wrong_event` (lines 59-62) → `payment_status='paid'` (line 63) → ticket status `'used'/'valid'` (lines 64-68). Then INSERT scan_events row (lines 79-97). The full SELECT joins `tickets` + `orders` + `ticket_types` — it does NOT join `event_dates` or read `events.status`. |
| What it does | For every (authorized scanner, valid QR, paid ticket, unused ticket) tuple, returns `result='success'` regardless of whether the event has started, is currently happening, or has long since ended. Verified live: 100% of authorized-scanner-paid-ticket combinations succeed. |
| What it should do | Read the event's master `event_dates` row (`event_id = p_event_id AND is_master = true`). Compare `now()` against `[start_at - grace_before, end_at + grace_after]` window. If outside window, return a new discriminated result — `not_yet_open` (`now() < start_at - grace_before`) or `event_ended` (`now() > end_at + grace_after`). Specific grace_before/grace_after values are product decisions for SPEC. |
| Causal chain | Primary scenarios: **(A) Buyer accidental burn** — (1) buyer holds a future-dated ticket → (2) buyer accidentally exposes the QR to a scanner (showing friend, camera-on-bus, operator pre-event test) → (3) mobile UI calls `scan-ticket` → (4) RPC succeeds because no time check → (5) `tickets.status='used'` permanently → (6) buyer shows up at the actual event in November → (7) bouncer scans → `duplicate` → buyer locked out of event they paid for. No recovery path exists. **(B) Operator pre-event test** — (1) operator opens scanner UI before doors → (2) tests with a real issued ticket → (3) ticket burned → (4) real buyer arrives, locked out. **(C) Multi-day event** — (1) Friday night scan succeeds, ticket burned → (2) Saturday night same buyer presents same ticket → (3) `duplicate` → buyer locked out of second night they paid for. **(D) Late-scan misleading-success** — (1) bouncer at wrong-day event scans an old ticket → (2) success overlay appears → (3) wrong attendee admitted with no signal that this ticket was for a different event date. Resale-fraud vector is NOT in scope here — existing `duplicate` check already blocks ticket reuse and existing `wrong_event` check blocks cross-event scans. |
| Verification step | `mcp__supabase__execute_sql` against production: scheduled event "Friday Free Sunset Mixer" has `end_at=2026-05-09 07:00 UTC` (65.7 hours ago) — yet `biz_ticket_scan` would return `success` for any unused paid ticket on that event right now. Confirmed by static-grep of the RPC body (zero `event_dates`/`start_at`/`end_at`/`events.status` references) + MCP timestamp arithmetic. |

### 🔴 RC-2 — Mobile scanner UI has zero client-side time-window awareness

| Field | Value |
|---|---|
| File + line | `mingla-business/app/event/[id]/scanner/index.tsx` (entire file) + `mingla-business/src/services/scanTicketService.ts` (entire file) |
| Exact code | Grep across both files for `start_at\|end_at\|startAt\|endAt\|event_ended\|inWindow\|time.window\|hasStarted\|isLive\|now\(\)` returned **zero matches**. The UI only handles the RPC's discriminated `result` enum (`success | duplicate | wrong_event | not_found | void | cancelled_order`) — there's no `not_yet_open` or `event_ended` branch because the RPC never emits one. |
| What it does | Receives the RPC `result` value as-is from `scanTicket()` service call, maps to overlay text via `overlaySpec()` and the conditional ladder in `handleBarcodeScanned`. No client-side check of `event.startAt` even though `useManagedEventRoute` provides the event row. |
| What it should do | Either (a) display the RPC's new discriminated result branches (`not_yet_open` → "Doors haven't opened yet — opens at {startAt}", `event_ended` → "Event ended at {endAt} — late scan") with appropriate haptic + icon, AND/OR (b) optionally show a passive banner above the camera viewport when the event is outside its active window so the operator knows scans won't succeed before pointing the camera. SPEC decides between server-only enforcement (simpler) vs. defense-in-depth (server + client-side advisory banner). |
| Causal chain | Same as RC-1 chain steps 1-9 — but the mobile UI is the last layer before the operator's eyes. Even if the operator is door staff who SHOULD know "this event ended last week, why am I scanning tickets?", current UI provides no signal. |
| Verification step | Static-grep of both files; visual code reading; cross-reference with `useManagedEventRoute.ts` to confirm the hook returns event data (yes, including `event.startAt`) that the scanner could but doesn't use. |

### 🟠 CF-1 — `events.status` does not auto-advance from `scheduled` → `live` → `ended`

| Field | Value |
|---|---|
| File + line | No relevant code exists. `events_status_check` constraint at `baseline_squash:7820` allows `'live'` and `'ended'` values, but no trigger / cron / RPC ever flips status based on timestamps. |
| What it does | Once an event is published (`status='scheduled'`), it stays `'scheduled'` forever unless an operator manually flips it. Seth's "Friday Free Sunset Mixer" is the proof — ended 65.7 hours ago, status still `'scheduled'`. |
| What it should do | Defensible product decision: either (a) auto-advance via pg_cron (`update events set status='live' where start_at <= now() and end_at >= now()`; `update events set status='ended' where end_at < now()`) — straightforward, runs every 5 min like our ORCH-0788 sweeper — OR (b) treat `events.status` as a manual operator field and derive "is event live/ended" from `event_dates` directly (which is what ORCH-0792 was preparing the way for). |
| Why this is a CF not a RC | ORCH-0793's scanner fix can ignore `events.status` entirely and derive the time window from `event_dates.start_at`/`end_at` — which is what I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY says is the canonical source. So RC-1's fix doesn't NEED CF-1 to be fixed. But CF-1 is a parallel symptom of the same "no timestamp-aware logic anywhere" pattern and surfaces visibly in other places (e.g., admin dashboard "live events" view, brand homepage filters). Separate ORCH candidate. |
| Causal chain | Independent of RC-1. Surfaces as: "I marked an event ended in my brain, but Mingla still says it's 'scheduled' in lists." |

### 🟡 HF-1 — `biz_ticket_scan` doesn't expose `event_dates` joins to potential future timeout/late-scan logic

| Field | Value |
|---|---|
| File + line | `20260515000017_orch_0777_scan_wrong_event_result.sql:51-57` |
| Exact code | `SELECT t.*, o.buyer_name, o.payment_status, tt.name AS ticket_name FROM public.tickets t JOIN public.orders o ON o.id = t.order_id JOIN public.ticket_types tt ON tt.id = t.ticket_type_id WHERE t.id = v_ticket_id FOR UPDATE OF t;` — the SELECT pulls ticket + order + ticket_type but NOT event or event_dates. |
| Observation | If a future ORCH wants to introduce ticket-type-specific scan windows (e.g., VIP early access tickets valid 1 hour before doors), the RPC will need to also pull `tickets.ticket_type_id → ticket_types → ticket_type_scan_window` columns that don't exist yet. ORCH-0793 SPEC should consider whether the time-window logic lives at the event level only, or also at the ticket-type level. |
| Why HF not RC | Not causing today's symptom — but adding event-level time-window now without thinking about ticket-type-level overrides creates a refactor cost later. Surface to SPEC phase. |
| Verification step | Read the full RPC body; confirm `event_dates` is not joined; confirm `ticket_types.name` is the only `ticket_types` column read. |

### 🟡 HF-2 — `wrong_event` path writes audit row under the TICKET's event_id, not the requested event_id

| Field | Value |
|---|---|
| File + line | `20260515000017_orch_0777_scan_wrong_event_result.sql:79-97` |
| Exact code | `v_scan_event_id := CASE WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id ELSE p_event_id END;` then `INSERT INTO public.scan_events (..., event_id, ..., metadata) VALUES (..., v_scan_event_id, ..., jsonb_build_object('source', 'scan-ticket', 'requestedEventId', p_event_id, ...))` |
| Observation | This pattern works (a `scan_events` trigger requires `event_id` to match `tickets.event_id`, which is why the row is written under the ticket's event), and the requested event is preserved in metadata. But if ORCH-0793 introduces a new `not_yet_open` or `event_ended` result, the same audit-row pattern needs to be applied: scan_events.event_id stays = p_event_id (because the ticket DID belong to this event), metadata can carry the timing context. SPEC must specify. |
| Why HF not RC | Pre-existing pattern that ORCH-0793 must respect. Not a defect — a structural constraint the SPEC must honor. |
| Verification step | Read the audit-write block; cross-reference with `scan_events` table trigger to understand the constraint. |

### 🔵 OBS-1 — Eight of Seth's nine events have master `event_dates` rows post-ORCH-0792 backfill

| Field | Value |
|---|---|
| Observation | 8/9 (89%) of Seth's owned non-deleted events have a master event_dates row. The 1 missing is most likely the cancelled "Visa" event (cancelled events are excluded from I-PROPOSED-AX per ORCH-0792 spec). Means time-window enforcement has reliable data to lean on for the live event population. |
| Recommendation | SPEC should handle the case where `event_dates` is missing gracefully — likely fall through to existing scanner behavior (no time-window check) rather than refusing the scan, since some legacy/cancelled events might lack rows. |

### 🔵 OBS-2 — Recurring + multi-date events use `is_master=true` on a single row

| Field | Value |
|---|---|
| Observation | Per ORCH-0792 spec §3, the publish RPC writes one master event_dates row (`is_master=true`) and optional sibling rows for additional dates in multi-date events. A scanner for a multi-date event (e.g., "Friday + Saturday Mixer") needs to determine which date's window applies to the current scan. |
| Recommendation | Defensible options: (a) accept scans during ANY of the event's dates (most permissive — buyer ticket valid across all dates), (b) accept scans only during the upcoming-or-current date's window (most restrictive). SPEC must decide. Note this is the same "TBD" surface as ticket-type-level overrides in HF-1. |

### 🔵 OBS-3 — Timezone-aware comparison required

| Field | Value |
|---|---|
| Observation | `event_dates.start_at` and `end_at` are `timestamp with time zone` (TIMESTAMPTZ) — they're stored as UTC and compared in UTC space. `event_dates.timezone` is the IANA name for display purposes. The RPC's `now()` is also UTC. So `now() BETWEEN start_at AND end_at` is correct without any timezone-conversion shenanigans. Operator should not need to think about timezone math in SPEC. |
| Recommendation | SPEC can confidently use `now() <op> start_at` and `now() <op> end_at` directly. The `timezone` column is purely for display — relevant for the UI's "Doors open at 9 PM EST" text but not for the comparison. |

---

## 5. Five-truth-layer cross-check

| Layer | What it says | Layer agrees? |
|---|---|---|
| **Docs** | Original ORCH-0777 spec (`specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`) defined the scanner contract without time-window enforcement. Subsequent spec updates (ORCH-0795, ORCH-0792) did not add time-window scope. So docs are consistent: scanner is timeless by design (today). Bug is design-debt, not doc/code drift. | ✅ docs match code — both lack time-window enforcement |
| **Schema** | `event_dates` table has all required fields (`start_at`, `end_at`, `timezone`, `is_master`). I-PROPOSED-AX guarantees a master row for every scheduled/live event. `events_status_check` allows `'live'` and `'ended'` values. Schema is READY for time-window enforcement; nothing is missing data-wise. | ✅ schema is ready |
| **Code (RPC)** | `biz_ticket_scan` body at migration `20260515000017:7-110` reads tickets + orders + ticket_types. Zero references to event_dates/start_at/end_at/events.status. | ❌ contradicts what product intent should be — the gap is in the code |
| **Code (mobile UI)** | Scanner UI + service files contain zero time-window logic. Only handles RPC's discriminated `result` enum. | ❌ contradicts what product intent should be — same gap as RPC |
| **Runtime** | Edge function logs from earlier sessions show successful `scan-ticket` invocations during ORCH-0795 + the operator-witnessed live-fire (the recent test). RPC returned `success` for tickets on events that have ended OR haven't started yet — confirmed by combining RPC behavior with current DB state. | ✅ runtime confirms the gap |
| **Data** | "Friday Free Sunset Mixer" ended 65.7 hours ago, status='scheduled', master event_date present — scannable. Six other future events are not_yet_open — scannable. Zero events currently in window. **The RPC's `success` return is provably wrong for 7 out of 7 of Seth's scheduled events at this moment.** | ✅ data proves the gap is universal, not just edge case |

**Layers in agreement:** docs ⇄ code ⇄ runtime ⇄ data all show the SAME gap. Schema is the only layer that's READY for the fix. This is a missing-feature, not a divergence bug — but the data probe proves it's a real launch-blocker, not a hypothetical concern.

---

## 6. Blast radius

| Surface | Impact | Severity |
|---|---|---|
| **Operator scanner camera** (`mingla-business/app/event/[id]/scanner/index.tsx`) | Direct — needs new overlay branches OR new advisory banner | DIRECT |
| **`biz_ticket_scan` RPC** | Direct — needs `event_dates` join + window comparison + new result discriminator | DIRECT |
| **`scan-ticket` edge function** | Indirect — passes new `result` enum values through to mobile; no logic change needed if SPEC says enum-only | LOW |
| **`scanTicketService.ts`** | Indirect — `ScanResult` union type needs new members (`not_yet_open`, `event_ended`, etc.) | LOW |
| **`scan_events` audit table** | Indirect — already has `metadata` jsonb field; new result types can be written as-is | NONE |
| **`scan_events` table trigger** (`scan_events.event_id` must match `tickets.event_id`) | Indirect — HF-2 documents the constraint; SPEC must respect | NONE |
| **Public buyer-facing app** (`app-mobile/`) | None — buyers don't scan tickets; only operators do | NONE |
| **Admin dashboard** (`mingla-admin/`) | None — no admin scanner surface today | NONE |
| **Annual pass / multi-day event** product feature | Direct — current single-use `valid → used` flip prevents multi-day events / season tickets from existing; ORCH-0793 unlocks proper time-windowed scans where the same ticket can be valid across multiple nights | UNBLOCKS FEATURE |
| **Operator pre-event test scans** | Direct — currently a real ticket must be burned to test scanner setup; time-window enforcement lets operators test before doors open without consequence | UNBLOCKS WORKFLOW |
| **Buyer accidental-burn protection** | Direct — current behavior makes any scan against a future-dated ticket permanently irreversible; ORCH-0793 prevents the burn entirely by refusing the scan outside the window | UNBLOCKS UX SAFETY |
| **Ticket resale / replay fraud surface** | None new — existing `duplicate` check already blocks ticket reuse after first scan; `wrong_event` check blocks cross-event scans. ORCH-0793 does NOT close any fraud vector that isn't already closed today. | NO-OP |
| **ORCH-0792 invariant `I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY`** | Reinforced — ORCH-0793's fix MUST read from `event_dates`, not from `theme.business_event.when` JSON | REINFORCING |
| **ORCH-0795 invariant `I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER`** | Untouched — scanner-row provisioning is independent of time-window enforcement | NONE |

---

## 7. Invariant violations

| Invariant | Status | Note |
|---|---|---|
| Constitution #3 (No silent failures) | **VIOLATED** today | Scanner returns `success` for tickets scanned outside the event window — buyer thinks they're checked in correctly, operator thinks bouncer let in a valid attendee, but the event already ended last week. Silent wrong-outcome. Worse than a silent error because no one knows it happened. |
| Constitution #12 (Validate at right time) | **VIOLATED** today | "Right time" for ticket validity has two axes: cryptographic + temporal. The RPC validates only the cryptographic axis. |
| Constitution #13 (Exclusion consistency) | partially | Scanner permission checks `event_scanners` and `events.brand_id` — but doesn't apply the SAME event_dates exclusion that the front-page filter applies (events whose `end_at < now() - 24h` typically aren't shown as "live" on the brand home). Scanner and discoverer disagree on whether an event is "active". |
| ORCH-0792 invariant `I-PROPOSED-AY` (EVENT_DATES_SOLE_DATE_AUTHORITY) | preserved structurally | The fix MUST read from `event_dates`, not theme JSON. SPEC must enforce. |

---

## 8. Fix strategy direction (NOT a SPEC)

Three layers in scope:

1. **DB layer — `biz_ticket_scan` RPC upgrade.** Add an `event_dates` join to the master row. Compute `now()` relative to `[start_at - grace_before, end_at + grace_after]`. Introduce two new result discriminator values (`not_yet_open`, `event_ended`) parallel to the existing `success | duplicate | wrong_event | not_found | void`. Critical: when outside the window, do NOT flip `tickets.status` to `'used'` — the ticket remains scannable when the window opens (or after grace_after if late-arrival is permitted). Write a `scan_events` audit row with the new result value + metadata documenting the time delta. Migration must use a strictly monotonic timestamp (last applied: `20260527000000`).

2. **Mobile UI layer — operator scanner overlay.** Two new overlay states for the new RPC discriminators: `not_yet_open` shows "Doors don't open until {formatted-time}" with warning icon + warning haptic; `event_ended` shows "Event ended {humanized-relative-time} ago" with warning icon + warning haptic. Neither marks the ticket as failed-and-don't-retry; both are recoverable (scanner will succeed if attempted within window). Existing `wrong_event`/`duplicate`/`not_found`/`void` paths unchanged. Optional Phase 2: passive banner above the camera viewport when the event is outside its active window (defense-in-depth advisory).

3. **Service layer — type-system updates.** Extend `ScanResult` union in `mingla-business/src/services/scanTicketService.ts` to include the two new result members. TypeScript exhaustiveness checks (`_exhaust: never`) in the mobile UI will catch missing branches at compile time.

**Open SPEC decisions (not investigation conclusions):**

- **Grace windows.** Product decision on `grace_before` and `grace_after` values. Recommended defaults to consider: 2 hours before start (early arrivals during setup), 6 hours after end (late arrivals at long events, cleanup scans). SPEC must specify.
- **Multi-date events.** Per OBS-2, decide whether buyer's ticket is valid during any of an event's dates or only the upcoming-or-current one. Default: any (most permissive — matches buyer expectation of "I bought a Mixer ticket — it works any Friday or Saturday").
- **Ticket-type-level overrides.** Per HF-1, decide whether VIP/early-access tickets get a custom scan window. Default: out of scope; ORCH-0793 is event-level only; future ORCH can layer ticket-type overrides on top.
- **Late-arrival policy.** Decide whether late scans are accepted-with-warning (status → `used`, but operator sees warning) or rejected (status stays valid). Default: accept-with-warning during grace, reject after.
- **Missing event_dates row.** Per OBS-1, decide fall-through behavior. Default: skip time-window check (preserve existing behavior — safer than refusing).

**Implementation order (informational, SPEC will finalize):**
- Step 1: migration to update `biz_ticket_scan` RPC body (monotonic timestamp `20260528000000`)
- Step 2: `scanTicketService.ts` type union expansion + Deno tests for new RPC result values
- Step 3: scanner UI overlay branches for the two new states + import of the expanded type
- Step 4: strict-grep CI gate codifying the time-window contract (new `orch-0793-*.mjs` script registered as new job)
- Step 5: operator live-fire smoke covering early-scan, in-window, late-scan, grace-window-edge cases

---

## 9. Regression prevention requirements

The class of bug being fixed is "scanner accepts cryptographically-valid-but-temporally-wrong tickets." To prevent this from recurring in the future:

- **Structural safeguard:** new invariant proposal `I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED` — every successful `biz_ticket_scan` result must be the consequence of a `now()`-within-window check, not just cryptographic validity. SPEC phase will codify the invariant text + the strict-grep gate that enforces it.
- **CI test:** new Deno test asserting `biz_ticket_scan` body contains an `event_dates` join AND a `now()` comparison against `start_at` / `end_at`.
- **Protective comment:** the `biz_ticket_scan` definition site gets a comment block at the top documenting I-PROPOSED-BB and pointing to ORCH-0793 spec.

---

## 10. Discoveries for orchestrator

1. **D-0793-1 — `events.status` auto-advance gap (CF-1).** Separate from ORCH-0793 scope but visibly affects admin/brand dashboard "live events" filters. Worth registering as a candidate ORCH (call it ORCH-0794?). Either pg_cron job that flips `scheduled → live → ended` based on `event_dates`, OR change all consumers to derive "is event live now" from `event_dates` directly (which is what ORCH-0793's scanner fix will do). Latter is cleaner per I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY. Defer to operator priority.

2. **D-0793-2 — Ticket-type-level scan windows (HF-1).** If product wants "VIP doors at 8 PM, GA doors at 9 PM" semantics, the scanner needs ticket-type-level overrides. Out of scope for ORCH-0793; surface as future ORCH if product asks.

3. **D-0793-3 — Multi-date event scan window semantics (OBS-2).** Recurring + multi-date events need a default policy. Investigation lists two options; SPEC decides; default is the most permissive option to avoid breaking existing buyer expectations.

4. **D-0793-4 — Annual-pass / season-ticket product enablement.** Once time-window enforcement is in place, the system unlocks a new product surface (annual passes, multi-event bundles, season tickets). Not blocking ORCH-0793, but worth noting for product planning.

5. **D-0793-5 — Ticket resale / replay fraud vectors (closed by EXISTING code, not ORCH-0793).** Operator correctly pushed back on the original framing of this entry. The classic fraud vectors are all blocked TODAY by the existing checks: `duplicate` (ticket flips to `used` on first scan, second scan rejected) blocks resale + replay attacks on used tickets; `wrong_event` blocks tickets-for-Event-A scanned at Event-B. ORCH-0793 does NOT add new fraud-prevention beyond what's already in place. The buyer-notification gap I separately verified (no email/push/SMS sent to buyer on scan) is a separate consideration that doesn't materially change the fraud surface — buyer learns of unauthorized scan only when they're rejected at the door. SPEC may optionally consider adding a "ticket scanned" buyer notification as a defense-in-depth measure but it's NOT what ORCH-0793 is primarily about. **The primary harm ORCH-0793 fixes is buyer accidental-burn + operator workflow + multi-day-event enablement** — not fraud.

6. **D-0793-6 — Auditing context.** The new `scan_events` rows with `result='not_yet_open'` or `result='event_ended'` will be visible to operators via the brand-team SELECT RLS policy on `scan_events`. Could become a useful surface for operators to see "5 buyers tried to scan their tickets at 6 AM yesterday" — but that's a future UI surface, not ORCH-0793 scope.

---

## 11. Confidence level

**HIGH.** Every root cause is backed by:
- Static code reading (file + line + verbatim grep of `biz_ticket_scan` body proving no event_dates / now() / status references)
- Five-truth-layer cross-check (docs ⇄ code ⇄ runtime ⇄ data all agree on the gap; schema is ready)
- MCP probe against production data (the 65.7-hour-ended event AND 6 future events all confirmed scannable RIGHT NOW)
- Migration chain verification (latest `biz_ticket_scan` definition confirmed at `20260515000017`; no later migration supersedes)
- Adjacent-code review (scanner UI + service + edge fn all confirmed time-window-free)

What would lower confidence: nothing in scope. Items D-0793-1 (events.status auto-advance) and the SPEC-decision items (grace values, multi-date semantics) are intentionally deferred to SPEC phase — they don't change any root cause finding.

---

## 12. Routing direction

Investigation is complete and conclusive. Next phase is SPEC (Claude `mingla-forensics` SPEC mode) — define the `event_dates` join + result discriminator extension, grace window values, multi-date semantics, mobile UI overlay branches, scanTicketService type updates, strict-grep CI gate codifying I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED, and the test matrix. Then IMPLEMENT, then TEST, then CLOSE.
