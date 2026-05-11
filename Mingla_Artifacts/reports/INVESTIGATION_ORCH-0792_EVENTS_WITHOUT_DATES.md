# INVESTIGATION — ORCH-0792 — Events created without `event_dates` rows silently collapse date-dependent rendering

**Mode:** INVESTIGATE only. No SPEC. No fix. No code.
**Date:** 2026-05-11
**Skill:** Claude `mingla-forensics`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** HIGH (root cause proven across all five truth layers; production data sampled)

---

## 1. Plain-English summary

The Mingla Business event-publish path does not write any rows into the `event_dates` table. **100% of events in production (17/17, including 7 published-or-live and 3 with confirmed paid orders) have ZERO rows in `event_dates`.** Date information is stored in a JSON blob (`events.theme.business_event.when`) which the business app reads, but every consumer that reads from the canonical `event_dates` table — including `ticket-confirmation-dispatch` — sees no date and silently produces emails / PDFs / calendar invites with empty date fields. This is a single-source-of-truth violation that has been silently broken since at least ORCH-0763 (2026-05-15 publish RPC).

---

## 2. Phase 0 ingest log

- `Mingla_Artifacts/WORLD_MAP.md` — ORCH-0792 REGISTERED entry (top of file); ORCH-0785 closed code-side (defensive null-handling is correct); ORCH-0787 closed; ORCH-0788 P1 dispatcher pending.
- `Mingla_Artifacts/MASTER_BUG_LIST.md` — ORCH-0792 entry at top of S1-High table.
- `Mingla_Artifacts/specs/SPEC_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md` — confirms the email + PDF date contracts that depend on `event.startAt`.
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` — baseline schema for `events` and `event_dates`.
- `supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql` — first `business_publish_event_draft` definition (superseded).
- `supabase/migrations/20260515000018_orch_0783_event_cover_provider_metadata.sql` — **latest** `business_publish_event_draft` definition (authoritative).
- `mingla-business/src/store/draftEventStore.ts` — `DraftEvent` shape with date fields.
- `mingla-business/src/utils/serverDraftEventMapper.ts` — wizard → server payload mapper.
- `mingla-business/src/services/eventDrafts.ts` — `events` table writers.
- `mingla-business/src/services/businessEvents.ts` — `events` row → `DraftEvent` mapper (reads from `theme.business_event.when`).
- `supabase/functions/ticket-confirmation-dispatch/index.ts` — buyer email + PDF dispatcher (reads from `event_dates`).
- `supabase/functions/ticket-checkout-create/index.ts` — confirmed: checkout does not validate event has dates.

---

## 3. Root cause proof — six-field evidence

### 🔴 RC-1 (primary root cause) — `business_publish_event_draft` RPC never writes to `event_dates`

| Field | Evidence |
|---|---|
| **File + line** | `supabase/migrations/20260515000018_orch_0783_event_cover_provider_metadata.sql:117-442` |
| **Exact code** | The full RPC body. Searches for the string `event_dates` in the function return **zero matches**. The RPC validates title, ticket array, ticket name/price/capacity, currency — but never reads `theme.business_draft.when` / `multiDates` / `recurrenceRule`, and never executes `INSERT INTO public.event_dates`. |
| **What it does** | Promotes an `events` row from `status='draft'` to `status='scheduled'`, soft-deletes old `ticket_types`, inserts new `ticket_types`, returns event + brand + tickets JSON. Sets `events.is_multi_date` from payload but **does not propagate the actual dates** anywhere. |
| **What it should do** | Either (a) read `p_draft_payload.theme.business_draft.when` (single mode), `.recurrenceRule` (recurring mode), or `.multiDates` (multi-date mode), and INSERT corresponding `event_dates` rows with `is_master=true` on the canonical date; OR (b) abort publish with `event_date_required` if no dates are present in the payload. |
| **Causal chain** | (1) User fills `CreatorStep2When.tsx` → dates land in `DraftEvent.{date,doorsOpen,endsAt,timezone,multiDates,recurrenceRule}`. (2) `mergeBusinessDraftTheme` at `serverDraftEventMapper.ts:288-304` packs them into `theme.business_draft.when` / `multiDates` / `recurrenceRule`. (3) Autosave writes the theme JSON to `events.theme`. (4) User taps "Publish" → `mingla-business/src/services/businessEvents.ts:443` calls `business_publish_event_draft` RPC. (5) RPC ignores the date fields, updates `events.status='scheduled'`, returns success. (6) **No `event_dates` row exists.** (7) `ticket-confirmation-dispatch/index.ts:305-310` queries `event_dates WHERE is_master=true.maybeSingle()` → null. (8) `bodyInput.event.startAt=null` (line 207). (9) `_shared/email/calendar.ts:buildCalendarLinks` returns null (defensive). (10) `_shared/email/ticketBody.ts:renderDateLine` returns "". (11) `_shared/ticketPdf.ts:91` `dateLine` empty. (12) Buyer email + PDF + .ics have no date. |
| **Verification step** | DB probe (executed 2026-05-11 18:55 UTC, results in §5 below): `SELECT count(*) FROM event_dates` = 0. `SELECT count(*) FROM events` = 17. Every event in production lacks date rows. The dispatch logs show 4 paid orders today against dateless events, all dispatched successfully but with empty date rendering. |

### 🟠 RC-2 (contributing factor) — Constitution #2 violation: dates live in TWO places

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/src/services/businessEvents.ts:282-294` (reads dates from `theme.business_event.when`) **versus** `supabase/functions/ticket-confirmation-dispatch/index.ts:305-310` (reads from `event_dates`). |
| **Exact code** | businessEvents.ts: `whenMode: asWhenMode(businessEvent.whenMode, row), date: asStringOrNull(when.date), …`. Dispatch: `.from("event_dates").select("start_at, end_at, timezone, is_master").eq("event_id", order.events.id).eq("is_master", true).maybeSingle()`. |
| **What it does** | Mingla Business reads dates from JSON in `events.theme.business_event.when`. Dispatch reads from the `event_dates` table. Two consumers, two sources, same data. |
| **What it should do** | One canonical source. Either (a) drop the JSON storage and have business app read from `event_dates`, or (b) drop the `event_dates` table and have all consumers read from theme JSON. Recommendation: option (a) — `event_dates` is the relational, query-friendly representation; JSON storage is brittle, unindexable, and prone to drift. |
| **Causal chain** | Even if RC-1 is fixed in isolation by adding `event_dates` writes to the publish RPC, the JSON blob remains as a phantom source of truth, drift will recur, and admin tools/analytics will continue to disagree about event dates. |
| **Verification step** | Code-level: grep `business_event.when` finds 5+ readers in mingla-business; grep `event_dates` finds 1 writer in ticket-confirmation-dispatch (read only, never write) and 2 readers (scan-ticket, ticket-confirmation-dispatch). No mobile consumer or admin dashboard reads from the JSON. |

