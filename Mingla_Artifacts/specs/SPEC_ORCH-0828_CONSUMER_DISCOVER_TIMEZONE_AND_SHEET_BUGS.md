# SPEC — ORCH-0828 Consumer Discover Date / Sheet / Live-Status Fixes

**Mode:** SPEC
**Investigator:** Claude `mingla-forensics`
**Spec author:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` (Sections 1–13, includes 2026-05-14 live-fire addendum on iPhone 17 Pro sim — Bugs A & B `proven`, Bug C `proven`).
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md`

---

## 1. Layman Summary

Consumer Discover is silently broken in three ways. (1) Date pills "All / Tonight / This Weekend / Next Week" return zero events because the merged endpoint never applies the date window to the business-events branch; the implicit `Category=Music` default in the filter sheet then narrows the result the rest of the way to zero. (2) Tapping a business event card fails to open the expanded sheet, AND that failed tap leaves the modal in a poisoned state that breaks every subsequent Ticketmaster card tap. (3) Mingla-business home displays "LIVE NOW" on events that don't start for hours because `new Date("YYYY-MM-DD")` parses as UTC midnight, shifting the entire live-window calculation off by up to a day. All three are proven by code + DB + (where applicable) live-fire on the iPhone 17 Pro simulator. This spec fixes all three at the root, plus a P3 copy bug and a default-category UX gap discovered during live-fire.

---

## 2. Scope and Non-Goals

### 2.1 In scope

| # | Scope item | Source |
|---|---|---|
| S1 | Edge-function date-range filter for business events in `discover-merged-events` | Investigation Root Cause 1 |
| S2 | Default category gate: filter sheet pre-selects `Category=Music` with no "Any" chip; this combines with S1 to amplify zero-results | Live-fire Obs-A2 (Section 13 of investigation) |
| S3 | DiscoverScreen state cross-contamination: missing `setSelectedBusinessEventForExpansion(null)` in `handleNightOutCardPress` and `handleCloseExpandedModal` | Investigation Root Cause 2 |
| S4 | Discriminated-union refactor for ExpandedCardModal's `card` vs `businessEvent` props, replacing the runtime contract with a type-system contract | Investigation Contributing Factor (defensive check) |
| S5 | `mingla-business/src/utils/eventLifecycle.ts:deriveLiveStatus` rewrite to use timezone-aware UTC instant instead of `new Date(event.date)` | Investigation Root Cause 3 |
| S6 | Empty-state copy mapping per active date filter (P3 cosmetic) | Live-fire Obs-A1 |
| S7 | Three CI gates: edge-function date-range contract test; `new Date("YYYY-MM-DD")` strict-grep; ExpandedCardModal mutual-exclusion compile-time enforcement (subsumed by S4 type refactor) | Investigation Regression Prevention §9 |

### 2.2 Non-goals (explicitly out of scope)

| # | Non-goal | Why |
|---|---|---|
| N1 | Redesign of the entire Discover filter UX (vertical chip rail, category re-architecture) | Out of scope per operator; surfaced as P3 design ticket Obs-A3 |
| N2 | `event_dates`/`multiDates` schema refactor (single vs multi-date events) | Bug C is solved at the helper level; schema is already correct |
| N3 | mingla-business `accountDeletionPreview.ts` audit | Listed as Discovery for Orchestrator — gets a follow-up sibling ORCH after this lands |
| N4 | Caching audit (`nightOutCache.ts` stale-result paths) | Live-fire proved zero results are reproducible from a fresh tap; cache is not the dominant contributor. Defer to follow-up if symptoms recur post-fix. |
| N5 | Stripe RN / Xcode 26 local build issue | Already worked around via EAS simulator profile shipped this dispatch |

### 2.3 Assumptions

- A1: `body.localStartEndDateTime` arriving at `discover-merged-events` is a string pair `"YYYY-MM-DDTHH:MM:SS,YYYY-MM-DDTHH:MM:SS"` interpreted as the **device's local timezone**. Re-verified against `DiscoverScreen.tsx` `getDateRange` helper at investigation time.
- A2: `event_dates.start_at` is `timestamptz` (UTC); `events.timezone` is IANA tz string (`"America/New_York"`). Re-verified via Supabase Management API at investigation time.
- A3: `mingla-business/src/store/liveEventStore.ts:LiveEvent` carries `date: string | null` (date-only), `doorsOpen: string | null` (time-only or null), `timezone: string` (IANA). The store does NOT yet carry a `masterStartAtUtc` ISO timestamp; this spec adds it.

