# Grade A evidence — Organizer Hub (#426 PR6)

**Domain:** Hub sub-nav (Events, Trips, Experiences) in mingla-business  
**Routes:** `/(tabs)/hub/events`, `/(tabs)/hub/trips`, `/(tabs)/hub/experiences`  
**Status:** Engineering evidence baseline — device/runtime smoke remains operator gate.

## Why Hub second

Hub is the organizer's primary pipeline surface (events, trips, experiences). It sits on the business critical path for activation and ties to discover/read load (`discover-merged-events` serves published events created here).

## Surfaces

| Tab | Route | File | States covered |
|-----|-------|------|----------------|
| Events | `/hub/events` | `app/(tabs)/hub/events.tsx` | Universal empty, filter empty, draft delete errors, manage actions |
| Trips | `/hub/trips` | `app/(tabs)/hub/trips.tsx` | Brand missing, loading, error, populated list |
| Experiences | `/hub/experiences` | `app/(tabs)/hub/experiences.tsx` | Loading, empty list + CTA, parse errors via toast |
| Layout | `/hub/*` | `app/(tabs)/hub/_layout.tsx` | Sub-nav loading, smart to-do toggle |

`getstarted.tsx` is decommissioned (redirect only per ORCH-1038).

## Regression tests (repo-running)

| Test / guard | What it proves |
|--------------|----------------|
| `hub/__tests__/events.pastTab.test.tsx` | Past-tab filtering contract |
| `eventType.filter.audit.test.ts` | Trips excluded from events list (ORCH-0859) |
| `maestro/tr2-events-tab-no-trip-leak.yaml` | No trip rows in events tab |
| `experiencesService.test.ts` | Hub list card column selection |
| `npm run test:orch-431` | PR6 Hub Grade A contract |

## Load / read path (#426)

Published events from Hub feed the consumer discover merge:

| Script | Path |
|--------|------|
| Discover merge | `scripts/load/discover-merged-events.js` |

See [load-profile.md](../load-profile.md) and [db-hot-queries.md](../db-hot-queries.md).

## Known gaps (honest)

| Gap | Follow-up |
|-----|-----------|
| Events tab has no dedicated loading spinner (relies on query hydration + empty states) | Optional UX polish ORCH |
| Hub Experiences web phone route was blocked in ORCH-1093 — desktop/native primary | Web parity wave |
| Runtime device proof not attached | Operator smoke on staging |

## Manual smoke gate (operator)

1. Sign in as organizer with a brand.
2. Hub → Events: verify pills, empty state, create flow entry.
3. Hub → Trips: verify loading resolves, error copy if offline.
4. Hub → Experiences: verify empty CTA and list cards.
5. Attach screenshots to epic #426 when closing Hub Workstream E box.