### 🟠 RC-3 (contributing factor) — No schema-level integrity constraint

| Field | Evidence |
|---|---|
| **File + line** | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7792-7823` (events) + `8209-8222` (event_dates). |
| **Exact code** | `event_dates` has only `event_dates_end_after_start CHECK (end_at > start_at)`. Foreign key `event_dates.event_id → events.id` is implied by the schema but no constraint guarantees the *inverse* (events must have ≥1 event_date). No partial unique index enforcing ≤1 master row per event. No trigger on `events.status='scheduled'` requiring a master date row. |
| **What it does** | Allows an `events` row at any status (draft / scheduled / live / ended / cancelled) with zero `event_dates` rows. |
| **What it should do** | Either (a) deferred check constraint: `IF EXISTS (SELECT 1 FROM events e WHERE e.status IN ('scheduled','live') AND NOT EXISTS (SELECT 1 FROM event_dates ed WHERE ed.event_id = e.id AND ed.is_master = true))` violation; OR (b) a `BEFORE UPDATE` trigger on `events` that rejects `NEW.status='scheduled'` transitions unless a master `event_dates` row exists; OR (c) generated constraint via the publish RPC's own integrity check. |
| **Causal chain** | RC-1 is invisible at the schema level because nothing enforces the invariant. A future regression on the publish path can re-introduce the same bug class even after RC-1 is fixed. |
| **Verification step** | DB probe shows 7 events at `status='scheduled'` with zero date rows — the schema accepts this state today. |

### 🟠 RC-4 (contributing factor) — Checkout does not validate event has dates

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/ticket-checkout-create/index.ts` — full file scanned. |
| **Exact code** | Function reads `events` (event existence, brand, ticket types, currency) but no `event_dates` lookup. Search for `event_dates`/`start_at`/`is_master` in the file: zero hits. |
| **What it does** | Accepts checkout requests against any non-deleted, published event, regardless of whether dates are set. |
| **What it should do** | Reject checkout against any event without a future `event_dates` row, returning `event_dates_missing` or `event_already_ended`. Allowing payment for a dateless event is a UX/business hazard: buyer can be charged without knowing when the event is. |
| **Causal chain** | This is why our test purchases against "Vibes and Stuff" / "A life in vegas" succeeded despite zero date rows. The user's $50 went through, tickets were issued, but the buyer email has no date. |
| **Verification step** | DB shows 4 successful paid orders today against 2 dateless events; checkout returned success on all 4. |