---

## 3. Per-Layer Specification

### 3.1 Database layer

No migrations. No schema changes. Read-only consumer of `events`, `event_dates`, `brands` per ORCH-0824 baseline.

### 3.2 Edge function layer — `discover-merged-events`

#### 3.2.1 Request schema (UNCHANGED; documented for completeness)

```ts
interface DiscoverMergedRequest {
  city: { name: string; stateCode?: string | null; countryCode?: string | null; fallbackLat?: number; fallbackLng?: number; fallbackRadiusKm?: number; };
  segmentSlug?: string;
  genreSlugs?: string[];
  localStartEndDateTime?: string;   // "YYYY-MM-DDTHH:MM:SS,YYYY-MM-DDTHH:MM:SS" — INTERPRETED IN DEVICE TIMEZONE
  keywords?: string[];
  sort?: string;
  page?: number;
  size?: number;
  partyTypeSlugs?: string[];
  vibeTagSlugs?: string[];
  musicGenreSlugs?: string[];
  timezone?: string;                // NEW (S1) — IANA tz identifier from device; required when localStartEndDateTime is set; defaults to "UTC" when absent
}
```

#### 3.2.2 New behavior — apply `localStartEndDateTime` to business query

In `supabase/functions/discover-merged-events/index.ts` between lines 228 and 285, when `body.localStartEndDateTime` is non-empty:

