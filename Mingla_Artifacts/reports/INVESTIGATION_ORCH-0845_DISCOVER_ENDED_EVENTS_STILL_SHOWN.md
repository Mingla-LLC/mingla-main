# INVESTIGATION — ORCH-0845: Discover shows ended events under all filters

**Mode:** INVESTIGATE
**Skill:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Confidence:** `root cause proven` (six-field evidence + live DB probe + ghost-inventory count)
**Exemption used:** Prime Directive #7 exemption — pure backend / SQL / edge-function scope; no UI/runtime reproducer required.

---

## 1. Symptom summary (layman first)

**Operator report (verbatim):** "When an event ends, it still shows on the discover screen. The discover screen does not know that the event has ended and still shows up under all filters."

**Expected:** Once an event's master end time has passed, it should disappear from the consumer Discover feed regardless of which filter chip is selected ("All", "Tonight", "This week", category facets, etc.).

**Actual:** When no date chip is selected (the default "All" view, and any view whose filters don't pass a `localStartEndDateTime` to the edge function), the server returns events whose `event_dates.end_at` is already in the past. They render as if they were upcoming and accept taps that route into a checkout flow which has its own (different) past-event guard.

**User impact:** Buyers see and can tap on events that already happened. The card design implies the event is upcoming. This is misleading at best and a revenue-integrity risk at worst (a buyer can reach checkout for an ended event before the checkout screen's heuristic kicks in).

---

## 2. Phase 0 — Ingestion record

| Source | What it told us |
|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0839-A_DISCOVER_HARDENING.md` (lines 32, 51, 595) | The `end_at >= window.start` floor was introduced in ORCH-0839-A [Discover hardening] F-5, but ONLY inside the dated-chip code path. Spec text explicitly scopes the fix to "when a date window is active." Confirms ORCH-0845 is a real gap, not a regression. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` | Established the `dateWindowUtc !== null` branch + `event_dates!inner` switch. Did NOT add a baseline end-time floor for the no-window path. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` | Original ORCH-0824 [Business events in consumer Discover] introduced the merged endpoint; the SC matrix did not include an "ended events excluded" criterion. Gap dates back to the original spec. |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7821` | `events.status` CHECK is `('draft','scheduled','live','ended','cancelled')`. `ended` is a valid enum value. |
| `supabase/migrations/20260515000001_orch_0756b_event_draft_persistence.sql:16` | Comment on the status field: *"UI labels such as upcoming/past are derived client-side and must not be queried as DB statuses."* — Confirms `ended` is operator/admin terminal state, not a runtime auto-flip. |

---

## 3. Five-truth-layer evidence

### Layer 1 — Docs

The product contract is implicit: Discover shows *upcoming* events. No explicit clause says "exclude rows where end_at < now()" in any spec. ORCH-0839-A added the rule only for dated chips ("Tonight includes in-progress, excludes ended-before-window-start"). No PRD section forbids ended events on the All view.

**Verdict:** docs are silent on the no-window path → invariant gap.

### Layer 2 — Schema

Live DB probe via Supabase Management API:

```
events_status_check = CHECK ((status = ANY (ARRAY['draft','scheduled','live','ended','cancelled'])))
event_dates.end_at  = NOT NULL, CHECK (end_at > start_at)
```

Triggers on `events` (live probe via `pg_trigger`):
`biz_event_auto_provision_scanners_after_insert`, `trg_events_enforce_master_date`,
`trg_events_immutable_brand_id`, `trg_events_immutable_created_by`,
`trg_events_immutable_slug`, `trg_events_updated_at`,
`trg_require_event_brand_currency_insert`, `trg_require_event_brand_currency_update`.

Triggers on `event_dates`: only `trg_event_dates_immutable_event_id` and `trg_event_dates_updated_at`.

`cron.job` filter on `event%` returned only `orch_0558_match_telemetry_purge` (unrelated).

**Verdict:** `event_dates.end_at` is NOT NULL with a CHECK constraint — safe to filter on directly with no `COALESCE` fallback needed. There is NO trigger, NO pg_cron, and NO RPC that auto-transitions `events.status` to `'ended'` when `end_at` passes. The `ended` enum value exists but is only ever set by explicit operator action (cancel flow / manual edit). Therefore "ended" must be inferred at READ time from `event_dates.end_at < now()`.

### Layer 3 — Code

🔴 **Root cause** — [supabase/functions/discover-merged-events/index.ts:287-319](supabase/functions/discover-merged-events/index.ts#L287-L319) + [lines 344-349](supabase/functions/discover-merged-events/index.ts#L344-L349):

Base query (always applied):

```ts
let q = supabase
  .from("events")
  .select(`... ${eventDatesEmbed} ...`, { count: "exact" })
  .is("deleted_at", null)
  .eq("visibility", "public")
  .in("status", ["scheduled", "live"])
  .in("city", [...cityVariants]);
```

End-time floor (conditionally applied):

```ts
if (dateWindowUtc !== null) {
  q = q
    .eq("event_dates.is_master", true)
    .gte("event_dates.end_at", dateWindowUtc.startUtc)
    .lte("event_dates.start_at", dateWindowUtc.endUtc);
}
```

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/discover-merged-events/index.ts:287-319` (base query) + `:344-349` (conditional end-time filter) |
| **Exact code** | (see SQL fragments above) |
| **What it does** | When `dateWindowUtc === null` (any Discover request without a `localStartEndDateTime`, i.e. the default "All" date chip), the query has NO filter against `event_dates.end_at`. Every public `scheduled`/`live` event in the matched city is returned regardless of whether its master end time has passed. |
| **What it should do** | Apply `event_dates.end_at >= now()` (or the request's `referenceUtc`) on the master date row at all times, then layer the dated-chip's upper bound on top when a window is supplied. |
| **Causal chain** | (1) operator finishes an event → `events.status` stays `scheduled` because nothing auto-flips it. (2) Buyer opens Discover with default "All" filter → app calls `discover-merged-events` without `localStartEndDateTime` → `dateWindowUtc` is `null`. (3) Base query passes the row (matches deleted_at IS NULL + visibility=public + status=scheduled + city). (4) Conditional block at line 344 is skipped. (5) Row is returned, ranked above TM, rendered as an upcoming event card. |
| **Verification step** | (a) Set `now()` past an event's `event_dates.end_at` AND ensure status is still `scheduled` AND visibility public — confirmed via SQL probe below: rows still in the query result. (b) Toggle `dateWindowUtc` between `null` and a window enclosing now+future and observe the row appears/disappears. |

Companion files inspected:

- [supabase/functions/discover-cards/index.ts](supabase/functions/discover-cards/index.ts) — place-pool cards endpoint, does not query `events` table. **Not affected.**
- [mingla-business/app/checkout/[eventId]/index.tsx:59-67](mingla-business/app/checkout/[eventId]/index.tsx#L59-L67) `computeIsPast(event)` — checkout has its OWN past-event guard using `status IN (cancelled, ended)` OR `endedAt !== null` OR `dateMs + 24h < now()`. **Different code path, different semantics** (24h grace heuristic, not `end_at < now()`). Means an ended event tapped from Discover still reaches the checkout screen but gets blocked there once `start + 24h` has elapsed. Within the 24h window after `start_at` but past `end_at`, even the checkout guard fails open — buyer could in theory advance toward payment.

### Layer 4 — Runtime

Not exercised live (backend-only scope). Logical chain proven via code + schema is sufficient.

### Layer 5 — Data (ghost inventory)

Live SQL probe at investigation time (2026-05-15):

```sql
SELECT count(*) FROM events e
JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
WHERE e.deleted_at IS NULL AND e.visibility='public'
  AND e.status IN ('scheduled','live')
  AND ed.end_at < now();
-- → 2

SELECT count(*) FROM events
WHERE deleted_at IS NULL AND visibility='public' AND status IN ('scheduled','live');
-- → 9
```

**Ghost-inventory ratio: 2/9 = 22%** of the live public-scheduled inventory is currently ended-but-still-served. Concrete rows:

| event_id | title | status | end_at (UTC) | ended ago |
|---|---|---|---|---|
| 549e0a64-c133-43c3-ac1c-1ecc6055c992 | Big Party (Raleigh) | scheduled | 2026-05-15 02:00 | 20h 40m |
| b6122ef8-dc76-47d6-94a3-717450acff4f | Friday Free Sunset Mixer QA | scheduled | 2026-05-09 07:00 | 6d 15h |

Big Party is the canonical Raleigh test event ORCH-0828 [Consumer Discover timezone + sheet bugs] and ORCH-0839-A [Discover hardening] used for live-fire screenshots — proving the bug is observable on the canonical test path right now.

---

## 4. Classification

- 🔴 **Root cause:** missing `event_dates.end_at >= now()` predicate on the base path of `discover-merged-events` (only applied inside the `dateWindowUtc !== null` branch).
- 🟠 **Contributing factor:** there is no auto-transition mechanism for `events.status` → `'ended'` when end time passes. The DB's `ended` value is operator-set only. The system therefore relies entirely on read-time filters to honor "no past events shown" — and the read-time filter for the no-window path is missing.
- 🟡 **Hidden flaw:** the checkout screen's [computeIsPast](mingla-business/app/checkout/[eventId]/index.tsx#L59-L67) uses a `start + 24h` heuristic instead of `end_at < now()`. Within the 24h-after-start window but past `end_at` (typical for a 3-6h event), the heuristic fails open and the buyer can reach checkout. Not part of ORCH-0845's symptom, but should be addressed when the canonical "is past" rule is centralized.

---

## 5. Blast radius

| Surface | Affected? | Evidence |
|---|---|---|
| Consumer Discover "All" chip | ✅ Yes | Root-cause path — no date window passed, no end-time filter. |
| Consumer Discover category / vibe / music chips (no date selected) | ✅ Yes | Same code path; `partyTypeSlugs` / `vibeTagSlugs` filters add `overlaps` predicates but do NOT introduce a date window. |
| Consumer Discover dated chips (Tonight / This week / This month) | ❌ No | `dateWindowUtc !== null` branch applies `event_dates.end_at >= window.start`. Already covered by ORCH-0839-A [Discover hardening] F-5. |
| `discover-cards` edge function | ❌ No | Different system (place pool), does not touch `events`. |
| Buyer share-link `/e/{brand}/{event}` page | ⚠️ Partial | Uses `usePublicEventById` + `computeIsPast`. Status check works only for operator-flipped `ended`/`cancelled`. The 24h-after-start heuristic catches obviously-old events but fails open during the grace window. Separate ORCH-able hidden flaw (see §4 🟡). |
| `mingla-business` admin "hub/events" | ❌ Out of scope | Internal operator surface, lists owner's own events including past ones intentionally. |
| Ticketmaster events | ❌ No | TM's own API filters by `localStartEndDateTime`; not under our control. |

---

## 6. Invariant impact

- **Existing:** `I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS` (ORCH-0839-A) is preserved — that invariant only governs the dated-chip path and intentionally allows in-progress events.
- **New invariant required:** propose `I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE` — the merged-events endpoint MUST always filter `event_dates.end_at >= now()` on the master date row, regardless of whether a date window is supplied. To be codified in the SPEC dispatch.

---

## 7. Recommended SPEC scope (direction, NOT solution)

A future SPEC must cover:

1. Make `event_dates!inner` the embed for both branches (with-window AND no-window), since "must have a master date with `end_at >= now()`" is now a universal requirement.
2. Always apply `.eq("event_dates.is_master", true)` and `.gte("event_dates.end_at", referenceUtc)` where `referenceUtc` is `now()` for the no-window path and `window.startUtc` for the dated-chip path. (Cleanest factoring: compute a single `lowerBoundUtc = dateWindowUtc?.startUtc ?? new Date().toISOString()`.)
3. Decide explicitly what happens to events with NO master date row at all (currently the `!left` embed lets them through; under the new rule they must be excluded — confirm acceptable with operator).
4. Add a regression test (per ORCH-0840 [Regression-test enforcement] gate): seed an event with `status=scheduled, visibility=public, end_at = now() - 1h`, call `discover-merged-events` with no date window, assert the event is NOT in the response. Test must fail when the new `.gte` is reverted.
5. Codify the new invariant `I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE`.
6. Out of scope (registered as a follow-up): centralize the "is past" rule and unify `computeIsPast` in `mingla-business/app/checkout/[eventId]/index.tsx` to use `end_at < now()` instead of the `start + 24h` heuristic.

---

## 8. Discoveries for Orchestrator

1. **Buyer-share-link past-event heuristic mismatch** — `mingla-business/app/checkout/[eventId]/index.tsx:59-67` uses a `start + 24h` grace window instead of `end_at < now()`. Within `[end_at, start+24h]` the checkout guard fails open. Recommend a follow-up ORCH-XXXX to centralize "is past" semantics across Discover + PublicEventPage + Checkout. Severity S2-medium (revenue-integrity edge case, narrow time window).
2. **No status auto-transition** — `events.status` enum has `ended` but nothing writes it. If a future feature relies on `status='ended'` being authoritative (e.g., an admin analytics query, a post-event email blast), it will silently mis-segment 100% of the inventory. Recommend operator decision: (a) keep status as operator-only and treat `end_at < now()` as the canonical "ended" check forever; or (b) add a 1-min pg_cron job that flips status. Logging as an open question for orchestrator triage, not a defect.

---

## 9. Confidence

`root cause proven` — six-field evidence complete, live schema + live data ghost-inventory verified via Supabase Management API SQL (one read-only probe set, no mutations). Exemption from Prime Directive #7 sim-repro requirement claimed under the explicit backend / edge-function carve-out; no UI runtime evidence required.
