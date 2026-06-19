# INVESTIGATE — ORCH-1138 Experience Reservation Intelligence

**Mode:** INVESTIGATE (read-only). Ground the proposed adaptive experience "Reserve" + date-picker
design in the real data model.
**Date:** 2026-06-15 · **Anchor checkout** (`main`, fetched; HEAD includes merged ORCH-1138 `0fd6f39c4`).
**Scope:** truth + buildability assessment + gap naming ONLY. No spec, no code, no fix proposed.

> COMMS on entry: scanned `COMMS_LEDGER.md` active table — no `BLOCK`+`OPEN` row addressed to
> `mingla-forensics` or `ORCH-1138`. Relevant WARN context only: COMMS-0018 (experiences supply via
> `pg_eligible_experiences_for_deck`/`discover-cards`, NOT the place_pool/ai_signal path). Factored
> in; no ack required (WARN to other ORCHs).

---

## TL;DR VERDICT

The adaptive **Reserve + date-picker is ALREADY BUILT and shipping** on the consumer deck
(ORCH-1072), and it is buildable on the EXISTING data model with **no schema change** — EXCEPT for
one class of experience: **`recurring`**. The single-vs-picker signal, the per-slot payload, and the
checkout plumbing all exist. The one real gap:

> **GAP — recurrence is never materialized into bookable `event_dates` rows.** Both the publish RPC
> and the live-edit RPC treat `whenMode='recurring'` IDENTICALLY to `single`: they write exactly ONE
> master `event_dates` row (the first date) and store the `recurrence_rules` jsonb + `is_recurring`
> flag for DISPLAY only. The rule is never expanded server-side. So a "heavily-recurring" experience
> has exactly ONE bookable slot in the data, the picker has nothing to list beyond that one date, and
> a buyer can never reserve the 2nd…Nth occurrence. The expander
> (`expandRecurrenceToDates`, 52-cap) exists ONLY client-side in the business app, for authoring
> summaries — it is NOT consumed by any read path, the consumer app, or any server function.

Everything else (single, multi_date) is fully picker-ready on existing data.

---

## Q-SCORECARD

### Q1 — How is an experience's schedule / "When" stored and authored?

**Verdict (proven, source + live DB):** Three author modes — `single`, `multi_date`, `recurring` —
keyed off `events.whenMode` in the payload, persisted as the boolean pair
`events.is_recurring` / `events.is_multi_date` plus a `recurrence_rules` jsonb. The actual bookable
schedule lives as rows in **`public.event_dates`** (`start_at`, `end_at`, `timezone`, `is_master`,
plus title/desc/location overrides — see live schema below). Timezone is per-row + on the event.

- Author modes + validation:
  `supabase/migrations/20260825000000_meta_orch_1059_sub_b_publish_experience.sql:277-287`
  (`v_when_mode := COALESCE(... 'single')`; `IF p_publish AND v_when_mode NOT IN
  ('single','multi_date','recurring') THEN RAISE 'event_date_required'`).
- Flags + rule persisted on the event row (publish): same file `:299-301`
  (`is_recurring = v_is_recurring, is_multi_date = v_is_multi_date, recurrence_rules =
  v_recurrence_rules`). Same on live-edit:
  `supabase/migrations/20260902000000_meta_orch_1059_sub_e_update_live_experience.sql:493-495`.
- **Materialization of bookable rows (publish, PUBLISH-only — I-4):** same Sub-B file `:395-465`.
  - `single` AND `recurring` → **ONE** master row: `:400-414`
    (`IF v_when_mode IN ('single','recurring') THEN … INSERT INTO public.event_dates (…) VALUES
    (p_event_id, v_start, v_end, v_timezone, true)`).
  - `multi_date` → one row per supplied date: `:416-451`.
- **Materialization on live-edit** mirrors this — `recurring` collapses to a single-element array:
  `..._sub_e_update_live_experience.sql:396-409`
  (`IF v_when_mode IN ('single','recurring') THEN … v_new_date_starts := ARRAY[v_start]`),
  multi_date loop `:410-435`, then `DELETE … event_dates` + re-insert `:573-…`.
- **`event_dates` live schema** (prod introspection, project `gqnoajqerqhnvulmnyvv`):
  `id, event_id, start_at, end_at, timezone, is_master, override_title, override_description,
  override_location, created_at, updated_at`. **No capacity column.**
- **Consumer/public read paths return:**
  1. Consumer deck (RN): `pg_eligible_experiences_for_deck` returns `upcoming_occurrences` jsonb (the
     materialized future `event_dates`, ≤12) —
     `supabase/migrations/20260908000000_orch_1072_experience_detail_cover_availability.sql:69,243-277`.
  2. Web public page: `publicExperienceService` reads `event_dates` directly
     (`mingla-business/src/services/publicExperienceService.ts:277` — `.from("event_dates")`),
     maps to a `dates[]` array `:237-243`, derives `whenMode` from the flags `:223-226`, and surfaces
     `recurrenceRule` (first rule, DISPLAY-only) `:227`.