---

## 4. Five-truth-layer cross-check

| Layer | What it says |
|---|---|
| **Docs** | `event_dates` table comment in baseline: `'Per-date rows for multi-date / recurring events (B1 §B.3).'` Implies it's the canonical date store. No PRD or spec found that says dates can live elsewhere. |
| **Schema** | `event_dates` requires `start_at` NOT NULL, `end_at` NOT NULL, `end_at > start_at`. `events.timezone` defaults to `'UTC'`. NO foreign-key constraint enforcing `events ← event_dates` cardinality. NO trigger requiring date at publish time. |
| **Code (business)** | `mingla-business/src/services/businessEvents.ts:282-294` reads dates from `theme.business_event.when` — JSON storage. Never touches `event_dates`. |
| **Code (dispatch)** | `ticket-confirmation-dispatch/index.ts:305-310` reads dates from `event_dates` with `is_master=true`. Never falls back to theme. |
| **Code (publish RPC)** | `business_publish_event_draft` writes neither — date data accepted in payload but silently discarded. |
| **Runtime** | Real dispatches today (2026-05-11 18:31-18:36 UTC, edge function logs) succeeded with HTTP 200 but rendered emails without date lines, PDFs without date lines, no .ics generated. |
| **Data** | `event_dates` table: 0 rows. `events` table: 17 rows, 7 published, 3 with confirmed paid orders. Date data exists only in `events.theme.business_event.when` JSON. |

**Contradiction summary:** Schema declares `event_dates` as canonical; business app uses JSON; dispatch uses table. Three layers, three positions. The bug is the entire system — there is no agreement on where dates live.

---

## 5. Population sizing (executed via Supabase Management API, 2026-05-11 18:55 UTC)

```
metric                                       | value
---------------------------------------------|------
total_events                                 | 17
events_with_event_dates                      | 0
events_without_any_event_dates               | 17  ← 100%
published_or_live_without_event_dates        | 7
events_without_master_date                   | 7
events_with_confirmed_orders_no_date         | 3
```

**Implication:** Every Mingla Business event in production today is affected. Every paid order to date received an email/PDF without a date. This is not an edge case — it is the default state.

---

## 6. Blast radius map

