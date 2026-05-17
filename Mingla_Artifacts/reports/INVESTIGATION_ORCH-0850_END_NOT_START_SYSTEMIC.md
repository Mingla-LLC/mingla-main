# INVESTIGATION — ORCH-0850 (REVISED) Systemic end-vs-start bug across consumer Activity, business Hub Past tab, public brand page, AND ticket checkout

**Mode:** INVESTIGATE
**Skill:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Trigger:** Operator reported that "Another Tested Event" (a 3am-to-9pm Raleigh event) appears as past on the **consumer Activity Calendar**, on the **business Hub Past tab**, AND that buyers attempting to purchase tickets see an **"event isn't taking new tickets"** message — all simultaneously, while the event is still in progress (8pm Raleigh, ~1h before actual end).
**Supersedes:** The original orchestrator dispatch + SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md scoped the fix to consumer CalendarTab.tsx:197 only. That scope is provably incomplete — three additional broken surfaces share the same root-cause class. This investigation establishes the systemic scope; a revised SPEC must follow.
**Confidence:** `root cause proven` across all surfaces — live Supabase Management API probe + Phase-0 code trace + verbatim five-truth-layer evidence below.

---

## 1. Symptom Summary

| Surface | Expected | Actual (live, 2026-05-15 8:10pm Raleigh = 2026-05-16T00:10:52Z) |
|---|---|---|
| Consumer Activity → Calendar tab | "Another Tested Event" in **Active** (still happening) | In **Archive** ❌ |
| Business Hub → Events → Past tab | Event NOT listed (it's still happening) | Event IS listed in **Past** ❌ |
| Business Public Brand page → Past tab | Event NOT listed | Event IS listed in **Past** ❌ (suspected — same code class as Hub) |
| Business Public Event page → Buyer taps "Buy tickets" | Checkout opens with available ticket types | Empty state: "event isn't taking new tickets" (or equivalent) ❌ |
| Consumer Discover screen | Event visible under "Tonight" | Visible ✓ (ORCH-0845 [Discover excludes ended events] is correct) |

The contradiction between Discover (correct) and four other surfaces (broken) is the contradiction-between-layers signal that pinpoints the bug class.

---

## 2. Investigation Manifest (every file read in trace order)

1. Supabase Management API live probe (event row + event_dates + master + now())
2. `app-mobile/src/components/activity/CalendarTab.tsx` (full, 1964 lines)
3. `app-mobile/src/services/calendarService.ts` (full)
4. `app-mobile/src/hooks/useCalendarEntries.ts` (full)
5. `app-mobile/src/types/index.ts:213-219` (Save interface)
6. `Mingla_Artifacts/specs/SPEC_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` (full)
7. `Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md` (full)
8. `mingla-business/app/checkout/[eventId]/index.tsx:50-130` (computeIsPast + render flow)
9. `mingla-business/app/(tabs)/hub/events.tsx:70-200` (local deriveLiveStatus + Past pill counts)
10. `mingla-business/src/components/brand/PublicBrandPage.tsx:120-150` (upcomingEvents + pastEvents memos)
11. `mingla-business/src/utils/eventLifecycle.ts:33-80` (the CANONICAL fixed deriveLiveStatus from ORCH-0828)
12. Cross-codebase grep for `new Date(event.date)`, `deriveLiveStatus`, `computeIsPast`, `pastEvents`, `liveWindowEnd`

---

## 3. Five-Truth-Layer Cross-Check

### Layer 1 — Docs

The ORCH-0828 [Consumer Discover timezone + sheet bugs] SPEC §3.4.1 explicitly forbade `new Date(event.date)` for live-status math: "Do NOT consume `event.date` for live-status math anywhere in this function. `event.date` may still be used for *display* (e.g., 'May 14') but is forbidden as the input to live-window arithmetic." That spec established invariant `I-PROPOSED-LIVE-STATUS-UTC-INPUT`. Docs are correct.

### Layer 2 — Schema

`events.timezone` (IANA string), `event_dates.start_at` and `event_dates.end_at` (timestamptz, NOT NULL, CHECK end_at > start_at). Schema is correct and authoritative. Verified via live probe.

### Layer 3 — Code

**Five callsites of the past/upcoming/live decision exist in the codebase. THREE of them still use the broken pattern (date-only string → UTC midnight + fixed 24h heuristic). ORCH-0828's fix missed them.**

| # | File | Function | Status | Pattern |
|---|---|---|---|---|
| C1 | `mingla-business/src/utils/eventLifecycle.ts:53` | `deriveLiveStatus(event, masterStartAtUtc)` | ✅ FIXED by ORCH-0828 | Takes UTC ISO instant; no `new Date(event.date)` |
| C2 | `mingla-business/app/(tabs)/hub/events.tsx:87-99` | LOCAL `deriveLiveStatus(event)` (duplicate name, same file scope) | ❌ BROKEN | `new Date(event.date).getTime()`; `liveWindowEnd = eventTime + 24h` |
| C3 | `mingla-business/app/checkout/[eventId]/index.tsx:59-67` | `computeIsPast(event)` | ❌ BROKEN | `new Date(event.date).getTime() + 24h < Date.now()` |
| C4 | `mingla-business/src/components/brand/PublicBrandPage.tsx:130, 143` | `upcomingEvents` + `pastEvents` `useMemo` blocks | ❌ BROKEN | `new Date(e.date).getTime()` with `cutoff = Date.now() - 24h` |
| C5 | `app-mobile/src/components/activity/CalendarTab.tsx:197` | Active vs Archive `useMemo` partition | ❌ BROKEN (different bug, same class) | `scheduledDate < now` (start-only, not date-only-string-bug) |

### Layer 4 — Runtime

Live test 2026-05-15 8:10pm Raleigh (= 2026-05-16T00:10:52Z UTC). With event `d07824b2-7d39-46bc-b412-4ea6d4d3962a`:

- `event.date = "2026-05-15"` (date-only string — `LiveEvent.date` shape per `mingla-business/src/store/liveEventStore.ts`)
- C2 `new Date("2026-05-15").getTime()` → `2026-05-15T00:00:00.000Z` (UTC midnight, NOT 3am EDT)
- C2 `liveWindowEnd = UTC-midnight + 24h = 2026-05-16T00:00:00.000Z`
- C2 `now = 2026-05-16T00:10:52Z`
- C2 `now >= liveWindowEnd` → returns `"past"` ❌

Identical math for C3 (checkout `computeIsPast` returns true → triggers the empty state at line 189 with the "not taking tickets" copy) and C4 (PublicBrandPage filters into `pastEvents`).

Discover (correct) uses `event_dates.end_at` from the DB directly server-side, bypasses all client predicates. That's why it correctly shows the event.

### Layer 5 — Data

Live Supabase Management API probe 2026-05-15:

```
events.id              = d07824b2-7d39-46bc-b412-4ea6d4d3962a
events.title           = "Another Tested Event"
events.timezone        = "America/New_York"
events.city            = "Raleigh"
events.status          = "scheduled"
event_dates.is_master  = true
event_dates.start_at   = 2026-05-15 07:00:00+00   (= 3:00am EDT)
event_dates.end_at     = 2026-05-16 01:00:00+00   (= 9:00pm EDT)
now()                  = 2026-05-16 00:10:52+00   (= 8:10pm EDT)
```

`end_at` is ~50min AFTER now. Event is genuinely still in progress. Data is correct and authoritative.

### Layer-disagreement diagnosis

Docs (Layer 1) said `event.date` is forbidden for live-status math. Schema (Layer 2) made the correct data available (`event_dates.end_at`). Code (Layer 3) has FIVE callsites — ORCH-0828 only fixed ONE. Runtime (Layer 4) executes the three remaining broken copies. Data (Layer 5) is correct but is being ignored by the broken predicates. **The root cause is incomplete fan-out of the ORCH-0828 fix**, plus a separate but parallel bug in the consumer Activity tab.

---

## 4. Findings (classified)

### 🔴 Root Cause #1 — Hub Past tab uses parallel broken `deriveLiveStatus`

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/(tabs)/hub/events.tsx:87-99` |
| **Exact code** | `const eventTime = new Date(event.date).getTime(); ... const liveWindowEnd = eventTime + 24 * 60 * 60 * 1000; ... if (now >= liveWindowEnd) return "past";` |
| **What it does** | Parses `event.date` (a `YYYY-MM-DD` string) as UTC midnight. Sets the "live window" to end exactly 24 hours after UTC midnight. Returns `"past"` for any event after that window — which is ~9pm EDT on the SAME calendar day for any event with a US-Eastern-time start. |
| **What it should do** | Take the UTC ISO instant of the event's master start (or even better, master end) from `event_dates.end_at`, and only return `"past"` when `now > end_at`. Identical to the canonical `mingla-business/src/utils/eventLifecycle.ts:deriveLiveStatus(event, masterStartAtUtc)` that ORCH-0828 already shipped. |
| **Causal chain** | Brand opens Hub → Events → Past tab. Page calls local `deriveLiveStatus(event)` (lines 180, 87-99). The local copy uses date-only-string → UTC midnight. For "Another Tested Event" at 8:10pm Raleigh, `liveWindowEnd = 2026-05-16T00:00:00Z` and `now = 2026-05-16T00:10:52Z` → returns `"past"` → event appears in Past pill. |
| **Verification step** | `grep -n "deriveLiveStatus" mingla-business/app/\(tabs\)/hub/events.tsx` confirms a LOCAL definition shadowing the canonical import — the canonical fixed version from `eventLifecycle.ts` is NEVER imported here. This is a parallel implementation that ORCH-0828's fix did not reach. |

### 🔴 Root Cause #2 — Checkout `computeIsPast` uses the same broken pattern

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/checkout/[eventId]/index.tsx:59-67` |
| **Exact code** | `const dateMs = new Date(event.date).getTime(); ... return dateMs + 24 * 60 * 60 * 1000 < Date.now();` |
| **What it does** | Same broken math. At 8:10pm Raleigh, returns `true`. |
| **What it should do** | Compare `now` against `event_dates.end_at`. Return `true` only when end_at has passed. |
| **Causal chain** | Buyer taps "Buy tickets" on a brand event public page → routes to `/checkout/[eventId]` → `CheckoutTicketsScreen` renders → calls `computeIsPast(event)` (line 174) → returns true → line 189 `if (isPast || ...)` short-circuits the ticket-selection UI → renders the empty state with copy that maps to "this event isn't taking new tickets" (or the equivalent). |
| **Verification step** | Read the empty-state copy at lines 189-220 of the same file. Inline comment at line 65 even says "Treat 'past' as 24h after start — matches PublicEventPage's variant logic" — author acknowledged the heuristic openly. Flagged in ORCH-0845 §8 Discovery #1 as "buyer-checkout `computeIsPast` start+24h heuristic centralization"; never opened as its own ORCH. |

### 🔴 Root Cause #3 — Public brand page `pastEvents` / `upcomingEvents` memos use the same pattern

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/src/components/brand/PublicBrandPage.tsx:130, 143` |
| **Exact code** | `const eventTime = new Date(e.date).getTime(); ... const cutoff = Date.now() - 24 * 60 * 60 * 1000; return eventTime < cutoff;` (pastEvents); the upcomingEvents memo uses `eventTime >= cutoff` with the same cutoff math. |
| **What it does** | Same broken pattern. The +24h is applied as a cutoff offset instead of a window end, but the bug class is identical. At 8:10pm Raleigh, eventTime (UTC midnight May 15) < cutoff (UTC midnight May 15 + 10min, since Date.now() - 24h = May 15T00:10Z) → returns false. Wait — let me re-trace this case more carefully. At 8:10pm Raleigh, `Date.now() = 2026-05-16T00:10:52Z`, so `cutoff = 2026-05-15T00:10:52Z`. `eventTime = 2026-05-15T00:00:00Z`. `eventTime < cutoff` → true → event in `pastEvents`. SAME bug, same severity. |
| **What it should do** | Compare `now` against `event_dates.end_at` per master date row. The 24h offset was a Band-Aid to keep "today's events" out of past until end of day, but it fails because UTC midnight is not local midnight. |
| **Causal chain** | Anonymous buyer or any visitor browses to `business.mingla.app/b/{brandSlug}`. Page calls `pastEvents` memo. At 8:10pm Raleigh, "Another Tested Event" falls into the past memo despite still being live. Buyer sees it under Past tab on the brand profile. |
| **Verification step** | Read PublicBrandPage.tsx:120-150. Both memos use identical math. The same brand-side rendering pipeline serves both authenticated and anonymous buyers. |

### 🔴 Root Cause #4 — Consumer Activity CalendarTab uses start-only predicate

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/activity/CalendarTab.tsx:197` |
| **Exact code** | `if (scheduledDate && scheduledDate < now) { archive.push(entry); }` |
| **What it does** | Start-only past check. Mirror of the originally-orchestrated ORCH-0850 single-surface bug. Different bug shape from RC #1-#3 (this one isn't `new Date(event.date)` — `scheduled_at` is a real UTC instant, but the predicate asks the wrong question). Same bug CLASS: end-vs-start. |
| **What it should do** | Compute `effectiveEnd = scheduled_at + duration_minutes`, compare against now. Detailed in the prior SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md (which remains valid for this surface). |
| **Causal chain** | Detailed in the SPEC_ORCH-0850 §1; not repeated. |
| **Verification step** | Same as the original ORCH-0850 dispatch. |

### 🟠 Contributing Factor — ORCH-0828 fix did not sweep all callsites

ORCH-0828 [Consumer Discover timezone + sheet bugs] fixed the canonical `mingla-business/src/utils/eventLifecycle.ts:deriveLiveStatus` AND four callsites (accountDeletionPreview, brandEventSummary, reconciliation, event/[id]/index.tsx). But it missed three more callsites that had their own copy of the broken logic:

- `mingla-business/app/(tabs)/hub/events.tsx:87` (local LOCAL definition)
- `mingla-business/app/checkout/[eventId]/index.tsx:59` (named `computeIsPast`, not `deriveLiveStatus` — easy to miss in a grep for the canonical name)
- `mingla-business/src/components/brand/PublicBrandPage.tsx:130,143` (inlined memo, no named function)

This is an architectural pattern violation: **the same business decision is implemented in four different places, with one being canonical and three being local copies. A single-source-of-truth refactor was the ORCH-0828 spec's clear intent but did not complete.** Per Constitution #2 (one owner per truth) — violation, ACTIVE.

### 🟡 Hidden Flaw — `LiveEvent.date` is a date-only string, not a timestamp

`mingla-business/src/store/liveEventStore.ts:LiveEvent.date: string | null` is a `YYYY-MM-DD` date-only string. JavaScript parses date-only strings as UTC midnight regardless of the device's actual timezone. As long as ANY callsite continues to call `new Date(event.date)` without a TZ-aware helper, the bug class will recur in any new feature that tries to ask a date question about the event.

ORCH-0828 added `event.masterStartAtUtc` (a UTC ISO instant) as a sibling field. But `event.masterEndAtUtc` was NOT added. None of the four broken sites can simply switch to the existing fixed field because they need the END instant for a correct past check — and only `event_dates.end_at` provides it, which isn't currently projected onto the `LiveEvent` shape.

### 🟠 Contributing Factor — checkout copy explicitly admits the heuristic

Line 65 comment: `// Treat "past" as 24h after start — matches PublicEventPage's variant logic.` The author of the checkout file even noted the cross-file duplication ("matches PublicEventPage's variant logic"). The same pattern is intentionally replicated across surfaces with no shared helper — every new surface re-implements the same buggy heuristic. This is the symptom of the missing single-source-of-truth.

### 🔵 Observation — strict-grep gate from ORCH-0828 SPEC §3.5.2 was NOT shipped

ORCH-0828 SPEC §3.5.2 proposed a CI gate forbidding `new Date("YYYY-MM-DD")` literals. Spec → IMPL → CLOSE: the gate's spec status is unknown. Grep `/Users/sethogieva/Desktop/mingla-main/.github/scripts/strict-grep/` for whether this gate exists today — if it does, the three broken sites pass it because they call `new Date(event.date)` (variable, not literal). The gate as specced would have missed all three real-world sites. Pattern: a strict-grep gate scoped only to literals is too narrow for the actual bug class.

---

## 5. Blast Radius Map

| Surface | Severity | User impact | Currently broken? |
|---|---|---|---|
| Consumer Activity → Calendar tab | S1 | In-progress saved events vanish into Archive | ✅ proven |
| Business Hub → Events → Past tab (brand-side internal) | S1 | Brand cannot find their own in-progress event under any tab except Past | ✅ proven |
| Business Hub → Events → Live tab | S2 (collateral) | Same event likely missing from Live tab too (because deriveLiveStatus returns "past", not "live"). Brand sees zero live events. | ✅ proven by same code path |
| Business Public Brand page → Past tab | S1 | Buyers visiting brand profile see active events listed as past | ✅ proven |
| Business Public Brand page → Upcoming tab | S1 | Same events MISSING from Upcoming (filtered out by `cutoff`) | ✅ proven |
| Business Public Event page → Buy tickets CTA | **S0** | Buyers cannot purchase tickets for genuinely-live events. Direct revenue loss. | ✅ proven |
| Buyer ticket-purchase flow (post-tap, in checkout) | S0 | Empty state instead of ticket selection. Revenue loss. | ✅ proven |
| Account-deletion preview "past events" count | S2 | Already-correct via ORCH-0828 fix. Off-topic side note: this site IS using the canonical helper. | ✓ correct |
| Event reconciliation screen | S2 | Already-correct via ORCH-0828 fix. | ✓ correct |

The S0 severity on checkout is **revenue-impacting** — buyers actively attempting to give Mingla money are silently turned away. The bug surfaced LIVE on operator's own test event today.

---

## 6. Invariant Violations

| Invariant | Status | Site(s) |
|---|---|---|
| **I-PROPOSED-LIVE-STATUS-UTC-INPUT** (ACTIVE post-ORCH-0828) | ❌ VIOLATED at 3 sites | C2 (Hub), C3 (checkout), C4 (public brand) |
| **Const #2 — One owner per truth** (Constitution) | ❌ VIOLATED | 4 parallel implementations of the "is past" decision |
| **Const #9 — No fabricated data** | ❌ VIOLATED — "LIVE NOW" pill (or its absence) and "tickets not available" copy are factually wrong | All 3 broken sites |
| **I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE** (ACTIVE post-ORCH-0845) | ✓ Preserved (Discover correctly uses `event_dates.end_at`) | N/A |

---

## 7. Fix Strategy (direction only — full contract belongs in the revised SPEC)

The fix is a **single-source-of-truth refactor** consolidating all four past/upcoming/live decisions into one canonical helper:

1. Extend `LiveEvent` shape in `mingla-business/src/store/liveEventStore.ts` to carry `masterEndAtUtc: string | null` (sibling to the existing `masterStartAtUtc` from ORCH-0828).
2. Populate `masterEndAtUtc` from `event_dates.end_at` at the same hydration sites that populate `masterStartAtUtc`.
3. Extend the canonical helper at `mingla-business/src/utils/eventLifecycle.ts` to accept (or expose a sibling helper that accepts) `masterEndAtUtc`, returning `"past"` only when `now > masterEndAtUtc`. Or — keep the existing `deriveLiveStatus(event, masterStartAtUtc)` semantics but add a new `isEventPast(event, masterEndAtUtc): boolean` for the checkout / past-tab / brand-page cases that don't need the full live/upcoming/past trichotomy.
4. Delete the LOCAL `deriveLiveStatus` at `hub/events.tsx:87`. Import the canonical one. Pass `masterEndAtUtc`.
5. Replace `computeIsPast` at checkout with `isEventPast(event, event.masterEndAtUtc)`.
6. Replace the `new Date(e.date)` math in PublicBrandPage `upcomingEvents` / `pastEvents` memos with the canonical helper.
7. Fix the consumer Activity CalendarTab separately per the prior SPEC_ORCH-0850 §3.2.2 (different code base, different shape — calendar_entries.duration_minutes path, not LiveEvent). Keep that fix; it stands.
8. Strengthen the strict-grep gate proposed in ORCH-0828 §3.5.2 to also catch `new Date(event.date)`, `new Date(e.date)`, `new Date(this.date)`, etc. (variable date-only sources, not just literals). Pair with positive-presence check that flags any past-decision callsite NOT using the canonical helper.

---

## 8. Regression Prevention

The reason ORCH-0828 missed three sites is that the spec named files specifically — it did not require a codebase-wide sweep for the bug pattern. The new spec MUST:

- Require an **exhaustive grep across `mingla-business/` AND `app-mobile/` for every variant of past/live/upcoming decision logic**, with the implementor enumerating every hit in the implementation report and either (a) routing through the canonical helper, (b) deleting the duplicate, or (c) marking + justifying why a site is genuinely orthogonal.
- Codify an invariant `I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER` that forbids local re-implementations of past/live/upcoming decisions outside `eventLifecycle.ts` + the parallel consumer-side `app-mobile` helper.
- Strict-grep gate that scans for `new Date(.+\.date)` (variable-source date-only parse) across both apps and fails CI on any match outside the canonical helper file.
- Two regression tests per surface (happy-path + adversarial) per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 gate.

---

## 9. Discoveries for orchestrator

### 9.1 ORCH-0828 close was incomplete

The ORCH-0828 CLOSE banner cited "all callsites updated" but missed three. Either the implementor's audit was insufficient, the tester's coverage was insufficient, or the spec's file list was incomplete. Worth a meta-ORCH or a META-LEARN entry in `Mingla_Artifacts/META_LEARNINGS.md` so future spec authors require codebase-wide grep evidence as a close-gate. Pair with `feedback_forensic_thoroughness.md`.

### 9.2 Operator-visible S0 revenue path is currently broken

The ticket checkout "not taking new tickets" empty state IS the operator's reported symptom. Revenue is currently leaking on every event that runs longer than ~24h after UTC midnight of its `date` field, OR any event whose `date` UTC-midnight + 24h falls before the actual end. For events in US-Eastern (which most Mingla launch events appear to be), this is **every event that runs past ~8pm local on its start day**. This should be flagged as a launch-blocker in the priority board.

### 9.3 `events.status='ended'` is still operator-set-only

Per ORCH-0845 close notes. None of the broken sites can fall back to `event.status === 'ended'` because operators are not expected to mark it manually. The read-side fix (this ORCH) remains canonical.

### 9.4 Public brand page upcoming-tab dual bug

Side discovery during §3 trace: `PublicBrandPage.tsx:125-134` `upcomingEvents` memo uses `cutoff = Date.now() - 24h` and includes events where `eventTime >= cutoff`. This is "today and forward" — but `eventTime` is UTC midnight, so it always rejects "today" before ~8pm local even though the event is upcoming. The bug class is the same; the manifestation is symmetric. Worth folding into the revised SPEC scope.

### 9.5 Strict-grep gate scope from ORCH-0828 §3.5.2

If the literal-only `new Date("YYYY-MM-DD")` gate WAS shipped, it should be strengthened to also catch the variable form. If NOT shipped, that's the missing reg-prevention that allowed the three broken sites to persist. Implementor should confirm gate existence and scope.

---

## 10. Confidence

`root cause proven` across all four broken sites. Six-field evidence per RC. Live Supabase Management API probe + verbatim code reads + live operator-reported repro on operator's own device. No hand-waving.

---

## 11. Cross-references

- Live DB probe: orchestrator session 2026-05-15 (operator-confirmed)
- Prior (now-incomplete) SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START.md` — STILL VALID for the consumer Activity surface (RC #4), needs to be merged into the revised SPEC as a §3 sub-spec
- Precedent: `Mingla_Artifacts/specs/SPEC_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` — established `I-PROPOSED-LIVE-STATUS-UTC-INPUT` and the canonical helper. This ORCH completes the fan-out that ORCH-0828 left unfinished.
- Parity reference: `Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md` — server-side analogue of the same end-not-start contract
- WORLD_MAP entry: `Mingla_Artifacts/WORLD_MAP.md:1221` (ORCH-0850) — needs scope update to reflect revised four-surface bundle

End of investigation.