1. Split on `,` → `[startLocal, endLocal]`. Validate both parse via `Date(`${startLocal}+00:00`)` (treating each as a wall-clock value; we'll re-anchor with the provided IANA tz). On parse failure or wrong pair shape, return `400 { error: "invalid_local_start_end_datetime" }`.
2. Use the request's `body.timezone` (IANA) — when missing, default to `"UTC"` AND log a warning. Convert `[startLocal, endLocal]` from wall-clock-in-IANA-tz to UTC instants. Acceptable implementations:
   - Use `Intl.DateTimeFormat` round-trip (zero-dependency), OR
   - Use the existing `_shared/datetime.ts` if present (verify path during implement; if absent, the implementor adds a minimal helper in `_shared/timezone.ts` named `localWallClockToUtcInstant(local: string, tz: string): string`).
3. Convert events fetch to use `event_dates!inner` (not `!left`) when the date filter is active, so events without any date row are excluded from windowed queries.
4. Add filter constraints on the joined `event_dates`:
   - `gte("event_dates.start_at", startUtc)` AND
   - `lte("event_dates.start_at", endUtc)`.
   - Apply ONLY on the `is_master = true` row; non-master rows must not pass the filter. Implementation MUST use a server-side filter (PostgREST `event_dates(...)` embedded resource filter OR an RPC; if PostgREST `!inner` embedded filters cannot express both `is_master=true` AND a date window simultaneously, the implementor switches to a stored RPC `discover_business_events_in_window(p_city text[], p_start timestamptz, p_end timestamptz, p_party_types text[], p_vibe_tags text[], p_music_genres text[], p_offset int, p_limit int)` and the spec covers that path).
5. When `body.localStartEndDateTime` is null/empty, KEEP the existing behavior (no window constraint, `event_dates!left`).

#### 3.2.3 Default-category audit (S2)

`discover-merged-events` itself does NOT apply a category gate to the business-events branch today (verified: lines 273-281 only filter by `partyTypeSlugs` / `vibeTagSlugs` / `musicGenreSlugs`). The "Music" default is a CLIENT-side issue: `DiscoverScreen.tsx` initializes the filter state with `musicGenreSlugs: ["all-genres"]` or similar and forwards that. Verify and document in IMPLEMENT: the edge function does NOT need a server-side change for S2; the client change in §3.3.2 is sufficient.

#### 3.2.4 Response shape (UNCHANGED). No new fields.

### 3.3 Mobile client layer — `app-mobile`

#### 3.3.1 Service — `app-mobile/src/services/nightOutExperiencesService.ts`

`searchMerged()`:
- Pass the new `timezone` field to the edge function. Source: `Intl.DateTimeFormat().resolvedOptions().timeZone` resolved at call time, OR the explicit `accountPreferences?.timezone` if the app stores one.
- No other contract change.

#### 3.3.2 Component — `app-mobile/src/components/DiscoverScreen.tsx`

State changes (S3 + S4):

1. **Remove** the two parallel state hooks `selectedCardForExpansion` and `selectedBusinessEventForExpansion`.
2. **Replace** with a single discriminated-union state hook:
   ```ts
   type ExpansionTarget =
     | { kind: "nightOut"; data: ExpandedCardData }
     | { kind: "businessEvent"; data: BusinessEventCardData };
   const [expansionTarget, setExpansionTarget] = useState<ExpansionTarget | null>(null);
   const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
   ```
3. `handleBusinessEventCardPress`:
   ```ts
   setExpansionTarget({ kind: "businessEvent", data });
   setIsExpandedModalVisible(true);
   ```
4. `handleNightOutCardPress`:
   ```ts
   setExpansionTarget({ kind: "nightOut", data: expandedCardData });
   setIsExpandedModalVisible(true);
   ```
5. `handleCloseExpandedModal`:
   ```ts
   setIsExpandedModalVisible(false);
   setExpansionTarget(null);
   expandedCardListRef.current = [];
   setExpandedCardIndex(null);
   ```
6. The `<ExpandedCardModal>` prop pass becomes:
   ```tsx
   <ExpandedCardModal
     visible={isExpandedModalVisible}
     target={expansionTarget}
     onClose={handleCloseExpandedModal}
     // ...other existing props unchanged
   />
   ```

Filter-state change (S2):

7. Change the default `musicGenreSlugs` state from `["all-genres"]` (or whatever its current default is — verify in IMPLEMENT) to `[]` (empty array). The Filter sheet's "All Genres" chip now means "no genre filter, send empty array". Confirm same for category (`partyTypeSlugs`, `vibeTagSlugs` already default to `[]`; verify category default is also `[]`).
8. Filter sheet UI: ensure that an "All Genres" chip exists and toggling it sets `musicGenreSlugs = []`. If the current default is already `[]` and "All Genres" is purely a visual highlight, no UI change needed — document the finding in IMPLEMENT report.

Empty-state copy (S6):

9. The empty-state text is currently hard-wired to `"No events near you tonight"`. Replace with a mapping keyed off the active date filter:
   | Filter | Copy |
   |---|---|
   | `null` / `Any Date` / `All` | "No events near you" |
   | `Today` / `Tonight` | "No events near you tonight" |
   | `Tomorrow` | "No events near you tomorrow" |
   | `This Weekend` | "No events near you this weekend" |
   | `Next Week` | "No events near you next week" |
   | `This Month` | "No events near you this month" |

   Subline stays `"Try a wider date range or different vibe."` for all. Implement as a pure function `getEmptyStateCopy(filter: DateFilter): { headline: string; subline: string }` colocated with the empty-state JSX.

#### 3.3.3 Component — `app-mobile/src/components/ExpandedCardModal.tsx`

Discriminator refactor (S4):

1. **Replace** the dual props `card?: ExpandedCardData | null` and `businessEvent?: BusinessEventCardData | null` with a single prop `target: ExpansionTarget | null` (same union type imported from a shared types module, e.g., `app-mobile/src/types/expansion.ts`).
2. **Remove** the runtime discriminator block at lines 1540-1556. Replace with:
   ```tsx
   if (target === null) return null;
   if (target.kind === "businessEvent") {
     return (
       <ExpandedBusinessEventSheet
         visible={visible}
         data={target.data}
         onClose={onClose}
       />
     );
   }
   // target.kind === "nightOut"; rest of component renders place/TM sheet
   const card = target.data;
   ```
3. Update all `card.*` references throughout the rest of the file accordingly.
4. TypeScript's exhaustive-switch / `never` check on `target.kind` provides the compile-time mutual-exclusion guarantee that replaces the prior runtime contract.

### 3.4 Mingla-business client layer — `mingla-business`

#### 3.4.1 Util — `mingla-business/src/utils/eventLifecycle.ts:deriveLiveStatus`

Rewrite the function as follows:

1. **New required input:** `masterStartAtUtc: string | null` — the UTC ISO instant for the event's master date, equivalent to `event_dates.start_at`. Source-of-truth derivation in §3.4.2.
2. **Signature:**
   ```ts
   export const deriveLiveStatus = (
     event: LiveEvent,
     masterStartAtUtc: string | null
   ): EventLifecycleStatus => { ... }
   ```
3. **Body:**
   ```ts
   if (event.status === "cancelled") return "cancelled";
   if (event.endedAt !== null) return "past";
   if (masterStartAtUtc === null) return "upcoming";
   const eventTime = Date.parse(masterStartAtUtc);
   if (!Number.isFinite(eventTime)) return "upcoming";
   const liveWindowStart = eventTime - LIVE_WINDOW_BEFORE_MS;
   const liveWindowEnd = eventTime + LIVE_WINDOW_AFTER_MS;
   const now = Date.now();
   if (now >= liveWindowStart && now < liveWindowEnd) return "live";
   if (now < liveWindowStart) return "upcoming";
   return "past";
   ```
4. **Do NOT** consume `event.date` for live-status math anywhere in this function. `event.date` may still be used for *display* (e.g., "May 14") but is forbidden as the input to live-window arithmetic.
5. JSDoc must explicitly state: "MUST receive `masterStartAtUtc` as a UTC ISO timestamp from `event_dates.start_at`. Never pass `event.date` (date-only string) — it parses as UTC midnight in JavaScript and produces incorrect live-status."

#### 3.4.2 Add `masterStartAtUtc` to LiveEvent

Audit `mingla-business/src/store/liveEventStore.ts` and the hydration pipeline (`liveEventService.ts`, `publishEvent` flow):

1. Add `masterStartAtUtc: string | null` to `LiveEvent` interface (line ~181, sibling to `date`, `doorsOpen`, `endsAt`).
2. Populate it from the `event_dates.start_at` row where `is_master = true` at fetch/publish time. If the store currently fetches from a Supabase view or RPC that does not return `start_at`, extend the query / RPC to include it.
3. Backfill persisted Zustand state on hydration: when an older LiveEvent has `masterStartAtUtc === undefined`, compute it once from `event.date + event.doorsOpen + event.timezone` using a TZ-aware helper, OR mark it `null` and refetch on next Supabase sync. Implementor chooses; document choice in IMPLEMENT report.
4. Per `feedback_zustand_persist_no_server_snapshots.md` — `masterStartAtUtc` IS server-derived but it is a stable property of the event (not user-mutating during session), so persisting it in Zustand is acceptable. Operator-confirmable: this differs from caching mutable server lists.

#### 3.4.3 Callsite updates

All callers of `deriveLiveStatus(event)` must change to `deriveLiveStatus(event, event.masterStartAtUtc)`. Sites identified by investigation:

- `mingla-business/src/utils/brandEventSummary.ts`
- `mingla-business/src/utils/accountDeletionPreview.ts` — note: this site is OUT OF SCOPE per N3 for the broader audit, but the signature change forces the callsite update. Audit of whether the count was previously wrong is the follow-up ORCH.
- `mingla-business/app/event/[id]/index.tsx` — verify in IMPLEMENT.

### 3.5 CI / regression-prevention layer (S7)

#### 3.5.1 Edge-function contract test

New file: `supabase/functions/discover-merged-events/__tests__/date_range_contract.test.ts` (Deno test).

The test:
1. Seeds via the Management API (or assumes an existing seed dataset) one business event with `event_dates.start_at = NOW() + 2 hours`.
2. Calls the deployed function with `localStartEndDateTime` set to a window `[NOW(), NOW() + 4h]` and `timezone: "UTC"` → asserts the event IS in the response.
3. Calls with a window `[NOW() - 24h, NOW() - 1h]` → asserts the event is NOT in the response.
4. Calls with `localStartEndDateTime` omitted → asserts the event IS in the response (no window constraint).

Wired into Deno gate via existing `_shared/test_runner.ts` if present, OR documented as a manual gate in the IMPLEMENT report if Deno test infra for this function doesn't exist yet.

#### 3.5.2 Strict-grep gate: `new Date("YYYY-MM-DD")`

Add to `.github/workflows/strict-grep-mingla-business.yml` (per `feedback_strict_grep_registry_pattern.md`):

```yaml
- name: forbid-new-Date-on-date-only-string
  run: |
    set -e
    if grep -rnE "new Date\(\"[0-9]{4}-[0-9]{2}-[0-9]{2}\"\)" mingla-business/src mingla-business/app app-mobile/src 2>/dev/null; then
      echo "::error::Forbidden pattern: new Date(\"YYYY-MM-DD\"). Parses as UTC midnight; use timezone-aware parsing or a UTC ISO timestamp."
      exit 1
    fi
```

A more permissive regex that allows passing variables is acceptable as long as it catches the literal-date-only-string case that caused Bug C.

#### 3.5.3 Discriminated union supersedes strict-grep state-clear

S4's type-system refactor replaces the originally-proposed strict-grep "every `setSelectedCardForExpansion` must be paired with a `setSelectedBusinessEventForExpansion(null)`" rule. After IMPLEMENT, neither setter exists — the union state cannot enter an inconsistent shape. No grep rule is needed. The CI gate IS the TypeScript compiler.

---

## 4. Success Criteria

| # | Criterion | Layer | Test |
|---|---|---|---|
| C1 | When `localStartEndDateTime` is set to a window that EXCLUDES Big Party (start_at = 2026-05-14 20:00 UTC), the merged endpoint returns ZERO business-event items. | Edge fn | Contract test §3.5.1 |
| C2 | When `localStartEndDateTime` is set to a window that INCLUDES Big Party, the merged endpoint returns Big Party as a business-event item. | Edge fn | Contract test §3.5.1 |
| C3 | When `localStartEndDateTime` is omitted, the merged endpoint returns Big Party (and all other matching business events) regardless of date — behavior preserved from before this change. | Edge fn | Contract test §3.5.1 |
| C4 | On consumer Discover with city=Raleigh, filter chip "Tonight" (Today preselected) returns the Big Party card AND any Ticketmaster events in the same window. | Full stack | Maestro live-fire on iPhone 17 Pro sim, screenshot in QA report |
| C5 | Empty-state copy reads "No events near you tonight" when Tonight is active; "No events near you" when All is active; matching strings for other filters per §3.3.2 table. | Component | Maestro live-fire screenshots per filter |
| C6 | From a fresh launch, tap a business event card → ExpandedBusinessEventSheet opens with the correct event data within 800ms. | Component | Maestro live-fire on sim |
| C7 | After opening + closing the business sheet, tapping a Ticketmaster card opens the place/TM sheet (no state poisoning). | Component | Maestro live-fire |
| C8 | TypeScript compiles with strict mode after S4 union refactor; no `as any` / `as unknown as` escape hatches added. | Type system | `tsc --noEmit` PASS |
| C9 | `deriveLiveStatus(bigPartyEvent, "2026-05-14T20:00:00Z")` called at NOW=2026-05-14T05:38:39Z returns `"upcoming"`, NOT `"live"`. | Util | Jest unit test in `mingla-business/src/utils/__tests__/eventLifecycle.test.ts` |
| C10 | `deriveLiveStatus(bigPartyEvent, "2026-05-14T20:00:00Z")` called at NOW=2026-05-14T20:30:00Z returns `"live"`. | Util | Same unit test |
| C11 | Mingla-business home tab shows Big Party with status pill "UPCOMING" or "SCHEDULED" (NOT "LIVE NOW") at any time before `start_at - 4h`. | Component | Maestro live-fire on sim, screenshot |
| C12 | Strict-grep CI gate fails on a commit that introduces `new Date("2030-01-01")` in `mingla-business/` or `app-mobile/`. | CI | Workflow run on a deliberately-broken test branch |

---

## 5. Invariants

### 5.1 Preserved (existing invariants this spec must not violate)

| Invariant | How preserved |
|---|---|
| **Const #2 — One owner per truth** | `event_dates.start_at` becomes the single date-time source for live-status. `event.date` is downgraded to display-only. |
| **Const #9 — No fabricated data** | "LIVE NOW" pill no longer appears for non-live events. |
| **Const #12 — Validate at right time** | Live-status uses UTC ISO timestamp, not user-locale-dependent `new Date()` of a date-only string. |
| **I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST** | Date-filter addition preserves the business-events-first ordering — filter narrows the set, sort order is unchanged. |
| **I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY** | Now actually enforced for both client (via `masterStartAtUtc`) and edge function (via `event_dates.start_at` filter). |
| **I-PROPOSED-J ZUSTAND_PERSIST_NO_SERVER_SNAPSHOTS** | `masterStartAtUtc` is an immutable property of the event identity (not a mutable list), persistence is acceptable. Document in IMPLEMENT report and operator sign-off if borderline. |

### 5.2 New invariants this spec establishes

| Invariant ID | Description | Enforcement |
|---|---|---|
| `I-PROPOSED-DATE-FILTER-CONTRACT` | The `discover-merged-events` edge function MUST apply `localStartEndDateTime` (when present) to BOTH the business-events and Ticketmaster branches symmetrically. | §3.5.1 contract test |
| `I-PROPOSED-EXPANSION-TARGET-UNION` | `ExpandedCardModal` consumes exactly one `target: ExpansionTarget | null` prop. The dual-prop discriminator pattern is forbidden. | TypeScript compiler |
| `I-PROPOSED-LIVE-STATUS-UTC-INPUT` | Live-status math MUST take a UTC ISO timestamp input (`masterStartAtUtc`) — never a date-only string. | §3.5.2 strict-grep gate + JSDoc |

---

## 6. Test Cases

| Test ID | Scenario | Input | Expected | Layer | Auto |
|---|---|---|---|---|---|
| T-01 | Date-window excludes event | `{localStartEndDateTime: "2025-01-01T00:00:00,2025-01-01T01:00:00", timezone: "UTC"}` | `businessCount === 0` for Big Party | Edge fn | Yes (contract test) |
| T-02 | Date-window includes event | `{localStartEndDateTime: "2026-05-14T00:00:00,2026-05-14T23:59:59", timezone: "America/New_York"}` | Big Party in `items[]` | Edge fn | Yes |
| T-03 | Date-window omitted (all events) | `{}` (no localStartEndDateTime) | Big Party in `items[]` | Edge fn | Yes |
| T-04 | Malformed window | `{localStartEndDateTime: "not-a-window"}` | `400 invalid_local_start_end_datetime` | Edge fn | Yes |
| T-05 | DST boundary | Date window crossing a fall-back DST transition with `timezone: "America/New_York"` | Window endpoints are correct UTC instants (no off-by-one hour) | Edge fn | Yes |
| T-06 | Tonight filter shows today's events | City=Raleigh, Today active | Big Party visible on the live sim | Full stack | Manual (Maestro) |
| T-07 | All filter shows all today+ events | City=Raleigh, All active | Big Party + future Ticketmaster cards visible | Full stack | Manual (Maestro) |
| T-08 | Empty-state copy varies | Filter=Next Week and no events in window | Empty-state reads "No events near you next week" | Component | Manual (Maestro) |
| T-09 | Business tap opens sheet | Tap Big Party | ExpandedBusinessEventSheet visible at index 0 within 800ms | Component | Manual (Maestro + screenshot) |
| T-10 | Business → close → TM opens | Tap business, close, tap TM | TM sheet opens cleanly | Component | Manual (Maestro) |
| T-11 | TM → close → business opens | Tap TM, close, tap business | Business sheet opens cleanly | Component | Manual (Maestro) |
| T-12 | Live-status: upcoming | `deriveLiveStatus({status:"scheduled", endedAt:null, ...}, "2026-05-14T20:00:00Z")` at NOW=05:38 UTC | `"upcoming"` | Unit | Yes (Jest) |
| T-13 | Live-status: live | Same event, NOW=20:30 UTC | `"live"` | Unit | Yes |
| T-14 | Live-status: past | Same event, NOW=2026-05-16T00:00:00Z | `"past"` | Unit | Yes |
| T-15 | Live-status: cancelled | `{status:"cancelled", ...}` | `"cancelled"` | Unit | Yes |
| T-16 | Live-status: null masterStartAtUtc | `{status:"scheduled", endedAt:null, ...}, null` | `"upcoming"` | Unit | Yes |
| T-17 | Strict-grep blocks date-only literal | Commit adds `new Date("2030-01-01")` | CI fails with helpful error | CI | Yes |
| T-18 | Type compile: union forbids dual prop | `<ExpandedCardModal target={...} card={...} />` | `tsc` error: card is not a prop | Type | Yes |
| T-19 | Home pill never shows LIVE NOW on upcoming | Mingla-business home with `bigPartyEvent` at NOW=05:38 UTC | "UPCOMING" or "SCHEDULED" pill, not "LIVE NOW" | Component | Manual (Maestro on mingla-business sim) |

---

## 7. Implementation Order

Implementor (Codex `implementor-mingla`) executes in this exact order; each step must be at green-test gate before moving to the next:

1. **Step 1 — Edge function date filter (S1).** Modify `supabase/functions/discover-merged-events/index.ts` lines 228-285 per §3.2.2. Add `_shared/timezone.ts` helper if needed. Add Deno test §3.5.1.
2. **Step 2 — Service layer pass-through.** Update `app-mobile/src/services/nightOutExperiencesService.ts:searchMerged` to pass `timezone` to the edge function.
3. **Step 3 — Default category audit (S2).** Verify `DiscoverScreen.tsx` filter-state defaults; change any non-empty defaults to `[]`. Document findings in IMPLEMENT report.
4. **Step 4 — Discriminated-union refactor (S4).** Create `app-mobile/src/types/expansion.ts`. Refactor `DiscoverScreen.tsx` to single `expansionTarget` state. Refactor `ExpandedCardModal.tsx` to single `target` prop. Update all `card.*` references inside the place/TM render path. `tsc --noEmit` must pass.
5. **Step 5 — Empty-state copy mapping (S6).** Implement `getEmptyStateCopy` helper, replace hard-wired "tonight" string.
6. **Step 6 — eventLifecycle rewrite (S5).** Add `masterStartAtUtc` to `LiveEvent`. Update store hydration path. Rewrite `deriveLiveStatus`. Update all callsites. Add Jest tests per T-12 through T-16.
7. **Step 7 — CI gates (S7).** Add strict-grep workflow entry. Wire Deno contract test into CI if not already automatic.
8. **Step 8 — Local validation.** Run `tsc --noEmit` on app-mobile + mingla-business; run Jest; run Deno gate on the touched function; visually re-test Discover on the installed simulator build.
9. **Step 9 — Write implementation report.** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` with old→new receipts for every file.

DB push: not required (no migrations). Edge deploy: required for §3.2.2 — operator owns `supabase db push` (no-op here), orchestrator owns `supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv` after IMPLEMENT review APPROVED.

---

## 8. Regression Prevention

| Bug | Prevention | Status after spec |
|---|---|---|
| Edge function silently drops a request field | Contract test that calls with the field and asserts response respects it (T-01–T-04). | New |
| State cross-contamination between two parallel state hooks | Discriminated union — type-system-enforced mutual exclusion (T-18). | New |
| `new Date("YYYY-MM-DD")` UTC-midnight parse anywhere in the codebase | Strict-grep CI gate (T-17). | New |
| Hard-wired copy that lies about the active filter | Pure mapping function colocated with empty-state JSX; tested visually per filter (C5, T-08). | New (pattern) |

---

## 9. Discoveries for Orchestrator

1. **`accountDeletionPreview.ts` audit (deferred per N3).** After this lands, register a sibling ORCH to verify whether the delete-account guard was over-firing because of the same UTC-midnight bug. Likely yes; the fix is mechanical (already covered by the callsite update in §3.4.3) but the user-impact audit is separate.
2. **`localStartEndDateTime` lacks server-side Zod validation.** A typo in the client (`localStartEnDateTime`) would silently no-op. After this ORCH, consider a follow-up to add Zod or similar runtime validation at the edge-function entry across the whole `_shared/` boundary.
3. **`nightOutCache.ts` stale-result audit (deferred per N4).** If, after the fixes land, operator continues to see filter combinations with stale-zero results that don't match a fresh fetch, register a sibling ORCH for the cache.
4. **Filter sheet UX redesign (Obs-A3 from investigation Section 13).** The split between chip-row and filter-sheet date controls is operator-confusing. Register a P3 design ticket; not a blocker.
5. **Stripe RN / Xcode 26 local-build incompatibility.** Already worked around with the EAS simulator profile shipped this dispatch. Register as a tooling-debt ticket for future cleanup; no urgent fix.

---

## 10. Open Questions Resolved by This Spec

| Q | Resolution |
|---|---|
| `localStartEndDateTime` device-local vs explicit IANA? | Explicit IANA. New `timezone` request field, default `"UTC"`. Robust + future-proof. |
| Discriminated union vs runtime defensive check for ExpandedCardModal? | Discriminated union (S4). Type-system enforcement is durable; runtime checks rot. |
| Live-status from DB `status` alone vs computed window? | Both — DB `status` first, then computed window when status is `"scheduled"`. Matches current `deriveLiveStatus` body structure; only the input source changes. |

---

End of spec.
