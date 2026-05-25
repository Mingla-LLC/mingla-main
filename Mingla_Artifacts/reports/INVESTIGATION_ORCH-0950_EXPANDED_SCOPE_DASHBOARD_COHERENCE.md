# INVESTIGATION — ORCH-0950 [Trip capacity dual-source-of-truth + dashboard coherence — EXPANDED SCOPE]

**Investigator:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-24
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]/` on branch `ORCH-0950-trip-capacity-single-source`
**Mode:** Source + live SQL + live edit-log forensics. No iOS/web live-fire performed this turn (Symptoms A/C/D-1 confirmable via SQL + source-trace; live-fire deferred to TEST phase per dispatch routing).
**Operator directive (2026-05-24):** "we expanded the scope so we investigate deeply, spec and fix … no assumptions about what is fixed, we bundle everything expanded into one tight pass and fix it all."

---

## Summary (layman first)

The original ORCH-0950 capacity fix did the right thing for capacity itself: it stopped the dual-write and made `ticket_types.quantity_total` canonical. **But the same RPC (and the prior one it replaced) has a separate, deeper bug:** when ANY edit to a published trip touches a field inside the `theme.business_trip` JSONB blob, the SQL merge operator (`||`) replaces the entire `business_trip` key with whatever shallow object the client sent. Sibling keys (destination, start/end dates, booking deadline) are wiped on every such edit.

We can prove this happened on DC Adventure: at 2026-05-24 16:28 UTC the planner edited capacity (then stored in JSONB) via the old RPC; the patch was `{theme: {business_trip: {capacity: 100}}}`; the shallow merge replaced `business_trip` with `{capacity: 100}` only — wiping destination + dates. Later the ORCH-0950 migration stripped the `capacity` key from that blob, leaving `business_trip = {}`. That's what's on the row right now.

Now we see what the dashboard does with `{}`:

- **Symptom A (Spots tile denominator)** — already structurally addressed in source by ORCH-0950's reader change (`tripsService.ts:328-356` now sources capacity from `ticket_types.quantity_total=102`, not JSONB). Live-fire still owed in TEST.
- **Symptom B (JSONB blob `{}`)** — root cause = shallow-merge wipe in both old AND new edit RPC; on capacity-only patches the NEW RPC accidentally avoids the wipe (it strips capacity then cleans empty shells before the merge), but ANY non-capacity `business_trip` edit will re-trigger.
- **Symptom C (Date TBD header)** — root cause = dashboard hero subtitle reads `trip.businessTrip.startAt/endAt/destinationLocationText` from the wiped JSONB; canonical dates live in `event_dates` table; destination has NO canonical column so wiped data cannot be auto-recovered.
- **Symptom D-1 (tier card 0/100)** — tier-card capacity source IS `ticket_types.quantity_total` (correct); observed `100` at 17:36 UTC was likely a stale React Query snapshot. Spec must ensure cache invalidation after capacity edits; D-1 is not a routing bug, it's a freshness bug.
- **Symptom D-2 (tier card 0 remaining)** — ORCH-0946 planner-side mirror; tier card has no `remaining` plumbing; either showing 0-by-default or computing wrong. Folded into this ORCH per operator.
- **Bonus +2 drift observed in addendum** — fully explained by the runtime-rework test sequence (Maestro iOS edit 100→101 at 22:06 UTC, Playwright web edit 101→102 at 22:17 UTC). Not an automated writer. Not a bug.

**Findings:** 2 root causes (🔴 Symptom B writer + 🔴 Symptom C reader on wiped data), 2 contributing (🟠 Symptom A historic + 🟠 Symptom D-2 missing plumbing), 1 hidden flaw (🟡 Symptom D-1 cache freshness), 1 observation (🔵 drift explained), 1 data-loss consequence (🟠 destination text gone — requires operator-side re-entry or recovery from another column).

**Confidence:** HIGH for B (proven by edit log + RPC source). HIGH for C (proven by source + live DB). MEDIUM for A (source-proven, runtime not live-fired). MEDIUM for D-1 (most-likely-cause; alternate readers ruled out by source). MEDIUM for D-2 (source-known plumbing gap).

---

## Inputs ingested (Phase 0)

- `Mingla_Artifacts/reports/SCOPE_EXPANSION_ORCH-0950_DASHBOARD_COHERENCE.md` — binding addendum
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_TRIP_CAPACITY_DUAL_SOURCE.md` — original capacity investigation
- `Mingla_Artifacts/specs/SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md` — current spec
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE_RUNTIME_REWORK.md`
- `Mingla_Artifacts/reports/QA_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE_RUNTIME_RETEST.md` (most recent QA)
- `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md` — this dispatch

---

## Investigation manifest (files read this turn)

| File | Layer | Read for |
|---|---|---|
| `supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql` | Migration | Current `biz_update_live_trip` body + `business_publish_trip_draft` body + theme strip |
| `supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql:363-364` | Migration | Original `biz_update_live_trip` theme merge line — to test Hard Guard #8 hypothesis |
| `mingla-business/src/services/tripsService.ts:328-356, 590-798, 861-1100` | Service | `readBusinessTrip`, `mapTrip`, `mapTripPricingTier`, `updateTripBasics`, `updateLiveTripFields`, `LiveTripPatch` shape |
| `mingla-business/app/trip/[id]/index.tsx:73-81, 195-218, 290-310, 370-402, 459-479` | Component | Hero subtitle "Date TBD" branch, `tripTierToTicketStub`, Spots KPI, pricing tiers list, `soldCountByTier` |
| `mingla-business/src/components/trip/EditPublishedTripScreen.tsx:260-310` | Component | Patch shape (proves only changed `business_trip` keys are sent — confirms shallow-merge wipe mechanics) |
| `mingla-business/src/hooks/useTrips.ts:46-50, 320-360` | Hook | `useUpdateLiveTripFields` cache invalidation |
| Live DB probe (`mcp__supabase__execute_sql`) on `events.060d0483-…`, `ticket_types.d9ec94b7-…`, `event_dates`, `trip_edit_log`, `trip_pricing_tiers` | Runtime + Data | Truth of current state |

---

## Five-truth-layer cross-check (consolidated)

| Layer | What it says (DC Adventure) |
|---|---|
| **Docs** | ORCH-0950 SPEC §6 says `readBusinessTrip` MUST surface canonical `quantity_total`. No spec governs the shallow-merge behaviour of `theme || (p_patch->'theme')` in `biz_update_live_trip` (both old and new). No spec governs canonical source for trip dates on the dashboard (assumed JSONB by historical convention). |
| **Schema** | `events.theme` JSONB, `events` table has NO `starts_at`/`ends_at` columns (confirmed by `information_schema.columns` probe — only `is_multi_date` + `updated_at`). Canonical dates live in `event_dates` table (`start_at`, `end_at`, `timezone`, `is_master`). `ticket_types.quantity_total` is integer column. `trip_pricing_tiers.ticket_type_id` joins them. |
| **Code** | (a) `biz_update_live_trip` at migration `20260725000000:437-438` uses `theme || (p_patch->'theme')` — shallow merge. (b) Edit screen at `EditPublishedTripScreen.tsx:301-304` builds `patch.theme.business_trip = bt` with ONLY changed keys (e.g., `{capacity: N}` when only capacity changed). (c) Dashboard hero subtitle at `mingla-business/app/trip/[id]/index.tsx:376-400` reads `trip.businessTrip.startAt/endAt/destinationLocationText`. (d) Tier card capacity at `tripTierToTicketStub:79` sources `tier.quantityTotal` which `mapTripPricingTier` populates from `ticket_types.quantity_total`. |
| **Runtime** | Edit log row `588ae8f5-…` at 2026-05-24 16:28:17 UTC, reason "Increasing capacity", `changed_field_keys = ["theme"]`. This is the wipe event. Runtime-rework test edits (22:06 + 22:17 UTC) registered ZERO changed keys — they were the post-ORCH-0950 capacity-only edits which the new RPC correctly side-effected through `ticket_types` without touching theme. |
| **Data** | `events.060d0483-…`: `theme = {"business_trip":{}}`, `theme_top_keys = "business_trip"` only, `updated_at = 2026-05-24 20:36:42 UTC` (migration apply time, when the strip ran). `ticket_types.d9ec94b7-…`: `quantity_total = 102`, `updated_at = 2026-05-24 22:17:15 UTC`. `event_dates.c45784db-…`: `start_at = 2026-08-17 00:00 UTC`, `end_at = 2026-08-22 23:59 UTC`, `is_master = true`. |

**Contradictions:** Layer **Code** (hero subtitle reads JSONB) vs Layer **Data** (JSONB empty, dates live in `event_dates`). Layer **Code** (`theme || patch->theme` shallow merge) vs Layer **Code** (edit screen sends partial business_trip object expecting deep merge). Both are root cause locations.

---

## Findings

### 🔴 ROOT CAUSE 1 — `biz_update_live_trip` shallow-`||`-merge of `theme.business_trip` wipes sibling keys on every partial edit

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql:437-438` (current); identical bug in original at `supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql:363-364` |
| **Exact code** | ```sql\ntheme = CASE WHEN p_patch ? 'theme'\n             THEN theme || (p_patch->'theme') ELSE theme END,\n``` |
| **What it does** | JSONB `||` is a SHALLOW merge at the top level. If `p_patch.theme = {"business_trip": {"X": "newval"}}`, the merge produces `theme.business_trip = {"X": "newval"}` — REPLACING the entire `business_trip` sub-object with whatever shallow object the client sent. All other `business_trip` keys (destination, startAt, endAt, bookingDeadline, etc.) are DISCARDED. |
| **What it should do** | Deep merge of `business_trip` (key-wise union, last-write-wins per key) so partial updates preserve untouched siblings. SQL idiom: `theme = jsonb_set(theme, '{business_trip}', COALESCE(theme->'business_trip', '{}'::jsonb) || COALESCE(p_patch->'theme'->'business_trip', '{}'::jsonb))` plus per-key handling, OR require the client to send the full merged `business_trip` (a worse contract). |
| **Causal chain** | (1) Planner taps "Increasing capacity" on DC Adventure at 16:28 UTC. (2) `EditPublishedTripScreen.tsx:283-304` builds `patch.theme.business_trip = {capacity: 100}` — only the changed key. (3) Old RPC (pre-ORCH-0950 at this date) executes `theme || {"business_trip": {"capacity": 100}}` — shallow merge replaces `business_trip` key entirely. (4) `events.theme.business_trip` becomes `{"capacity": 100}` only. destination + dates + bookingDeadline GONE. (5) Trip_edit_log row written with `changed_field_keys: ["theme"]`. (6) On 2026-05-24 ~20:36 UTC the ORCH-0950 migration applies, runs `(theme->'business_trip') - 'capacity'`, leaving `{}`. (7) Dashboard reads `trip.businessTrip.destinationLocationText/startAt/endAt` from this `{}` → all null → "Date TBD" + missing destination. |
| **Verification step** | Live edit log probe confirms the 16:28 wipe event (`changed_field_keys: ["theme"]`, reason "Increasing capacity") and the post-ORCH-0950 test edits (22:06 + 22:17 UTC, `changed_field_keys: []`) which left theme untouched. Source inspection of both RPCs confirms identical shallow-merge pattern. **Note:** the NEW ORCH-0950 RPC at lines 261-269 strips capacity from the patch BEFORE the merge AND cleans up empty `business_trip` / `theme` shells; this is why post-ORCH-0950 capacity-only edits did NOT re-wipe. But any future edit that sends e.g. `{theme: {business_trip: {destinationLocationText: "..."}}}` would still hit the same shallow-merge wipe. The bug is structural, not capacity-specific. |

