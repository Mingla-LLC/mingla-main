# INVESTIGATION — ORCH-0863 [Trips-as-events leak systemic audit]

> **⚠ ORCH-ID NOTE:** Same orchestrator-numbering caveat as the companion `ORCH-0862` investigation — orchestrator may need to renumber both at artifact sync. Findings stand regardless.

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode, code-audit-only)
**Scope:** mingla-business only
**Symptom:** operator reports trips appear in Home page "Upcoming" list; tapping a trip routes to `/event/{id}` (events detail screen) instead of `/trip/{id}` (trip dashboard); trips also appear under the Drafts filter on the Events tab. REWORK 2 + REWORK 3 added `event_type` filters to 12 service-layer sites + a strict-grep CI gate. Filter logic is correct (verified by tester's runtime jest in RETEST 4). Yet leak persists. Why.
**Confidence:** `proven` for the root cause; `probable` for the operator's runtime symptom (one of two paths; both fixed by the same structural change).

---

## 1. Layman summary

The previous fix made every `events` table query filter by `event_type`. That was necessary but not sufficient. The leak that operator sees on the Home Upcoming list isn't from a missed query — it's from the **tap-handler** at `app/(tabs)/home.tsx:246` that takes an `eventId` and unconditionally routes to `/event/{eventId}`. Even if every upstream filter is perfect, the moment any trip row reaches that handler (via a stale Zustand cache, a race, or the diagnostic-shown bundle issue from REWORK 4), the operator lands on the wrong screen. The structural fix is to make tap-handlers route-by-type (`if event_type === 'trip' then /trip/{id} else /event/{id}`), and to introduce a canonical `routeForEventRow(row)` helper that every consumer uses so this can never be missed again.

---

## 2. Investigation manifest

Files read (in trace order):

1. `mingla-business/app/(tabs)/home.tsx` — Home screen data sources + tap handlers (lines 134-246).
2. `mingla-business/app/(tabs)/hub/events.tsx` — Events tab tap handlers (earlier session — confirmed routes to event surfaces).
3. `mingla-business/src/services/businessEvents.ts:454-505` — `fetchBusinessEventsForBrand` (REWORK 2 filter + REWORK 4 diagnostic).
4. `mingla-business/src/services/eventDrafts.ts` — drafts query path (REWORK 3 filter at line 207).
5. `mingla-business/src/store/liveEventStore.ts:349-388` — persist config + migrate function. **Key finding:** `partialize: (_state): PersistedState => ({ events: [] })` at line 360 means the Zustand store never persists server snapshots. Migration v4 → v5 (line 382) explicitly drops persisted server data on app-version upgrade. This was the prior `ORCH-0862` fix.
6. `mingla-business/src/store/draftEventStore.ts` (header) — also persisted, also recently scoped.
7. `mingla-business/src/utils/liveEventConverter.ts:140` — only writes to liveEventStore via `addLiveEvent` and only from the EVENT publish flow (`[I-16 GUARD]`). Trips do NOT touch it.
8. `mingla-business/src/components/event/EventManageMenu.tsx:49-71` — confirms manage menu routes always go to `/event/{eventId}/*` paths (edit, orders, guests, etc.) without event_type check.

Sub-agent: none used (per Phase 0d, did all reads directly).

---

## 3. Findings

### 🔴 Root Cause R-1 — Home + Events tab tap-handlers route by id alone, not by `event_type`

**File:** `mingla-business/app/(tabs)/home.tsx:239` and `:246`

**Exact code:**

```ts
// home.tsx:239 — draft tap handler
router.push(`/event/${draftId}/edit` as never);

// home.tsx:246 — published tap handler  
router.push(`/event/${eventId}` as never);
```

**What it does:** any row in the Home `liveEvents` or `drafts` array that gets tapped → routes to `/event/{id}/edit` or `/event/{id}` regardless of whether the row represents a trip (`event_type='trip'`) or an event (`event_type='event'`).

**What it should do:** read the row's `event_type` and route accordingly:
- `event_type === 'trip'` + status='draft' → `/trip/{id}/edit`
- `event_type === 'trip'` + status='scheduled/live' → `/trip/{id}` (operator dashboard)
- `event_type === 'event'` + status='draft' → `/event/{id}/edit`
- `event_type === 'event'` + status='scheduled/live' → `/event/{id}` (event dashboard)
- `event_type === 'experience'` → not yet shipped; route to coming-soon stub

**Causal chain:** even with REWORK 2/3 filters preventing trips from REACHING the home upcoming list via the server query (`fetchBusinessEventsForBrand` excludes trips, `fetchDraftsForBrand` excludes trips), the tap-handler is structurally fragile. The moment any trip row ARRIVES via any path — (a) operator's bundle hasn't reloaded latest source, (b) Zustand cache miss-migration, (c) React Query cache from before fix landed, (d) a future regression in an unaudited consumer — the handler routes to the wrong screen. The handler treats "id present in events list" as proof of event-type, which is no longer true post-Tr2.

**Verification:** the operator's RETEST 5 smoke shows EXACTLY this — trip appears in Upcoming list, tap routes to event tab. REWORK 4 diagnostic will show whether the trip is in `businessEventsQuery.data` (server-fixed surface) or `legacyLiveEvents` (Zustand). Either way the tap-handler shouldn't have routed to /event/{id}.

### 🔴 Root Cause R-2 — No canonical `routeForEventRow(row)` helper

**File:** N/A — absence of a shared utility in `mingla-business/src/utils/` for routing decisions.

**Exact code:** every tap-handler in home.tsx, hub/events.tsx, hub/trips.tsx, brand/[id]/, EventManageMenu, EventListCard, etc. constructs its own `/event/${id}` or `/trip/${id}` string. There is no `routeForEventRow(row: { id, event_type, status })` function that centralizes the decision.

**What it does:** every consumer of an event-or-trip row must remember to check `event_type` and apply the correct route. Forgetting any one site re-introduces the leak.

**What it should do:** a single function `routeForEventRow({ id, event_type, status })` returns the correct route string. Every tap-handler imports and calls it. Adding a new consumer = use the helper, can't get it wrong.

**Causal chain:** without a centralized helper, the routing rule lives in N call sites. REWORK 2/3 missed home.tsx because we audited query sources, not tap-handler routing. The tap-handler problem is structurally invisible to the filter audit.

**Verification:** grep `mingla-business/src/utils/` for `routeForEvent|routeForRow|navigateToEvent` → no such helper exists.

### 🟠 Contributing Factor C-1 — Cards/UI components don't carry `event_type` through the render tree

**File:** `mingla-business/src/components/event/EventListCard.tsx` (header read — props interface uses `event: LiveEvent`); component renders the card and exposes `onPress` callback that consumer (events.tsx, home.tsx) handles.

**Exact code:** `LiveEvent` type DOES carry `event_type` (added by Tr2). But existing card components were written pre-Tr2 and don't surface or use it in their render or interaction surface. The card looks identical for trips vs events.

**What it does:** even if the filter works and only events reach the card, the visual + interaction affordance doesn't distinguish trips from events. So when an operator looks at a trip card rendered in the events list (current bug), there's no visual cue.

**What it should do:** card components either filter at render time (defensive: `if (event.event_type !== 'event') return null`) OR show a distinct visual marker for trips (badge, icon).

**Causal chain:** adds to confusion when leak occurs — even if the leak is fixed, operators have no visual proof at the card layer.

### 🟡 Hidden Flaw H-1 — `useLiveEventsForBrand` Zustand path is theoretically safe but operationally fragile

**File:** `mingla-business/src/store/liveEventStore.ts:350-388`

**Exact code:** `name: "mingla-business.liveEvent.v1"`, `version: 5`, `partialize: () => ({ events: [] })`. The v4 → v5 migrate function (line 382-385) drops persisted server data on app-version upgrade. So a fresh app install OR an app upgrade past version 5 results in an empty persisted store.

**What it does:** in normal operation, `legacyLiveEvents` from `useLiveEventsForBrand` returns `[]` on every cold start (because partialize persists empty and addLiveEvent is only called by `liveEventConverter` on event publish, which trips never trigger).

**What it should do:** same — already correct.

**Why this is a hidden flaw, not a root cause:** the store is correctly gated. BUT if any future code path mistakenly calls `useLiveEventStore.getState().addLiveEvent()` with a trip row, the trip would land in Zustand → merge in `home.tsx:130` `mergeServerAndLegacyLiveEvents()` → tap → wrong route. The `[I-16 GUARD]` comment in `liveEventConverter.ts:137` warns against this, but it's a comment, not a CI gate. Recommend: strict-grep gate that bans `addLiveEvent` callers outside `liveEventConverter.ts`.

### 🔵 Observation O-1 — Operator's runtime leak is most likely bundle/cache, NOT a missed code path

The current REWORK 4 diagnostic console.log will reveal which. Either way the structural fix (tap-handlers routing by event_type + canonical helper) resolves both:
- If bundle/cache: the structural fix prevents future drift even if the cache replays an old payload.
- If missed code path: the structural fix forces the type check at the handler regardless of where the data came from.

---

## 4. Five-layer cross-check

| Layer | What it says | Disagreement? |
|---|---|---|
| Docs | `feedback_anon_buyer_routes` + I-1.2-UNIFIED-EVENT-TYPE say trips live in `events` table, route to `/t/{slug}` (public) + `/trip/{id}` (operator). Says nothing about tap-handler discipline. | Partial — convention exists but no routing rule documented |
| Schema | `events.event_type` admits `'event' | 'experience' | 'trip'`; CHECK constraint enforces | OK |
| Code | Query sites filter (REWORK 2/3); tap-handlers do NOT discriminate (R-1) | **CONTRADICTION** — query says "trips out" but tap-handler treats all rows as events |
| Runtime | Operator screenshot — trip in Upcoming, tap → events tab | Confirms R-1 |
| Data | The DC Adventure trip exists at events.id=060d0483... with event_type='trip' | OK |

**Contradiction summary:** code at the query layer correctly excludes trips. Code at the tap-handler layer routes any id to event surfaces. These two layers disagree about what "events list" means. Tap-handler treats it as "list of things to route to event screens"; query treats it as "list of event_type='event' rows." Fix forces both to mean the same thing.

---

## 5. Blast radius

- **`app/(tabs)/home.tsx`** — Upcoming list, tap-handler routes to `/event/{id}` (proven leak surface).
- **`app/(tabs)/hub/events.tsx`** — Events tab tap-handlers — likely route via EventManageMenu and other handlers; need same fix.
- **`mingla-business/src/components/event/EventListCard.tsx`** — card component; consumer onPress callback.
- **`mingla-business/src/components/event/EventManageMenu.tsx`** — manage-menu sheet exposes actions per row; each action routes via `/event/{id}/*`. If a trip row reaches the manage menu (via stale cache or whichever leak path), every menu action would deep-link into event surfaces.
- **`app/o/[orderId].tsx`** — order detail page may route back to `/event/{id}` from a tap; needs check.
- **`app/brand/[id]/blasts.tsx` + `app/brand/[id]/audit-log.tsx`** — may list events; need check.
- **Deep links** — if any QR scan / external link routes via `/event/{id}` for a row that's actually a trip, same problem.

---

## 6. Invariant violations

This investigation proposes a NEW invariant:

**`I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE`** (status: DRAFT, flips to ACTIVE on ORCH-0863 CLOSE)

> Every tap-handler / navigation action in mingla-business that receives an id from an events-table row MUST discriminate the destination by `event_type` (or use the canonical `routeForEventRow` helper that does so). Hardcoding `/event/${id}` or `/trip/${id}` based on UI context alone is forbidden because UI lists may contain rows of any type post-Tr2 [Tr2 Minimum Viable Trip].

Companion invariant from the SafeArea investigation: `I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES`.

Also reinforces but doesn't supersede `I-PROPOSED-TR2-EVENTS-TYPE-FILTER` (REWORK 3 registered): filter at query layer + route-by-type at handler layer = belt-and-suspenders.

---

## 7. Fix strategy (direction only)

**Structural fix** (recommended):

1. Create `mingla-business/src/utils/routeForEventRow.ts`:
   ```ts
   export function routeForEventRow(row: {
     id: string;
     event_type: "event" | "experience" | "trip";
     status?: "draft" | "scheduled" | "live" | "ended" | "cancelled";
   }): string {
     if (row.event_type === "trip") {
       return row.status === "draft" ? `/trip/${row.id}/edit` : `/trip/${row.id}`;
     }
     if (row.event_type === "experience") {
       return `/experience/coming-soon`;
     }
     return row.status === "draft" ? `/event/${row.id}/edit` : `/event/${row.id}`;
   }
   ```

2. Retrofit every tap-handler in `home.tsx`, `hub/events.tsx`, `EventManageMenu.tsx`, `EventListCard.tsx` consumers, and any other tap-handler that touches an event/trip id to call `routeForEventRow` instead of constructing the string inline.

3. Add strict-grep CI gate `.github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs` that:
   - Scans `mingla-business/app/` + `mingla-business/src/` for any `router.push(\`/event/...\`)` or `router.push(\`/trip/...\`)` call
   - Requires the call to be either (a) inside `routeForEventRow.ts` itself (the canonical helper), (b) inside `app/event/[id]/*` or `app/trip/[id]/*` route file (internal navigation within an already-known type), (c) carries an allowlist comment `// orch-strict-grep-allow route-by-event-type — <reason>`
   - Wire into existing `.github/workflows/strict-grep-mingla-business.yml`

4. Reinforce Zustand discipline: add strict-grep gate that bans `addLiveEvent` callers outside `liveEventConverter.ts` (H-1 protection).

5. Defensive card filter (optional but recommended for belt-and-braces): in `EventListCard.tsx`, add a runtime check that returns `null` (or a visible warning in dev) if `event.event_type !== 'event'`. Catches future regressions at render time before the user can tap.

**Tactical fix only (NOT recommended)**:
Just fix home.tsx tap-handlers without the helper or gate. This is the 5th iteration of whack-a-mole on this bug class — the gate is what breaks the cycle.

---

## 8. Regression prevention

- `routeForEventRow` helper → single owner per truth (Constitution #2).
- Strict-grep gate → CI catches new hardcoded `/event/{id}` or `/trip/{id}` route strings outside the helper.
- Card-layer defensive filter → renders empty (no tap surface) if a wrong-type row leaks through.
- Implementor + tester skills should add a Cross-Surface Impact step: "if you're adding or modifying a tap-handler on an events-table row, use `routeForEventRow` — never construct the path manually."

---

## 9. Discoveries for orchestrator

- **R-2 + R-1 are the SAME structural problem** — no centralized routing decision. Recommend treating both as one bundled fix in REWORK 5 dispatch.
- **Operator's bundle/cache hypothesis from REWORK 4** is orthogonal — the diagnostic still has value to confirm whether the surface-layer filter is alive. Even if the diagnostic shows filter working, the tap-handler still needs the fix (because the next regression in any consumer will re-leak unless the structural fix lands).
- **EventManageMenu, EventListCard, deep links** all need the same retrofit. Spec MUST enumerate the full list rather than spot-fixing home.tsx alone.
- **Consumer app (`app-mobile/`)** out of scope per dispatch — but the analogous bug class may exist there too (consumer Discover feed of events + trips). Follow-up ORCH recommended.
- **Edge function `discover-merged-events`** has the source-side filter (REWORK 2) but is still PRE-Tr2 in production (v19, sha b7cd2ef per RETEST 3 evidence) — until orchestrator deploys at CLOSE, consumer app will leak trips into Discover. Reiterating from prior reports.

---

## 10. Confidence

**`proven`** for R-1 (tap-handler at `home.tsx:246` source-verified, treats any id as event-routable) and R-2 (no centralized helper exists, source-grepped). **`probable`** for the operator's specific runtime symptom — could be bundle/cache (REWORK 4 diagnostic answers) OR a code-path leak I haven't fully traced (Zustand stale, React Query stale). Either way the structural fix resolves both.

The fix direction is independent of which root cause caused the operator's current symptom — both flow through the same tap-handler that lacks the type check.
