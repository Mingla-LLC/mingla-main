# INVESTIGATE + SPEC — ORCH-1135 [land-g1-discover-v2-integration]

**Discover v2 (PR #466) strict-grep invariant preservation — proof + exact gate-update spec**

- **Mode:** INVESTIGATE-THEN-SPEC (gate-update verification only; NO product code touched)
- **Worktree:** `/tmp/pr466-integration` on branch `cursor/g1-discover-scale` (head `b69b31672`)
- **Date:** 2026-06-13
- **Scope:** PROVE whether v2 preserves 3 strict-grep invariants across EVERY serving path, then
  emit the exact gate re-point spec. Do NOT implement product code.

---

## 0. What changed (v1 → v2)

PR #455 (v1, already on `origin/main`) shipped `discover-merged-events/index.ts` as an **830-line
monolith** that did the heavy PostgREST nested-embed query, the venue/format resolution, and the
meta/items merge all INLINE. All three gated invariants' literal tokens lived inside that one file.

PR #466 (v2, this worktree) rewrites it into a **231-line orchestrator** that delegates:

| Concern | v1 location | v2 location (authoritative) |
|---|---|---|
| Business-event query (the `end_at >= lowerBound` floor) | `index.ts` PostgREST `.gte(...)` | **RPC** `pg_discover_business_events` SQL (`20261001000000_orch_426_discover_rpc.sql`) |
| venue/address/format resolution | `index.ts` inline | `_business-query.ts` → `_helpers.ts` (`extractVenueName`/`deriveSharedFormat`) |
| meta-counts-match-items | `index.ts` inline | `_build-response.ts` (`mergeDiscoverResponse`) |
| L1 mem cache / DB cache / SWR / build-lock | n/a (new) | `_memory-cache.ts`, `_distributed-cache.ts`, cache migration |

The three gates each grep `supabase/functions/discover-merged-events/index.ts` for literals that v2
moved out → all three are RED in CI. **Confirmed RED (run 2026-06-13 in this worktree):**

- ORCH-0845 gate → `EXIT=1` (both tokens missing from index.ts)
- ORCH-0839-A gate → `0/3 PASS` (all 3 contracts FAIL)
- ORCH-0846 gate → `3/5 PASS` (R-3, R-4 FAIL; R-1/R-2/R-5 still PASS)

---

## Serving-path topology (applies to all 3 invariants)

Every response, regardless of cache state, is a **frozen copy of one builder output**. There is no
path that constructs items/meta independently of `buildDiscoverMergedResponse`:

```
index.ts serve()
  ├─ L1 hit (l1Get)          → returns stored l1Hit.response  (+ meta.fromCache=true only)
  ├─ coalesceDiscoverBuild   → buildFresh()
  │     ├─ readDbDiscoverCache → returns stored cache.response (+ meta.fromCache=true only)
  │     ├─ tryDistributedBuildLock lost → waitForDbDiscoverCache → stored cache.response
  │     └─ buildDiscoverMergedResponse(buildCtx)   ← THE ONLY CONSTRUCTOR
  │           ├─ fetchDiscoverBusinessEvents → RPC pg_discover_business_events
  │           └─ mergeDiscoverResponse(...)  → items + meta
  └─ writeDbDiscoverCache stores that same built object
```

**Proof the cache paths do not re-derive items/meta:**
- `_memory-cache.ts:23-30` `l1Get` returns the stored `L1Entry.response` verbatim.
- `index.ts:212-216` L1-hit spreads `...l1Hit.response` and only overrides `meta.fromCache`.
- `_distributed-cache.ts:15-32` `readDbDiscoverCache` returns the stored `response` jsonb verbatim,
  only overriding `meta.fromCache`.
- `_distributed-cache.ts:70-95` `writeDbDiscoverCache` stores exactly the built object.
- `_memory-cache.ts:40-58` `coalesceDiscoverBuild` `l1Set`s the same built object it returns.

**Conclusion:** if the single builder + its RPC preserve an invariant, ALL FOUR serving paths
(fresh, L1, DB/SWR, build-lock-loser) preserve it, because the cache stores and replays the builder
output byte-for-byte (modulo the `fromCache` flag, which touches neither items nor counts nor the
end-date predicate). This single fact discharges the "across every serving path" requirement for all
three invariants; per-invariant sections below add the layer-specific proof.

---

## INVARIANT 1 — ORCH-0845: I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE

**Contract:** discover MUST filter `event_dates.end_at >= lowerBound` on the master date row on ALL
paths (no-window "All" view AND dated-chip), NOT scoped to a date-window branch. (Pre-0845: 22%
ghost-inventory leak on the All view.)

### Proof

**The predicate is UNCONDITIONAL in the RPC.** `20261001000000_orch_426_discover_rpc.sql:94-103`:

```sql
INNER JOIN public.event_dates ed
  ON ed.event_id = e.id
 AND ed.is_master IS TRUE
 AND ed.end_at >= p_lower_bound          -- line 97: ALWAYS applied
...
AND (p_upper_start IS NULL OR ed.start_at <= p_upper_start)   -- line 103: window UPPER bound only
```

- `ed.end_at >= p_lower_bound` is part of the **INNER JOIN condition**, evaluated for every row the
  query returns. It is NOT wrapped in any `p_upper_start IS NULL` / date-window conditional.
- The date-window parameter `p_upper_start` only adds an *upper* bound on `start_at` (line 103),
  guarded by `p_upper_start IS NULL OR ...`. It does NOT gate the `end_at` floor.

**The "All" view passes `lowerBound = now()`.** `_build-response.ts:67-68`:

```ts
const lowerBoundUtc =
  dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString();
```

- "All" view ⇒ `dateWindowUtc === null` ⇒ `lowerBoundUtc = now()` ⇒ RPC filters `end_at >= now()`
  ⇒ ended events excluded. This is exactly the pre-0845-bug-fix behavior.
- Dated chip ⇒ `lowerBoundUtc = window.startUtc` AND `p_upper_start = window.endUtc` ⇒
  `end_at >= window_start AND start_at <= window_end` ⇒ correctly excludes events that ended before
  the window. Floor still applied.

`_business-query.ts:138-147` passes `p_lower_bound: params.lowerBoundUtc` straight through to the
RPC on every call — there is no code path that omits it.

**All serving paths:** covered by the topology proof above — fresh build runs the RPC; cache paths
replay a response that was itself produced by the RPC with the floor applied.

**Migration-chain check:** `pg_discover_business_events` is defined ONLY in
`20261001000000_orch_426_discover_rpc.sql`. `grep` of `supabase/migrations/` for "discover" returns
no later migration redefining it. This IS the authoritative current definition.

### VERDICT 1: ✅ **PRESERVED**

Enforced at `supabase/migrations/20261001000000_orch_426_discover_rpc.sql:97`
(`ed.end_at >= p_lower_bound`, unconditional INNER JOIN predicate) + `_build-response.ts:67-68`
(All-view `lowerBound = now()`).

### Note (NOT a violation — freshness, not the gated structural invariant)

The DB/L1 caches store a snapshot computed with `end_at >= now()` at build time. With L1 fresh=120s
/ stale=600s and the DB cache TTL, a cached response can momentarily include an event whose `end_at`
passes mid-TTL. This is **cache staleness**, a product-tuning property — NOT the structural
"predicate applied on all branches" invariant the 22%-leak bug was about (that bug was a *missing*
predicate, present in EVERY response). The gate protects the structural predicate; the TTL window is
out of its scope. Registered as a discovery for the orchestrator, not a blocker.

### GATE-UPDATE SPEC 1

**Target file:** `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`

The predicate now lives in SQL, not PostgREST. Re-point the gate at the RPC migration AND keep a
floor-source check on the edge layer so a future re-inlining can't silently drop it.

| | Old | New |
|---|---|---|
| `TARGET_FILE` | `supabase/functions/discover-merged-events/index.ts` | `supabase/migrations/20261001000000_orch_426_discover_rpc.sql` |
| needle 1 | `const lowerBoundUtc` | `ed.end_at >= p_lower_bound` |
| needle 2 | `.gte("event_dates.end_at", lowerBoundUtc)` | `AND ed.is_master IS TRUE` |

Plus add a SECOND target check against `supabase/functions/discover-merged-events/_build-response.ts`
for the needle `dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString()` — this
proves the "All" view still passes a `now()` floor (so the floor isn't defeated by passing a
far-past lower bound). Both targets must be GREEN for the gate to pass.

**Comment-stripping note:** the existing `findOnNonCommentLine` strips `//` lines; SQL comments are
`--`. Update the skip rule to `stripped.startsWith("//") || stripped.startsWith("--")` so a
commented-out predicate in the migration cannot satisfy the gate.

**Why a trivial bypass is impossible:** the needle `ed.end_at >= p_lower_bound` is the literal SQL
join predicate. If a later migration redefines `pg_discover_business_events` and drops/guards that
predicate (e.g. moves it behind `p_upper_start IS NOT NULL`), the literal substring vanishes from
the migration that defines the function → gate RED. Pairing it with `AND ed.is_master IS TRUE`
anchors it to the master-date join specifically (not some unrelated `end_at` comparison). The
`_build-response.ts` needle ensures the All-view floor source (`new Date().toISOString()` when
`dateWindowUtc === null`) stays present, so the SQL floor can't be neutered by feeding a past lower
bound. (Caveat documented in the spec: a strict-grep gate verifies the *latest migration that
defines the function* carries the predicate; if a future ORCH adds a NEW migration redefining the
RPC, the gate's `TARGET_FILE` must be bumped to that new filename — note this in the gate's header
so the bump is not forgotten. This matches how all migration-pinned gates in this repo behave.)

---

## INVARIANT 2 — ORCH-0839-A: I-PROPOSED-DISCOVER-META-MATCHES-ITEMS

**Contract:** the merged response's meta counts MUST match the items actually returned —
`meta.ticketmasterCount` = post-slice TM count, `meta.businessCount` = post-slice business count;
NEVER the pre-slice upstream totals. Plus: surface `tmError='ticketmaster_upstream_dropped_events'`
when TM reports `totalResults>0` but `events=[]`.

### Proof

`_build-response.ts:159-180` `mergeDiscoverResponse`:

```ts
const businessSpread = businessItems.map(it => ({ source: "business_event", item: it }));   // 160
const remainingForTm = Math.max(0, size - businessSpread.length);                           // 163
const tmSpread = tmResult.tmItems.slice(0, remainingForTm).map(...);                        // 164-166
return {
  items: [...businessSpread.slice(0, size), ...tmSpread],                                   // 169
  meta: {
    businessCount: businessSpread.length,        // 171  ← post-slice business count
    ticketmasterCount: tmSpread.length,          // 172  ← post-slice TM count
    businessTotalAvailable: businessTotal,       // 173  ← pre-slice DB total, INFORMATIONAL
    ticketmasterTotalAvailable: tmResult.tmTotal,// 174  ← pre-slice upstream total, INFORMATIONAL
    ...
```

- `businessCount` = `businessSpread.length`, NOT `businessTotal`. The pre-slice total is correctly
  relabeled `businessTotalAvailable` (line 173). Same pattern as v1, exactly the F-2 fix shape.
- `ticketmasterCount` = `tmSpread.length` (post-`.slice(0, remainingForTm)`), NOT `tmTotal`. The
  pre-slice total is `ticketmasterTotalAvailable` (line 174).

**The one subtlety — does `businessCount` over-report vs `items`?** `items` uses
`businessSpread.slice(0, size)` (line 169) while `businessCount = businessSpread.length` (line 171).
These differ ONLY if `businessSpread.length > size`. They cannot:
`businessItems` is the RPC result with `p_limit = size` (`_build-response.ts:79` `limit: size` →
`_business-query.ts:146` `p_limit: params.limit` → RPC `LIMIT GREATEST(p_limit, 0)` line 120). So
`businessItems.length ≤ size` ⇒ `businessSpread.length ≤ size` ⇒ `slice(0, size)` is a no-op ⇒
`businessCount === (# business items in items[])`. Counts match items exactly.

**tmError defensive flag** — `_build-response.ts:118-119`:

```ts
if (tmItems.length === 0 && tmTotal > 0) {
  tmError = tmError ?? "ticketmaster_upstream_dropped_events";
}
```

Present, same predicate the gate's T-B2 demands.

**All serving paths:** the merged object (items+meta) is what gets cached and replayed; cache layers
only flip `meta.fromCache`. No path recomputes counts from a different array.

### VERDICT 2: ✅ **PRESERVED**

Enforced at `supabase/functions/discover-merged-events/_build-response.ts:171-172` (post-slice
counts) and `:118-119` (dropped-events flag).

### GATE-UPDATE SPEC 2

**Target file:** `app-mobile/scripts/ci/orch-0839-a-meta-items-consistent.mjs`

Re-point the `merged` read from `index.ts` to `_build-response.ts`. The three regex contracts are
otherwise correct as written and match v2's tokens verbatim.

| | Old | New |
|---|---|---|
| read path (line 42-44) | `supabase/functions/discover-merged-events/index.ts` | `supabase/functions/discover-merged-events/_build-response.ts` |
| T-B0 regex | `ticketmasterCount:\s*tmSpread\.length` (keep) | unchanged — matches `_build-response.ts:172` |
| T-B1 regex | `businessCount:\s*businessSpread\.length` (keep) | unchanged — matches `_build-response.ts:171` |
| T-B2 regex | `tmItems\.length\s*===\s*0\s*&&\s*tmTotal\s*>\s*0` + `ticketmaster_upstream_dropped_events` (keep) | unchanged — matches `_build-response.ts:118-119` |

Only the file path changes; update the three `detail` strings + the header comment to say
`_build-response.ts` instead of `index.ts`.

**Strengthen (recommended, prevents a slice-mismatch regression):** add a 4th contract T-B3 that
greps `_build-response.ts` for `slice(0, size)` AND `businessSpread.length`, and ALSO greps the RPC
migration `20261001000000_orch_426_discover_rpc.sql` for `LIMIT GREATEST(p_limit, 0)`. This pins the
"`businessSpread.length ≤ size`" precondition that makes `businessCount === items-count` true. Without
the RPC limit, `businessCount` could legitimately exceed the sliced items count and the invariant
would silently break while T-B1's regex still passed. (Optional but closes the only real hole.)

**Why a trivial bypass is impossible:** the regexes pin `businessCount`/`ticketmasterCount` to the
post-slice `.length` accessors and explicitly forbid the pre-slice `tmTotal` / `businessTotal ??`
forms. Anyone re-pointing a count at the upstream total reintroduces the forbidden token → gate RED.
The T-B3 add-on pins the RPC `LIMIT`, so removing the limit (which would let counts diverge from
items) also goes RED.

---

## INVARIANT 3 — ORCH-0846: I-PROPOSED-CONSUMER-EVENT-ADDRESS-PARITY

**Contract:** consumer discover resolves `venueName` / `address` / `format` identically to the
brand-side. Gate currently asserts: (R-1) no `venueName: null` in the discover fn, (R-2) no
`format: "in-person"` hardcode in `ExpandedBusinessEventSheet.tsx`, (R-3) `extractVenueName`
referenced in the discover fn, (R-4) `deriveSharedFormat` referenced in the discover fn, (R-5) the
`BusinessEventCard` type carries the `"in-person"|"online"|"hybrid"` union.

### Proof

**The resolution helpers are wired up — just in `_business-query.ts`, not `index.ts`.**
`_business-query.ts:7-11` imports `extractVenueName`, `extractBusinessEventFormat`,
`deriveSharedFormat` from `_helpers.ts`. `_business-query.ts:113-120` (the `mapRpcRowToCard`
builder):

```ts
venueName: extractVenueName(theme) ?? (row.location_text as string | null) ?? null,   // 113
city:     (row.city as string | null) ?? null,                                        // 114
address:  (row.location_text as string | null) ?? null,                               // 115
...
format:   deriveSharedFormat(extractBusinessEventFormat(theme), row.is_online === true), // 117-120
```

**Parity with brand-side** (`mingla-business/src/services/publicEventsService.ts:728,751-752`):

| Field | Brand-side | v2 consumer (`_business-query.ts`) | Parity |
|---|---|---|---|
| `venueName` | `asStringOrNull(location.venueName) ?? row.location_text` (751) | `extractVenueName(theme) ?? row.location_text ?? null` (113) | ✅ same fallback chain |
| `address` | `asStringOrNull(location.address) ?? row.location_text` (752) | `row.location_text ?? null` (115) | ✅ same primary source* |
| `format` | `asFormat(businessEvent.format, row.is_online)` (728) | `deriveSharedFormat(extractBusinessEventFormat(theme), is_online)` (117) | ✅ same draft→shared map + is_online fallback |

\* The helper internals (`extractVenueName` reads `theme.business_event.venueName`; the brand-side
reads `theme.business_event.location.venueName`; brand-side `address` also tries `location.address`
first) are a **pre-existing** ORCH-0846 contract baked into `_helpers.ts`, which **this PR does NOT
touch** (`git diff --stat origin/main -- _helpers.ts` = empty). The gate's purpose is to lock that
the helper chain is *wired up*; the helper's internal logic is unchanged from the shipped 0846 fix.
v2 preserves it exactly — verified by reading `_helpers.ts:14-46`.

**RPC selects the source fields the builder needs:** `pg_discover_business_events` SELECTs
`location_text` (line 31), `location_geo` (32), `online_url` (33), `is_online` (34), `theme` (38) →
all the inputs `mapRpcRowToCard` reads for venue/address/format. No source field is dropped.

**The `BusinessEventCard` type** (`app-mobile/src/types/mergedDiscover.ts:58`) still declares
`format: "in-person" | "online" | "hybrid"` → R-5 already PASSES.

**`ExpandedBusinessEventSheet.tsx`** is untouched by this PR; lines 174-179 still consume
`card.format` / `card.venueName` (no `format: "in-person"` hardcode) → R-2 already PASSES.

**All serving paths:** every business card is produced by `mapRpcRowToCard` (the only mapper); cache
layers replay the produced cards verbatim.

### VERDICT 3: ✅ **PRESERVED**

Enforced at `supabase/functions/discover-merged-events/_business-query.ts:113-120` (venue/address/
format resolution via the unchanged `_helpers.ts` chain) + `mergedDiscover.ts:58` (type union).

### GATE-UPDATE SPEC 3

**Target file:** `.github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs`

Only Rules 3 & 4 are mis-targeted. R-1, R-2, R-5 are correct as written (R-1 trivially passes
because index.ts no longer constructs cards; keep it as a guard against re-inlining a `null`).

| Rule | Old target / needle | New target / needle |
|---|---|---|
| R-3 | `requireSubstring(discoverSrc, "extractVenueName")` on `index.ts` | `requireSubstring(businessQuerySrc, "extractVenueName")` on `supabase/functions/discover-merged-events/_business-query.ts` |
| R-4 | `requireSubstring(discoverSrc, "deriveSharedFormat")` on `index.ts` | `requireSubstring(businessQuerySrc, "deriveSharedFormat")` on `supabase/functions/discover-merged-events/_business-query.ts` |
| R-1 | `forbidOnNonCommentLine(discoverSrc, "venueName: null")` on `index.ts` | retarget to `_business-query.ts` (where cards are now built) — forbid `venueName: null` there |

Add a new constant `BUSINESS_QUERY = "supabase/functions/discover-merged-events/_business-query.ts"`
and `const businessQuerySrc = readSource(BUSINESS_QUERY);`. R-2 (sheet) and R-5 (type) keep their
current targets unchanged.

**Strengthen (recommended):** add R-6 — assert `_business-query.ts` builder line resolves venueName
with the brand-parity fallback by requiring the substring
`extractVenueName(theme) ?? (row.location_text` AND `deriveSharedFormat(`. This pins the *fallback
order*, not just that the symbol is imported, so an import that's present-but-unused can't satisfy
the gate.

**Why a trivial bypass is impossible:** `_business-query.ts` is the sole mapper (`mapRpcRowToCard`)
turning RPC rows into `BusinessEventCard`s — there is no second business-card constructor in the
function dir (verified: no other file references `BusinessEventCard` field assembly). If someone
removes `extractVenueName`/`deriveSharedFormat` or reintroduces a `venueName: null` hardcode there,
the cards lose parity AND the gate goes RED. R-5's type union + R-2's sheet guard remain anchored to
their unchanged files. The recommended R-6 anchors the actual fallback expression so a dead import
can't green the gate.

---

## Cross-check summary table

| Invariant | Verdict | Now enforced at (file:line) | Gate file | Old needle/target | New needle/target |
|---|---|---|---|---|---|
| ORCH-0845 ended-master-date | ✅ PRESERVED | `…20261001000000_orch_426_discover_rpc.sql:97` + `_build-response.ts:67` | `i-discover-excludes-ended-master-date.mjs` | `index.ts` / `const lowerBoundUtc` + `.gte("event_dates.end_at", lowerBoundUtc)` | RPC migration / `ed.end_at >= p_lower_bound` + `AND ed.is_master IS TRUE`; 2nd target `_build-response.ts` / `dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString()`; add `--` to comment-skip |
| ORCH-0839-A meta-matches-items | ✅ PRESERVED | `_build-response.ts:171-172` + `:118-119` | `orch-0839-a-meta-items-consistent.mjs` | read `index.ts` | read `_build-response.ts` (3 regexes unchanged); optional T-B3 pins RPC `LIMIT GREATEST(p_limit, 0)` |
| ORCH-0846 address parity | ✅ PRESERVED | `_business-query.ts:113-120` + `mergedDiscover.ts:58` | `orch-0846-consumer-event-address-parity.mjs` | R-3/R-4/R-1 on `index.ts` | R-3/R-4/R-1 on `_business-query.ts` (R-2,R-5 unchanged); optional R-6 pins fallback expr |

**No invariant is VIOLATED. PR #466 does not regress any of the three. It is safe to merge once the
three gates are re-pointed per the specs above** (the gates are RED only because the literals moved,
not because the invariants broke).

---

## Discoveries for Orchestrator

1. **DISC-1135-A (FYI, not a blocker):** cache TTL (L1 fresh 120s / stale 600s + DB cache TTL) can
   momentarily serve an event that ended mid-window. This is freshness tuning, outside the ORCH-0845
   structural invariant. If product wants harder freshness on ended-event exclusion, add a
   post-cache `master_end_at >= now()` re-filter on read — separate ORCH, not this gate work.
2. **DISC-1135-B (process):** all three gates are migration/helper-pinned now. The 0845 gate pins a
   specific migration FILENAME; any future ORCH that redefines `pg_discover_business_events` in a new
   migration must bump the gate's `TARGET_FILE`. Document this in each gate header (done in the spec).
3. **DISC-1135-C:** the duplicate cache-table migration `20260612000000_orch_426_discover_scale.sql`
   (already on main) and the new `20261001000000_orch_426_discover_rpc.sql` both create discover
   infra under the ORCH-426 banner. The cache table (`discover_merged_events_cache`) is defined in
   the 0612 migration; the RPC + build-lock table in the 1001 migration. No conflict observed (the
   `index.ts` reads `discover_merged_events_cache` which the 0612 migration provides). Flag for the
   orchestrator to confirm both are intended to coexist on main.

## Confidence

**proven** (source-level, for a CI-gate / SQL / edge-static invariant — exempt from the live-fire
directive per Prime Directive 7's backend/SQL/CI exemption). All three verdicts backed by file:line
evidence; all three gates run and confirmed RED in this worktree; the moved tokens located and read
in their new authoritative layers; the RPC confirmed as the latest definition via migration-chain
scan; the cache topology proven to replay (not re-derive) the builder output.

## Recommended next phase

IMPLEMENT — apply the three gate re-point specs above (CI-script edits only; NO product code), then
verify each gate goes GREEN against this worktree AND fails-on-revert (re-inline-then-remove a token
→ RED). Route to `mingla-implementor`.