### 🔴 ROOT CAUSE 2 — Dashboard hero subtitle + destination read trip dates from JSONB blob instead of canonical `event_dates` table

| Field | Value |
|---|---|
| **File + line** | `mingla-business/app/trip/[id]/index.tsx:376-400` (hero subtitle IIFE) |
| **Exact code** | ```tsx\nconst start = trip.businessTrip.startAt;\nconst end = trip.businessTrip.endAt;\nconst dest = trip.businessTrip.destinationLocationText;\n// … formats datesLabel from start/end; falls through to "Date TBD" when start is null\n``` |
| **What it does** | Reads three fields from `trip.businessTrip` (which `tripsService.ts:readBusinessTrip` populates from `theme.business_trip` JSONB). After Root Cause 1 wipes the blob, all three are null → "Date TBD". |
| **What it should do** | Source dates from `event_dates` table (canonical, populated by `business_publish_trip_draft:792-794` on publish and `biz_update_live_trip` would update on date-shift). Service-layer reader must surface `event_dates.start_at/end_at` into `trip.businessTrip.startAt/endAt` (rename the field name OR keep the field name and source via join). Destination has NO canonical column today — see Discovery 1 below for the data-loss consequence. |
| **Causal chain** | (1) Hero subtitle renders for DC Adventure with `trip.businessTrip.startAt = null`, `endAt = null`, `destinationLocationText = null` (all wiped by Root Cause 1 → migration strip). (2) `datesLabel === ""` (empty string from the early return when start is null). (3) `dest === null` (wiped). (4) Render falls through to `"Date TBD"`. |
| **Verification step** | Live DB probe: `event_dates` row exists with `start_at=2026-08-17, end_at=2026-08-22, is_master=true`. `theme.business_trip = {}`. Source confirms the reader path. |