### Q2 — Per-slot capacity: is there remaining-capacity per date/slot?

**Verdict (proven):** There is remaining capacity, but it is **EVENT-LEVEL, not per-occurrence**.
The schema has exactly ONE sellable `ticket_types` row per experience (I-1 ONE-TICKET); `event_dates`
has no capacity column (confirmed live). The deck RPC computes `remaining = quantity_total − sold`
(sold = `tickets.status IN ('valid','used','transferred')`; `NULL` ⇒ unlimited) and stamps the SAME
event-level value onto EVERY occurrence in `upcoming_occurrences`.

- Per-occurrence payload shape:
  `..._orch_1072_…availability.sql:247-277` — each element is
  `{ event_date_id, start_at, end_at, capacity, sold, remaining }`, but `capacity/sold/remaining`
  come from the single `eligible.ticket_*` event-level subqueries `:128-175`, joined onto every
  `event_dates` row `:261-273`.
- The migration is explicit about this being deliberate, not a fabricated per-slot cap: `:19-28`
  ("per-EVENT, not per-occurrence … there is no per-occurrence cap in the schema, so we do NOT invent
  one"). Matches `pg_public_ticket_types_remaining` (ORCH-0946) + `biz_experience_sold_count`.
- **So a picker CAN show "N left" per slot — but every slot shows the SAME N** (the event-wide
  remaining). `remaining = NULL` ⇒ unlimited (never sold-out); `remaining = 0` ⇒ that occurrence
  renders disabled.

### Q3 — Detecting "needs a picker": single-slot vs multi-slot/recurring signal

**Verdict (proven — the signal already exists and ships):** Drive off the COUNT of **bookable**
upcoming occurrences (future + not sold-out), NOT off `is_recurring`/`whenMode`. The consumer deck
already does exactly this:

- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`:
  - occurrences = `data.upcomingOccurrences` (from the RPC) `:236-243`;
  - `bookableOccurrences` = filter `remaining === null || remaining > 0` `:246-247`;
  - `beginBooking` `:439-...`: **`> 1` → open picker** `:442`; **`=== 1` → auto-select + skip to cart**
    `:447-448`; **`0` (events/trips, or experience whose supply carried no dates) → straight to cart**.
- This is the right signal because it is robust to whenMode: a `multi_date` with one future date
  behaves like `single`; a `single` whose date passed shows 0; a recurring (today) always shows 1.
- Web path has the equivalent raw material (`dates[]` from `publicExperienceService`) but does NOT
  yet implement the count-driven picker the same way (web is the not-yet-parity surface — see Gap §B).

### Q4 — Recurring reality: concrete rows or a rule to expand?

**Verdict (proven — THE GAP):** For a recurring experience, future slots are **NOT** concrete rows.
Only ONE master row is materialized; the rest exists solely as the `recurrence_rules` jsonb, which is
never expanded into `event_dates` by any server path.

- Single-row materialization for `recurring`: Sub-B `:400-414`, Sub-E `:396-409` (cited Q1).
- The expander is client-only + display-scoped:
  `mingla-business/src/utils/recurrenceRule.ts:185-...` (`expandRecurrenceToDates`, `HARD_CAP = 52`,
  `:176`). Grep confirms **zero** consumers in `app-mobile/src`, **zero** in any edge function, and in
  the business app it's used only for authoring summaries (`eventDateDisplay.ts:306-409`,
  "Repeats every Monday · 12 dates").
- No server-side materializer / cron / `generate_series` expands recurrence into bookable rows
  (grepped `supabase/functions` + `supabase/migrations` for materialize/expand/next_occurrence — only
  the single-row writers + the `theme.experience_meta.next_occurrence_at` string stamp at Sub-B
  `:454-464`, which is a display hint, not a bookable row).
- **Live DB confirmation** (prod): of the recurring experiences present, max materialized
  `date_rows = 1` (one had `future_rows = 1`, one had `date_rows = 0`); `has_rule = true` on both. A
  recurring experience never carries more than its single master row.
- **What's needed to surface upcoming bookable instances for recurring:** expand
  `recurrence_rules` (preset + byDay/byMonthDay/bySetPos + termination count/until/never) from the
  master date into N future `event_dates` rows — either (a) materialize at publish/edit time (bounded,
  e.g. the existing 52-cap or a rolling window) so every read path + checkout's
  `event_dates`-FK validation works unchanged, or (b) a rolling cron top-up for `never`-ending rules.
  This is the gap that blocks a REAL reservation picker for recurring; single + multi_date need
  nothing new.

### Q5 — Checkout path: optional `event_date_id` already threaded?

**Verdict (proven):** Yes — `ticket-checkout-create` already accepts an optional `eventDateId`,
validates it, and threads it byte-compatibly into the cart/session/ticket.

- Parsed optional, defaults null:
  `supabase/functions/ticket-checkout-create/index.ts:237-239`.
- Validated against `event_dates` (must belong to this event + still future, else 422
  `occurrence_not_found` / `occurrence_not_available`) — gated entirely on `eventDateId !== null`, so
  the null path is unchanged: `:306-334`.
- Carried into Stripe session metadata `:528-533` (`event_date_id`) and ticket metadata `:1587`
  (`mingla_event_date_id`).
- Consumer sheet sends it when a slot is chosen:
  `ExpandedBusinessEventSheet.tsx:348-352` (`? { eventDateId: selectedEventDateId } : {}`).
- Locked by tests: `…/__tests__/orch1072_experience_occurrence_checkout.test.ts:38-56`.

---

## FIVE-TRUTH-LAYER RECONCILIATION

| Layer | Finding |
|-------|---------|
| **Docs** | ORCH-1072 migration header (`…availability.sql:7-34`) states the operator-locked intent: "PICK FROM UPCOMING DATES; a one-off single-date experience skips date-picking; sold-out occurrences disabled" + capacity is per-EVENT. Matches code. |
| **Schema** | `event_dates`: id/event_id/start_at/end_at/timezone/is_master/overrides — **no capacity col**. `events`: is_recurring, is_multi_date, recurrence_rules jsonb. One sellable `ticket_types` row (I-1). |
| **Code** | Publish + live-edit RPCs materialize 1 row for single/recurring, N for multi_date. Deck RPC emits ≤12 future occurrences w/ event-level remaining. Checkout validates optional event_date_id. Consumer sheet drives picker off bookable-count. Web service reads raw `event_dates`. |
| **Runtime** | (Not live-fired — backend/data investigation, exempt per Prime Directive 7.) Read-only prod SQL only. |
| **Data** | Prod: recurring experiences carry ≤1 materialized `event_dates` row despite `recurrence_rules` present → CONTRADICTION with the "recurring = many slots" author intent. **This gap IS the bug for recurring.** |

**Flagged contradiction:** Docs/author UX promise recurring = repeats N times; Schema/Data deliver
exactly one bookable row. Schema+Data hold the truth; the recurrence rule is decorative for booking.

---

## BLAST RADIUS / CROSS-SURFACE

- **Consumer iOS/Android (`app-mobile`):** picker fully built + shipping (ORCH-1072). For recurring,
  it correctly shows the 1 materialized slot only (auto-selects, no picker) — not broken, just
  under-supplied.
- **Buyer/anon Web (`mingla-business` public experience page):** has the raw `dates[]` + recurrence
  rule but no count-driven adaptive picker parity (separate read/render path). Manual-parity surface.
- **Business iOS/Android (authoring):** stores recurrence rule + client-expands for display; does NOT
  drive any bookable materialization.
- **Admin / Business-web-preview:** not implicated.

## INVARIANT IMPACT (flagged, not resolved)

- **I-1 ONE-TICKET / ORCH-1006 all-in engine:** any per-occurrence capacity would violate the
  one-ticket spine — capacity stays event-level. A picker must NOT invent per-slot caps. (Flag only.)
- **I-4 (event_dates materialized at PUBLISH):** any recurrence-expansion fix must hang off the same
  publish/edit materialization point to keep checkout's `event_dates`-FK validation honest.

## DISCOVERIES FOR ORCHESTRATOR

1. **Recurrence-materialization gap** (above) is the single buildability blocker for a real recurring
   reservation picker. Independent of ORCH-1138's picker UX — it's a supply gap.
2. **Web vs consumer picker parity:** web public experience page does not implement the
   bookable-count adaptive picker that the consumer deck does — a parity item if ORCH-1138 targets web.
3. **`date_rows = 0` recurring experience exists in prod** (one row) — either a draft never published
   or a past experience; worth a data check but not in scope here.

## CONFIDENCE

**proven** — source traced across publish RPC, live-edit RPC, deck supply RPC, web service, checkout
edge fn, consumer sheet, recurrence util, plus live prod schema + data confirmation. Backend/data
investigation (no sim live-fire required per Prime Directive 7 exemption).

## RECOMMENDED NEXT PHASE (direction only — NOT a fix)

SPEC-able now for **single + multi_date** with zero schema change (the picker, signal, per-slot
payload, and checkout already exist; mainly UX/copy + web parity). The **recurring** path needs the
recurrence-materialization gap closed first (expand `recurrence_rules` → bounded future `event_dates`
rows at publish/edit, optional rolling top-up for `never`) — decide whether ORCH-1138 absorbs that or
spawns a sibling. The single-vs-picker driver is settled: **count of bookable upcoming occurrences**
(`remaining === null || remaining > 0`), `>1` → picker, `===1` → auto-select, `0` → direct.