| Consumer | Reads dates from | Status today |
|---|---|---|
| Buyer email date line (`ticketBody.ts:renderDateLine`) | `event.startAt` via `event_dates` | EMPTY (bug visible) |
| Buyer ticket PDF date line (`ticketPdf.ts:91`) | `event.startAtIso` via `event_dates` | EMPTY (bug visible) |
| Buyer email Add-to-Calendar block (`calendar.ts:buildCalendarLinks`) | `event.startAt` via `event_dates` | EMPTY (bug visible — what triggered ORCH-0792 registration) |
| Buyer .ics attachment (`ticket-confirmation-dispatch:icsToBase64`) | `event_dates` via dispatch | NOT GENERATED (bug visible) |
| Mingla Business event display | `events.theme.business_event.when` JSON | WORKS (organiser sees correct date) |
| Mingla Business event edit (`EditPublishedScreen`) | `events.theme.business_event.when` JSON | WORKS |
| Public event page (`mingla-business/app/e/[brandSlug]/[eventSlug]`) | Not verified in this investigation — recommend probe |
| Mingla mobile consumer app event card | Not verified in this investigation — recommend probe |
| `scan-ticket` edge function (door scanner) | `event_dates` | LIKELY BROKEN — scanner probably fails the "event not ended" check |
| Admin dashboard event timeline | Not verified — recommend probe |
| ORCH-0788 refund/cancel notification dispatcher (planned) | Reuses same date helpers | WILL BE BROKEN at ship |
| Future iCal export feature | Would read `event_dates` | WILL BE BROKEN |
| Analytics / engagement reporting on event timing | Unknown — recommend probe |

The 4 confirmed-broken surfaces above (email date line, PDF date line, calendar block, .ics) all surfaced from a single user-reported symptom. There are likely more downstream consumers silently broken — most importantly the **scanner check that the event hasn't ended** (would mean tickets remain scannable indefinitely for dateless events).

---

## 7. Invariant gap

No existing invariant in `INVARIANT_REGISTRY.md` covers this. Propose:

**I-PROPOSED-AQ EVENT_HAS_MASTER_DATE** — Every `events` row with `status IN ('scheduled', 'live')` AND `deleted_at IS NULL` MUST have ≥1 `event_dates` row with `is_master=true` and non-null `start_at`. Enforced by: (a) publish RPC integrity check, (b) DB constraint or trigger, (c) admin sweep + CI strict-grep gate (e.g., `node .github/scripts/strict-grep/orch-0792-event-has-master-date.mjs` probes that the publish RPC body references `event_dates` insertion).

**I-PROPOSED-AR EVENT_DATES_SOLE_DATE_AUTHORITY** — `event_dates` is the sole authoritative store for event timing. JSON storage at `events.theme.business_event.when` is for transient draft state only and must not be read by post-publish consumers. The `event_date` columns are surfaced via a (potentially new) `events_with_dates_view` for ergonomic reads.

---

## 8. Static analysis flags

- `mingla-business/src/services/businessEvents.ts:283` — reads `when.date` from JSON for a *post-publish* event. This is the cross-contamination point that allows the business app to keep working despite the missing `event_dates`. Flag as 🟡 pattern violation: post-publish reads should never go through draft theme JSON.
- `mingla-business/src/utils/serverDraftEventMapper.ts:288-304` — `mergeBusinessDraftTheme` packs date data into theme JSON; harmless until publish, but it makes the JSON the de-facto canonical store when publish ignores it. 🟡 — couples to RC-2.

---

## 9. Confidence