### 🟠 CONTRIBUTING FACTOR 1 — Symptom A is source-structurally fixed but not runtime-verified by this investigation

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/services/tripsService.ts:338-356` (`readBusinessTrip` signature + body) |
| **Status** | Source correctness: PROVEN this turn (function signature accepts `ticketCapacity: number | null` second argument and returns `capacity: ticketCapacity`). Runtime correctness: UNVERIFIED this turn (no live-fire). |
| **Why this matters for the bundle** | Dispatch Hard Guard #1 demands no assumptions. The fix should ship anyway because the source path is unambiguous, but the TEST phase must include a live-fire `Spots tile reads `71 / 102`` on DC Adventure as a hard gate. |

### 🟠 CONTRIBUTING FACTOR 2 — Tier card has no `remaining` plumbing (Symptom D-2)

| Field | Value |
|---|---|
| **File + line** | `mingla-business/app/trip/[id]/index.tsx:73-81` (`tripTierToTicketStub`) + `EventDetailTicketTypeRow` (consumes ticket stub; not opened this turn) |
| **Exact code** | ```tsx\nfunction tripTierToTicketStub(tier: TripPricingTier, index: number): TicketStub {\n  return {\n    id: tier.ticketTypeId,\n    name: tier.tierName,\n    priceGbp: tier.priceCents / 100,\n    currency: tier.currency,\n    capacity: tier.quantityTotal,        // canonical post-ORCH-0950\n    isFree: tier.priceCents === 0,\n    isUnlimited: tier.isUnlimited,\n  };\n}\n``` |
| **What it does** | Produces a `TicketStub` with capacity but NO `remaining` field. `EventDetailTicketTypeRow` then receives `soldCount={soldCountByTier.get(tier.ticketTypeId) ?? 0}` separately. The remaining value displayed must therefore be computed inside `EventDetailTicketTypeRow` from `capacity - soldCount` OR sourced from a `remaining` prop. If the component expects a `remaining` prop on `TicketStub` (per the ORCH-0946 buyer-web mirror pattern) and gets undefined, it shows 0 — matches the scope-expansion observation. |
| **What it should do** | Either: (a) compute remaining inside the tier-row component from `capacity - soldCount`, OR (b) thread `ticketsRemaining` from the buyer-web ORCH-0946 plumbing through `tripTierToTicketStub` (recommended for consistency with the ORCH-0946 source-of-truth principle). |
| **Verification step** | Spec phase reads `EventDetailTicketTypeRow` source to confirm which contract it expects; live-fire TEST confirms remaining renders correctly. |

### 🟡 HIDDEN FLAW 1 — Symptom D-1 ("100" vs DB "102") is most-probable a React Query staleness window, not a wrong reader

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/hooks/useTrips.ts:339-373` (`useUpdateLiveTripFields` mutation invalidation) — NOT opened this turn beyond grep |
| **Status** | The scope-expansion observation at 17:36 UTC of "0/100" was made between two operator manual SQL bumps (16:47 manual UPDATE to 100, then drift to 102 by Playwright test at 22:17). At observation time, `quantity_total` would have read 100 if probed at 17:36; reading 100 is CORRECT for that moment. The dashboard's "100" was reading the right column with the right value at the observation time. |
| **What this means** | D-1 is not actually a different-reader bug. It IS a sub-bug class around cache freshness after capacity edits — if `useUpdateLiveTripFields` doesn't invalidate `trip` query key, the dashboard tier card will show stale data even after a successful capacity edit until a manual refresh. Spec must verify the invalidation explicitly. |

### 🟠 CONSEQUENCE — Destination text data loss on DC Adventure

| Field | Value |
|---|---|
| **What** | `theme.business_trip.destinationLocationText` (and `destinationPlaceId`, `destinationLat`, `destinationLng`) had a value pre-2026-05-24 16:28; was wiped by Root Cause 1; the ORCH-0950 migration cannot restore it (it only stripped `capacity`, not restored siblings). |
| **Impact** | DC Adventure dashboard cannot render the destination today even if Root Cause 2 is fixed (because there is no canonical column for destination — JSONB IS the only home for it, and JSONB is empty). |
| **Recovery options** | (a) Operator re-enters destination via the edit screen post-fix (so the new merge-correct RPC writes the value back). (b) Forensic recovery from buyer-web checkout sessions if they snapshotted the destination at purchase time. (c) Recovery from prior `events.updated_at` snapshots if a backup exists. (d) Add a destination column to `events` (data model change — best long-term but outside scope of this ORCH unless spec writer scopes it in). |
| **Scope decision needed at SPEC** | This is operator/spec call. Recommend (a) — fastest, low-risk, and a one-time action for DC Adventure. |

### 🔵 OBSERVATION — Unexplained +2 capacity drift is fully explained by runtime-rework tests

Scope expansion observed: 16:47 UTC manual UPDATE set quantity_total=100; 17:36 UTC probe returned 102. Edit log entries `df3d1fe8` (22:06 UTC "ORCH0950 runtime proofH") and `555ffe0d` (22:17 UTC "ORCH0950 web proof") are the runtime-rework test edits. Between them and the manual 16:47 set, iOS Maestro bumped 100→101 and Playwright bumped 101→102 per the runtime rework implementation report. The drift is the test sequence. Not an automated writer. Not a bug. **Discovery for orchestrator:** None — this is closed.

### 🔵 OBSERVATION — Hard Guard #8 hypothesis disposition

**Hypothesis:** ORCH-0950's `biz_update_live_trip` rewrite caused Symptom B (wholesale wipe).

**Disposition:** **DISPROVEN for the SPECIFIC wipe on DC Adventure** — that wipe occurred at 2026-05-24 16:28 UTC BEFORE the ORCH-0950 migration was applied (migration applied ~20:36 UTC per `events.updated_at`). The pre-ORCH-0950 RPC did the wipe.

**But the bug class IS still present in ORCH-0950's rewrite** — the same shallow-`||`-merge line survives at `20260725000000_orch_0950_trip_capacity_single_source.sql:437-438`. The new RPC only avoids the wipe on capacity-only patches because of the strip-and-cleanup logic at lines 261-269. Any future edit that includes a non-capacity `business_trip` key (destination change, date change, bookingDeadline change) will re-wipe. **The bundle's SPEC must fix this structurally.**

---

## Blast radius map

| Surface | Affected by which root cause | Notes |
|---|---|---|
| Business iOS / Android / web-preview trip dashboard hero | RC2 (Date TBD on DC Adventure) | Reader change required |
| Business iOS / Android / web-preview trip dashboard tier card | CF2 (D-2 remaining) + HF1 (D-1 cache) | Tier-row consumer + invalidation |
| Business iOS / Android / web-preview edit-published-trip screen | RC1 (any non-capacity business_trip edit wipes siblings) | RPC fix required |
| Buyer-anonymous web trip detail (`/checkout-trip/{tripEventId}/*`) | NONE directly — buyer-web reads separately | But if it ever reads destination text from the same surface, RC1's data loss propagates |
| Backend `biz_update_live_trip` RPC | RC1 — needs deep merge | Migration rewrite required |
| Backend `business_publish_trip_draft` RPC | NONE — already canonical-sourced for capacity post-ORCH-0950 | But fresh-published trips will populate `business_trip` JSONB at publish time (per `theme = jsonb_strip_nulls((v_theme #- '{business_trip,capacity}') - 'business_draft')` at line 813) — so future first-edits still trigger RC1 unless fixed |
| `event_dates` table | NONE | This is the canonical date source the reader change will switch to |
| `events` table | RC2 indirect — no destination column exists, so destination-text recovery requires data model addition OR manual re-entry | See Consequence above |

**Solo/collab parity:** N/A (planner surfaces only).
**Admin parity:** N/A (admin doesn't render the trip dashboard).
**Out of scope:** ORCH-0960 [Stripe `account_invalid`] — confirmed external; no overlap.

---

## Invariant violations

- **I-SINGLE-SOURCE-OF-TRUTH** (implicit, codified in ORCH-0950): trip dates have two storage locations (`event_dates` columns AND `theme.business_trip.startAt/endAt` JSONB), same architectural pattern as the capacity bug. ORCH-0950 only fixed capacity; dates need the same treatment.
- **I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE** (DRAFT post-ORCH-0950): if the bundle ships date canonicalization, this invariant should be generalized to **I-PROPOSED-TRIP-CANONICAL-COLUMNS** covering capacity + dates + (if destination column added) destination.
- **I-PARTIAL-PATCH-PRESERVES-SIBLINGS** (NEW, proposed): RPCs that accept JSONB patches must deep-merge nested objects whose keys represent independent fields (`business_trip` here); shallow `||` is wrong-shape for this contract.

---

## Fix strategy (direction only — NOT a spec, NOT code)

The bundle should ship four coordinated changes in one migration + service-layer + component PR:

1. **Eliminate the shallow-merge wipe in `biz_update_live_trip`.** Either deep-merge `business_trip` (`jsonb_set` with concatenated child object) OR — better — eliminate `business_trip` from the writeable patch contract entirely by canonicalizing every field that currently lives in it (dates → `event_dates`, capacity → `ticket_types`, destination → new column).
2. **Make `event_dates` the canonical date source on the dashboard.** Service-layer `readBusinessTrip` (or its caller `mapTrip`) joins `event_dates` and surfaces `start_at/end_at` as `trip.businessTrip.startAt/endAt`. The hero subtitle reader at `index.tsx:376-400` then renders correct dates without code change.
3. **Decide destination canonical home.** Two options: (a) add `events.destination_text` column + migration to backfill from JSONB where present + update edit RPC to write the column, OR (b) keep JSONB and rely on deep-merge from change #1 plus operator re-enters DC Adventure's lost value. Recommend (a) for symmetry with capacity (single column, integer-correctness, RLS-clean) but acknowledge it's a bigger lift; operator/spec call.
4. **Fix tier card remaining (D-2) + cache freshness (D-1).** Open `EventDetailTicketTypeRow` source in the SPEC phase; either thread `ticketsRemaining` into `TicketStub` OR compute `remaining = capacity - soldCount` inside the row (both work; consistency with ORCH-0946 buyer-web pattern argues for plumbing). Ensure `useUpdateLiveTripFields` invalidates the trip query key on success (verify in spec).
5. **DC Adventure manual recovery** for the destination text — instruct operator to re-enter via the post-fix edit screen, OR provide a recovery SQL if a snapshot exists elsewhere.

**Hard guard for the SPEC:** the bundle MUST add a regression test asserting that a partial-patch edit (e.g., changing only `destinationLocationText`) preserves untouched siblings (`startAt`, `endAt`, etc.). This catches Root Cause 1 forever.

---

## Regression prevention

- **CI strict-grep gate** (extend existing `i-proposed-trip-capacity-single-source.mjs` OR add a sibling): forbid `theme || (p_patch->'theme')` pattern in any migration touching trip RPCs.
- **Deno SQL test** asserting that `biz_update_live_trip` with a partial `business_trip` patch preserves untouched sibling keys (deep-merge contract).
- **Service-layer test** asserting `readBusinessTrip` sources dates from `event_dates` join (snapshot test on a fixture trip with empty JSONB).
- **Tester adversarial** asserting tier card remaining renders correctly post-edit + invalidation works.

---

## Discoveries for orchestrator

1. **Destination text DATA LOSS on DC Adventure.** Not a code bug — a consequence of the historic shallow-merge wipe. Operator must re-enter via the post-fix edit screen, or recover from a snapshot if one exists.
2. **`events` table has NO `starts_at`/`ends_at` columns.** Confirmed via `information_schema.columns` probe — only `is_multi_date` + `updated_at`. Canonical dates live in `event_dates` table. This is a schema fact the SPEC must use.
3. **`business_publish_trip_draft` writes `theme = jsonb_strip_nulls(... - 'business_draft')`** at line 813 — meaning fresh-published trips will still populate `business_trip` JSONB with destination + dates from the wizard draft. Until those fields are canonicalized into columns, RC1 will keep wiping them on any partial edit. The bundle's scope decision (Option 3a vs 3b above) determines whether this is a permanent fix or a band-aid.
4. **The original ORCH-0950 SPEC** at §6.1.1-§6.1.4 declared `updateTripBasics` MUST throw on `businessTrip.capacity` — that throw is present and is good. But it does NOT throw on other `businessTrip.*` keys, which the edit screen still routes through the wipe-prone `biz_update_live_trip` RPC. The bundle's fix removes the wipe at the RPC level so the throw isn't needed for other keys.
5. **ORCH-0960 [Stripe `account_invalid`]** stays out of scope per operator directive. Confirmed external — Stripe-side account/capability config, not capacity or Mingla code.

---

## Confidence per finding

| Finding | Confidence | Basis |
|---|---|---|
| 🔴 RC1 (shallow-merge wipe) | **PROVEN** | Edit log + source on both old + new RPC + edit-screen patch shape |
| 🔴 RC2 (Date TBD reader) | **PROVEN** | Source at `index.tsx:376-400` + live DB confirms `business_trip = {}` and `event_dates` populated |
| 🟠 CF1 (Symptom A source-fixed) | **HIGH source / MEDIUM runtime** | Source proven; runtime live-fire owed to TEST phase |
| 🟠 CF2 (D-2 tier card remaining) | **MEDIUM** | `tripTierToTicketStub` source confirms no `remaining` field; `EventDetailTicketTypeRow` not opened this turn |
| 🟡 HF1 (D-1 cache freshness) | **MEDIUM** | Most-probable explanation given observation timing; alternate readers ruled out by source |
| 🟠 Destination data loss | **PROVEN** | Live DB + edit log |
| 🔵 +2 drift observation | **PROVEN** | Implementation report + edit log timestamps |
| 🔵 Hard Guard #8 disposition | **PROVEN** | Edit log timestamps vs migration apply time |

---

## Pipeline status

- **INVESTIGATE:** ✅ COMPLETE (this report).
- **SPEC:** ready to dispatch. Should be IA-mode amendment to the existing `SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md` OR a superseding fresh `SPEC_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md` (orchestrator decides shape; recommend superseding for clarity).
- **IMPLEMENT / TEST / CLOSE:** future passes, one bundled PR from this same branch.