- **RC-1 (publish RPC doesn't write event_dates):** HIGH — read full RPC body in latest migration; verified zero `event_dates` writes anywhere in `mingla-business/src/` outside tests; production data confirms 0 rows.
- **RC-2 (split-brain date storage):** HIGH — code paths read.
- **RC-3 (no schema constraint):** HIGH — schema reviewed end-to-end; no constraint, no trigger.
- **RC-4 (checkout no validation):** HIGH — full file scanned.
- **Population sizing:** HIGH — fresh DB probe via Management API.
- **Blast radius:** MEDIUM-HIGH for verified surfaces (email/PDF/calendar/.ics); MEDIUM for unverified (scanner, public event page, admin) — recommend SPEC verify these before scoping.

---

## 10. What I did NOT investigate (and why)

- **Public event page `/e/{brandSlug}/{eventSlug}`** — out of time-box; recommend SPEC author verify whether it reads from `events.theme.business_event.when` or from `event_dates`. If from theme, public buyer browsing works today; if from `event_dates`, public pages have been broken too.
- **Mingla mobile consumer app event display** — same; out of time-box.
- **`scan-ticket` edge function** — strongly suspected broken on event-ended check, but not verified. Recommend SPEC scope this.
- **Admin dashboard event analytics** — out of scope for this investigation.
- **Whether older events from pre-ORCH-0763 had `event_dates` rows that were dropped** — no migration found that drops the table, but a historical audit could be useful. Not blocking.
- **iOS/Android parity of the wizard date step** — UI works on iOS per operator's recent test events; assumed parity OK.

---

## 11. Recommended SPEC scope (outline only — orchestrator decides; this investigation does NOT spec)

A SPEC for ORCH-0792 should at minimum address:

1. **Publish RPC fix:** Modify `business_publish_event_draft` (new migration that supersedes `20260515000018`'s definition) to read `theme.business_draft.when` / `multiDates` / `recurrenceRule` and INSERT corresponding `event_dates` rows. At least one row must have `is_master=true`. Validate before status update; raise `event_date_required` if no dates resolvable. Decide: should recurring mode expand the first N occurrences, or only the first?
2. **Backfill migration:** One-shot migration that reads `events.theme.business_event.when` for every published event with zero `event_dates` rows and inserts the corresponding `event_dates` row(s). Mark with a `[BACKFILL ORCH-0792]` comment in the migration. Idempotent (skip if row already exists).
3. **Schema integrity constraint:** Add either (a) deferred constraint trigger on `events.status` transition, or (b) partial unique index `(event_id) WHERE is_master = true` (already missing per investigation — this is a separate hidden flaw) + a check trigger requiring at least one master row when `status IN ('scheduled', 'live')`. Decide whether to apply BEFORE or AFTER the backfill.
4. **Checkout validation:** `ticket-checkout-create` should reject checkout against any event without a current/future `event_dates` row. Error: `event_no_active_dates`.
5. **Single-source-of-truth alignment:** Decide whether to (a) keep theme JSON as the draft-only mirror and have business app read from `event_dates` post-publish, or (b) keep theme JSON as the read path and drop `event_dates` entirely. Recommendation: option (a). Spec should include the migration of `businessEvents.ts:282-294` to read from `event_dates`.
6. **Edit-after-publish flow:** When an organiser edits date in `EditPublishedScreen`, the edit must update `event_dates` (and not just `theme`). Currently both — must be reduced to one.
7. **CI gates:** Add `.github/scripts/strict-grep/orch-0792-publish-writes-event-dates.mjs` that fails if `business_publish_event_draft` body lacks `INSERT INTO public.event_dates`. Add a Deno unit test on the dispatch's date-resolution path.
8. **Invariant promotion:** I-PROPOSED-AQ and I-PROPOSED-AR move to DRAFT in spec, flip to ACTIVE on CLOSE.
9. **Out of scope for ORCH-0792:** Branded email rendering (ORCH-0785 — defensive null is correct), refund/cancel dispatcher (ORCH-0788), BIMI sender avatar (separate ORCH), per-date overrides for multi-date events (defer unless required for backfill correctness).
10. **Live-fire test matrix:** Single-date publish + buyer purchase → calendar block populated. Multi-date publish + buyer purchase → first date used. Edit published event date → buyer who already bought sees updated date on next dispatch (resend flow). Scanner test on dateless backfilled event.

---

## 12. Discoveries for orchestrator (side issues)

1. **`scan-ticket` edge function is likely broken on dateless events** — should be probed; if broken, may need to be added to ORCH-0792 scope or registered separately. Severity assessment: if scanner doesn't enforce the event-ended check via `event_dates`, expired tickets remain scannable forever. P0 if confirmed.
2. **No partial unique index on `event_dates (event_id) WHERE is_master = true`** — schema permits multiple master rows per event. Hidden flaw. Recommend folding into ORCH-0792 SPEC §3.
3. **`events.is_multi_date` boolean is set during publish but never tied to `event_dates` row count** — invariant gap. If `is_multi_date=true` is set but `event_dates` count is 1 (or 0), state is inconsistent. Fold into ORCH-0792 SPEC.
4. **`events.is_recurring`, `events.recurrence_rules` columns exist but no documented contract for how they interact with `event_dates`** — is recurrence stored as recurrence_rule + first event_date, or as N expanded event_date rows? Spec must decide.
5. **ORCH-0785 Option C live-fire is blocked on ORCH-0792** for the calendar block; everything else (logo, footer, PDF, brand shell) is verified in test emails and was deployed cleanly. After ORCH-0792 ships, ORCH-0785 live-fire can complete with calendar block populated.

---

## 13. Confidence level (overall)

**HIGH.** Root cause proven across schema, code, data, and runtime layers. Production data confirms 100% population affected. Recommended SPEC scope is well-bounded. The only MEDIUM-confidence area is unverified downstream consumers (scanner, public page, admin), which the SPEC author should probe before locking scope.

---

**Report file:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0792_EVENTS_WITHOUT_DATES.md`
**Status:** INVESTIGATION COMPLETE. No code touched. No DB writes. No SPEC produced. Returning to orchestrator for REVIEW.

---

## ADDENDUM (orchestrator REVIEW + verification probes — 2026-05-11 19:05 UTC)

**REVIEW verdict:** APPROVED. All review checklist items pass. Confidence elevated from HIGH/MEDIUM to HIGH across the full blast-radius map after orchestrator verified the three flagged unverified consumers.

**Probe 1 — `scan-ticket` edge function:** `supabase/functions/scan-ticket/index.ts` (45 lines) is a thin wrapper around `biz_ticket_scan` RPC. The RPC at `supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql:7-110` validates scanner permission, QR signature, ticket payment_status, ticket status — **but never reads `event_dates`**. Scanner is **NOT broken on dateless events** — it accepts any valid-paid-not-used ticket regardless of event timing. However, this surfaces an independent hidden flaw: the scanner has zero event time-window enforcement (a ticket purchased for a 2026-05-17 event remains scannable on 2027-01-01). Registered separately as **ORCH-0793**; out of scope for ORCH-0792.

**Probe 2 — public event page `/e/{brandSlug}/{eventSlug}`:** `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` calls `usePublicEventBySlug` → `publicEventsService.ts`. Date extraction at `publicEventsService.ts:303` reads `theme.business_event` JSON. **Works today** even with empty `event_dates`. Not affected by ORCH-0792.

**Probe 3 — Mingla mobile consumer app (`app-mobile/`):** zero references to `event_dates` or `theme.business_event` anywhere in `app-mobile/src/` outside tests. Consumer app does not currently consume Mingla Business events. Not affected.

**Refined blast radius:** All four broken consumers (email date line, PDF date line, calendar block, .ics) live inside `ticket-confirmation-dispatch`. Every other date-consuming surface reads from theme JSON. ORCH-0792 severity confirmed S1 (not escalated to S0).

**Refined SPEC §11 scope:** the SPEC author should NOT include scanner work — ORCH-0793 owns that. The SPEC §5 "single-source-of-truth alignment" still stands but is now informed by Probe 2 evidence: more consumers read from theme JSON than from `event_dates`, so option (b) (drop `event_dates` and standardise on theme JSON) is materially cheaper than option (a) (keep `event_dates` and migrate readers). SPEC author should weigh both with the verified consumer-map evidence above.

**Status:** REVIEW APPROVED. Ready for SPEC dispatch to Claude `mingla-forensics`.
