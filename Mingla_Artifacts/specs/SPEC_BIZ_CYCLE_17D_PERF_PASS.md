# SPEC — BIZ Cycle 17d (perf pass + storage hygiene + LOC decompose)

**Cycle:** 17d (BIZ — fourth + final mini-cycle of Phase 5 Refinement Pass)
**Status:** AWAITING IMPL
**Generated:** 2026-05-05
**Forensics anchor:** `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17D_PERF_PASS.md`
**Dispatch anchor:** `Mingla_Artifacts/prompts/SPEC_BIZ_CYCLE_17D_PERF_PASS.md`
**Estimated IMPL effort:** ~6-8 hrs (single-sweep per D-17d-1 Option A SPLIT)
**Codebase:** `mingla-business/`
**SPLIT discipline:** founder-feedback items are queued as **17e-A SPEC** (brand CRUD wiring) + **17e-B SPEC** (event cover media picker) AFTER 17d closes. **THIS spec does NOT include them.**

---

## 1. Layman summary

Cycle 17d closes the Refinement Pass with surgical perf + storage hygiene. **Visual UI is 100% unchanged.** Every change is structural cleanup, dead-code removal, or invisible utility wiring.

**What ships:**
1. Three unused npm dependencies removed (`@tanstack/query-async-storage-persister`, `@tanstack/react-query-persist-client`, `expo-image` — verified zero usage in `mingla-business/src/`).
2. New utility `evictEndedEvents()` called at app start — prunes phone-cached entries for events that ended >30 days ago. Prevents AsyncStorage soft-cap drift on heavy operators across 12-month usage.
3. New utility `reapOrphanStorageKeys()` called at app start — logs (does NOT auto-clear) any `mingla-business.*` AsyncStorage keys not in the known store whitelist. Safety net against future store renames leaving orphans.
4. `currentBrandStore.ts` migrate function pruned: v1-v11 dead branches removed; replaced with single `if (version < 12) reset` line. ~85 LOC trim. No live users on v1-v11.
5. Three fattest .tsx files decomposed: `CreatorStep2When` (2271 LOC), `CreatorStep5Tickets` (2148 LOC), `event/[id]/index.tsx` (1354 LOC) split into focused sub-components with `React.memo` boundaries. Reduces typing-lag on the densest screens (event creator wizard).
6. `DoorPaymentMethod` type imports verified across 3 consumer files; remove if unused (Cycle 17a §B.5 lift carry-forward).
7. Operator-side post-CLOSE: bundle baseline measurement via `npx expo export` documented for future perf-tracking.

**What stays the same:** every visual surface, every behavior, every API contract. No new TRANSITIONAL markers. No new invariants. No new memory file.

---

## 2. Scope

### IN SCOPE — 8 sections (§A through §H)

- §A — `expo-image` usage verification (pre-flight grep — already verified at SPEC time as ZERO usage)
- §B — `package.json` trim (3 unused deps removed)
- §C — `evictEndedEvents()` utility + app-start wiring
- §D — `reapOrphanStorageKeys()` utility + app-start wiring
- §E — `currentBrandStore.ts` migrate function prune (v1-v11 → single reset branch)
- §F — LOC decompose 3 fattest .tsx files
- §G — `DoorPaymentMethod` cleanup verification across 3 consumer files
- §H — Bundle baseline measurement (operator-side post-CLOSE; documented in IMPL report)

### Non-goals (explicitly excluded)

- D-17d-FOUNDER-1 brand CRUD wiring (entire §I from forensics) → **17e-A SPEC dispatch authored after 17d CLOSE**
- D-17d-FOUNDER-2 cover media picker (entire §J from forensics) → **17e-B SPEC dispatch authored after 17d CLOSE**
- D-17d-5 SecureStore auth migration → future security-hardening ORCH (NOT 17d, NOT 17e)
- New CI gates (no I-40 motion, no I-41+ proposed)
- Backend changes (no new migrations, no new edge functions)
- Visual UI changes (LOC decompose is structurally invisible)
- New TRANSITIONAL markers (this is cleanup, not new debt)
- New memory files (existing memories cover 17d's discipline)
- New invariants (17d is hardening, not contract authoring)

### Assumptions

- `LiveEvent.endedAt: string | null` field exists at `liveEventStore.ts:137` (verified at SPEC time) — eviction guard `endedAt !== null` works as specified
- All live mingla-business installs are on `currentBrand.v12` (no users stranded on v1-v11) — operator confirms via Sentry / app analytics if/when telemetry is wired; until then, the v<12 reset is safe per Cycle 0a "never seeded brands" precedent
- `@babel/parser` + `@babel/traverse` transitively present in node_modules (already verified Cycle 17b) — applies if implementor needs AST analysis during LOC decompose (likely not needed)
- Expo SDK 54 + React 19 — current stack per `package.json`
- 17c CI gates (i37 + i38 + i39) all currently green — verify pre-flight; LOC decompose may introduce new IconChrome/Pressable JSX nodes that gates must continue to pass against

---

## 3. Per-layer specifications

### §A — `expo-image` usage verification (pre-flight)

**File:** none modified in §A; this is a verification step.

**Action:** Implementor at IMPL pre-flight runs:
```
grep -r "from ['\"]expo-image['\"]" mingla-business/src/ mingla-business/app/
```

**Expected result (from SPEC-time verification):** zero matches. Only `expo-image-picker` (different package) and `app.config.ts` plugin reference exist.

**Verdict:** if zero matches → confirm `expo-image` for §B trim list. If matches found → consult orchestrator before removing.

### §B — `package.json` dependency trim

**File:** `mingla-business/package.json`

**Change:** remove these 3 entries from `dependencies`:
```json
"@tanstack/query-async-storage-persister": "^5.100.6",
"@tanstack/react-query-persist-client": "^5.100.6",
"expo-image": "~3.0.11",
```

**Action sequence:**
1. Delete the 3 lines
2. Run `npm install` (or `expo install --fix` if expo prefers) to update `package-lock.json`
3. Verify `npx tsc --noEmit` passes from `mingla-business/`
4. Commit `package.json` + `package-lock.json` together

**Note:** SPEC §A verification is pre-flight gate. If `expo-image` shows ANY src/ usage, only remove the 2 React Query persist deps + flag `expo-image` retention in IMPL report.

### §C — `evictEndedEvents()` utility + app-start wiring

#### §C.1 — New utility file

**Path:** `mingla-business/src/utils/evictEndedEvents.ts`

**Exact code contract (implementor adapts to imports + types):**

```ts
/**
 * Cycle 17d §C — TTL evict ended-event entries from phone stores.
 *
 * Prevents AsyncStorage soft-cap drift on heavy operators across 12-month
 * usage. Only evicts events with endedAt !== null AND end_at + 30d in past
 * (F-H2 guard: never evict in-progress events even if end_at slipped due
 * to concert delays).
 *
 * Called once at app start from app/_layout.tsx after Zustand hydration.
 *
 * Per Cycle 17d §C; D-17d-2 (TTL=30 days); D-17d-3 (app-start trigger).
 */

import { useLiveEventStore } from "../store/liveEventStore";
import { useOrderStore } from "../store/orderStore";
import { useGuestStore } from "../store/guestStore";
import { useEventEditLogStore } from "../store/eventEditLogStore";
import { useScanStore } from "../store/scanStore";
import { useDoorSalesStore } from "../store/doorSalesStore";

export const ENDED_EVENT_TTL_DAYS = 30;
const ENDED_EVENT_TTL_MS = ENDED_EVENT_TTL_DAYS * 86_400_000;

export interface EvictionResult {
  evictedEventCount: number;
  evictedEntryCount: number;
}

export const evictEndedEvents = (): EvictionResult => {
  const events = useLiveEventStore.getState().events;
  const now = Date.now();

  // Build set of eventIds eligible for eviction.
  // Guard: endedAt !== null (operator confirmed end) AND TTL elapsed.
  const endedEventIds = new Set<string>();
  for (const event of events) {
    if (event.endedAt === null) continue;
    const endedAtMs = Date.parse(event.endedAt);
    if (Number.isNaN(endedAtMs)) continue; // defensive — malformed timestamp
    if (now - endedAtMs > ENDED_EVENT_TTL_MS) {
      endedEventIds.add(event.id);
    }
  }

  if (endedEventIds.size === 0) {
    return { evictedEventCount: 0, evictedEntryCount: 0 };
  }

  let evictedEntryCount = 0;

  // Each store is pruned in a try/catch to prevent one store failure
  // cascading. Errors logged via console.error in DEV; Sentry breadcrumb
  // in production (Sentry SDK no-ops if init wasn't called per Cycle 16a).
  const prune = <T extends { eventId: string }>(
    store: { getState: () => { entries: T[] }; setState: (partial: Partial<{ entries: T[] }>) => void },
    label: string,
  ): void => {
    try {
      const before = store.getState().entries;
      const after = before.filter((e) => !endedEventIds.has(e.eventId));
      const pruned = before.length - after.length;
      if (pruned > 0) {
        store.setState({ entries: after });
        evictedEntryCount += pruned;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      if (__DEV__) console.error(`[evictEndedEvents] ${label} failed:`, error);
    }
  };

  prune(useOrderStore, "orderStore");
  prune(useGuestStore, "guestStore");
  prune(useEventEditLogStore, "eventEditLogStore");
  prune(useScanStore, "scanStore");
  prune(useDoorSalesStore, "doorSalesStore");

  return {
    evictedEventCount: endedEventIds.size,
    evictedEntryCount,
  };
};
```

**Static analysis flags resolved in spec:**
- No `any` types; all stores typed via Zustand inference
- No `.single()` calls (no Supabase contact)
- No silent failure: try/catch logs in DEV
- `Number.isNaN` guard for malformed timestamps (defensive)

#### §C.2 — App-start integration

**File:** `mingla-business/app/_layout.tsx`

**Change:** add a NEW `useEffect` inside `RootLayoutInner` (the existing inner component that has access to `useAuth`). Add it AFTER the existing splash-screen useEffect at line 62-74. Pattern:

```tsx
// Cycle 17d §C — TTL evict ended-event entries from phone stores (30d post end_at).
// Runs once after auth bootstrap completes (signal that Zustand persist hydration is done).
const [evictionRan, setEvictionRan] = useState(false);
useEffect(() => {
  if (loading || evictionRan) return;
  void (async () => {
    try {
      const { evictEndedEvents } = await import("../src/utils/evictEndedEvents");
      const result = evictEndedEvents();
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log(
          `[Cycle17d §C] Evicted ${result.evictedEntryCount} entries from ${result.evictedEventCount} ended events.`,
        );
      }
      setEvictionRan(true);
    } catch (error) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.error("[Cycle17d §C] evictEndedEvents threw:", error);
      }
      setEvictionRan(true); // mark ran even on failure to prevent retry-loop
    }
  })();
}, [loading, evictionRan]);
```

**Why dynamic `import()`:** keeps `evictEndedEvents` out of the cold-start critical path; only loaded after auth resolves. Optional optimization — implementor may use static import if simpler.

**Why `loading` dependency:** auth context's `loading=false` flips after Zustand hydration completes (verified by reading current useEffect at line 62 — same pattern). Eviction needs hydrated stores.

### §D — `reapOrphanStorageKeys()` utility + app-start wiring

#### §D.1 — New utility file

**Path:** `mingla-business/src/utils/reapOrphanStorageKeys.ts`

**Exact code contract:**

```ts
/**
 * Cycle 17d §D — Orphan-key safety net for AsyncStorage.
 *
 * Lists AsyncStorage keys at app start, filters to mingla-business namespace,
 * compares against known store whitelist. Logs orphans via console.warn (DEV)
 * + Sentry breadcrumb (production). Does NOT auto-clear in 17d.
 *
 * Operator promotes to auto-clear in a future cycle once log-only telemetry
 * confirms no false-positive orphan detection.
 *
 * Per Cycle 17d §D; D-17d-7.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

const KNOWN_MINGLA_KEYS = new Set<string>([
  "mingla-business.currentBrand.v12",
  "mingla-business.draftEvent.v1",
  "mingla-business.liveEvent.v1",
  "mingla-business.orderStore.v1",
  "mingla-business.guestStore.v1",
  "mingla-business.eventEditLog.v1",
  "mingla-business.notificationPrefsStore.v1",
  "mingla-business.scannerInvitationsStore.v2",
  "mingla-business.doorSalesStore.v1",
  "mingla-business.scanStore.v1",
  "mingla-business.brandTeamStore.v1",
]);

const SUPABASE_AUTH_KEY_PATTERN = /^sb-.+-auth-token$/;

export interface OrphanReapResult {
  orphanCount: number;
  orphanKeys: string[];
}

export const reapOrphanStorageKeys = async (): Promise<OrphanReapResult> => {
  let allKeys: readonly string[];
  try {
    allKeys = await AsyncStorage.getAllKeys();
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error("[reapOrphanStorageKeys] getAllKeys failed:", error);
    }
    return { orphanCount: 0, orphanKeys: [] };
  }

  const orphanKeys: string[] = [];

  for (const key of allKeys) {
    // Phase 1: filter to relevant namespaces
    const isMinglaKey = key.startsWith("mingla-business.");
    const isSupabaseAuthKey = SUPABASE_AUTH_KEY_PATTERN.test(key);
    if (!isMinglaKey && !isSupabaseAuthKey) continue;

    // Phase 2: check whitelist
    if (isMinglaKey && !KNOWN_MINGLA_KEYS.has(key)) {
      orphanKeys.push(key);
    }
    // Note: Supabase auth keys are dynamic (project-ref prefix) — accepted as load-bearing
    // even though pattern-matched only.
  }

  if (orphanKeys.length > 0) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        `[reapOrphanStorageKeys] Found ${orphanKeys.length} orphan AsyncStorage key(s):`,
        orphanKeys,
      );
    }
    // Sentry breadcrumb in production for telemetry. Sentry SDK is no-op
    // if init wasn't called per Cycle 16a env-absent guard.
    Sentry.addBreadcrumb({
      category: "storage.orphan",
      level: "warning",
      message: `Orphan AsyncStorage keys: ${orphanKeys.length}`,
      data: { keys: orphanKeys },
    });
  }

  return { orphanCount: orphanKeys.length, orphanKeys };
};
```

#### §D.2 — App-start integration

**File:** `mingla-business/app/_layout.tsx`

**Change:** add SECOND new `useEffect` inside `RootLayoutInner`, sibling to the §C eviction useEffect. Same pattern (dynamic import + run-once flag), invoked after `loading=false`:

```tsx
// Cycle 17d §D — orphan-key safety net (log-only; operator promotes to auto-clear in future cycle).
const [reapRan, setReapRan] = useState(false);
useEffect(() => {
  if (loading || reapRan) return;
  void (async () => {
    try {
      const { reapOrphanStorageKeys } = await import("../src/utils/reapOrphanStorageKeys");
      await reapOrphanStorageKeys();
      setReapRan(true);
    } catch (error) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.error("[Cycle17d §D] reapOrphanStorageKeys threw:", error);
      }
      setReapRan(true);
    }
  })();
}, [loading, reapRan]);
```

**Why log-only:** false-positive risk during the transition (e.g., a key the implementor missed). Operator reviews logs over 1-2 weeks; promotes to auto-clear in a future polish ORCH once confidence is high.

### §E — `currentBrandStore.ts` migrate prune

**File:** `mingla-business/src/store/currentBrandStore.ts`

**Lines 428-516 (existing migrate() body):** ~88 LOC of v1-v11 → v12 upgrade chain logic.

**Replacement (new lines 428-???):**

```ts
migrate: (persistedState, version) => {
  // Cycle 17d §E — v1-v11 dead branches removed. No live users on those versions.
  // If a stale install lands here, reset to default state. Safe per Cycle 0a
  // "never seeded brands" precedent — losing local brand cache forces re-fetch
  // from server (or in 17e-A's wired DB layer, no-op since brands table is the
  // source of truth and currentBrandStore is a read-through cache going forward).
  //
  // Original migrate() body (Cycle 0a-13a chain v1→v2→v3→v9→v10→v11→v12) at
  // commit aae7784d (or any commit prior to this CLOSE) for audit trail.
  if (version < 12) {
    return { currentBrand: null, brands: [] };
  }
  return persistedState as PersistedState;
},
```

**Action:** also delete the now-unused `upgradeV2BrandToV3`, `upgradeV9BrandToV10`, `upgradeV10BrandToV11`, `upgradeV11BrandToV12` helper functions + their `V2Brand` / `V9Brand` / `V10Brand` / `V11Brand` type definitions. These are pure dead code post-prune. Implementor verifies with `tsc` that nothing else references them.

**Estimated LOC delta:** -85 to -120 (88 LOC migrate body + ~30-50 LOC of helper fns + types).

### §F — LOC decompose 3 fattest .tsx files

#### §F.1 — Universal constraints (apply to all 3)

- **No behavior change.** Pure structural refactor — same props, same handlers, same render output, same accessibility tree.
- **No new TRANSITIONAL markers.** Pure refactor leaves no debt.
- **Implementor invokes `/ui-ux-pro-max` pre-flight** per `feedback_implementor_uses_ui_ux_pro_max` (touch surfaces are visible UI even though refactor is invisible).
- **Sub-components:** prefer `React.memo` only where profiling shows benefit — default reference-check is fine for most.
- **Naming convention:** sub-components live in same directory as parent unless they're shared (then move to `mingla-business/src/components/<domain>/`).
- **Post-refactor verification:** all 3 CI gates (i37 + i38 + i39) must still exit 0. New IconChrome / Pressable JSX nodes (if any) must inherit explicit `accessibilityLabel=` (TS-required) + 44pt-effective touch.
- **tsc clean** post each file's refactor.
- **Visual smoke:** operator confirms wizard / event detail screens still work end-to-end at IMPL post-flight.

#### §F.2 — `mingla-business/src/components/event/CreatorStep2When.tsx` (2271 → ~1300-1500 LOC target)

**Implementor pre-flight:** read full file at IMPL time to identify natural extraction boundaries.

**Recommended extractions (verify + adapt):**
- Repeat-pattern picker sheet (around line 1231 per forensics §B.4 / Cycle 17c §D.1) → new file `mingla-business/src/components/event/CreatorStep2WhenRepeatPickerSheet.tsx`
- Multi-date override handlers → extend existing `MultiDateOverrideSheet.tsx` OR new file `CreatorStep2WhenOverrideHandlers.ts` (logic-only, no JSX)
- Recurrence rule helpers → `recurrenceRule.ts` util already exists (already extracted per Cycle 4 — leave verbatim)

**Estimated extraction:** 700-900 LOC moved.

#### §F.3 — `mingla-business/src/components/event/CreatorStep5Tickets.tsx` (2148 → ~1200-1400 LOC target)

**Recommended extractions:**
- Per-tier card render → new file `mingla-business/src/components/event/TicketTierCard.tsx` (memoized — high re-render benefit since N tiers re-render on every keystroke today)
- Tier add/edit sheet → new file `mingla-business/src/components/event/TicketTierEditSheet.tsx`
- Pricing helpers → util file `mingla-business/src/utils/ticketPricing.ts` OR extend existing `currency.ts`

**Estimated extraction:** 700-900 LOC moved.

#### §F.4 — `mingla-business/app/event/[id]/index.tsx` (1354 → ~800-1000 LOC target)

**Recommended extractions (implementor identifies dense sections):**
- Header / hero panel → new file `mingla-business/src/components/event/EventDetailHero.tsx`
- Stats panel → new file `EventDetailStats.tsx`
- Action cluster → new file `EventDetailActions.tsx`

**Estimated extraction:** 400-600 LOC moved.

#### §F.5 — Verification checklist per file

- [ ] `npx tsc --noEmit` exits 0
- [ ] `node .github/scripts/strict-grep/i37-topbar-cluster.mjs` exits 0
- [ ] `node .github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` exits 0
- [ ] `node .github/scripts/strict-grep/i39-pressable-label.mjs` exits 0
- [ ] Visual smoke (operator-side post-IMPL)

### §G — `DoorPaymentMethod` cleanup verification

**3 candidate files** (per Cycle 17a §B.5 lift carry-forward + Cycle 17d forensics §D):
- `mingla-business/app/event/[id]/door/[saleId].tsx`
- `mingla-business/app/event/[id]/door/index.tsx`
- `mingla-business/app/event/[id]/guests/[guestId].tsx`

**Action per file:**
1. Read file body
2. Grep `DoorPaymentMethod` usage in the file (excluding the import line)
3. If usage exists (e.g., parameter type, return type, generic): leave verbatim
4. If no usage: remove the `type DoorPaymentMethod` from the import line
5. Document verdict per file in IMPL report under §G

**Expected outcome:** at least 1 of 3 imports removable based on Cycle 17a §B.5 lift pattern; could be all 3.

**LOC delta:** -3 to -6 lines.

### §H — Bundle baseline measurement (operator-side post-CLOSE)

**This is NOT a code change in 17d.** Implementor documents in IMPL report under "Operator-side post-CLOSE actions":

```
Bundle baseline measurement (operator runs after 17d commit + push):
1. cd mingla-business
2. npx expo export --platform ios --dump-sourcemap --output-dir dist/
3. (Inspect dist/_expo/static/js/ios/*.hbc.map or platform-equivalent)
4. Either:
   - npx source-map-explorer dist/_expo/static/js/ios/*.hbc.map
   - OR open the HTML report it generates
5. Capture top-10 largest dependencies + their gzipped sizes + uncompressed sizes
6. Append to a new Mingla_Artifacts/PERF_BASELINE.md file dated post-17d
```

**Why operator-side:** implementor cannot run `expo export` reliably without a working device-emulator + Expo SDK setup; operator already runs these commands for OTA + dev workflows.

**Why this matters:** establishes a baseline so 17e-B (event cover media picker via Giphy/Pexels edge function proxy) can verify it doesn't bloat the bundle.

---

## 4. Success criteria (numbered, observable, testable)

| SC | Criterion | Verification method |
|---|---|---|
| **SC-A1** | `expo-image` has zero usage in `mingla-business/src/` and `mingla-business/app/` | `grep -r "from ['\"]expo-image['\"]" mingla-business/src/ mingla-business/app/` returns 0 hits |
| **SC-B1** | `package.json` no longer contains `@tanstack/query-async-storage-persister` | Direct file read |
| **SC-B2** | `package.json` no longer contains `@tanstack/react-query-persist-client` | Direct file read |
| **SC-B3** | `package.json` no longer contains `expo-image` (CONDITIONAL on §A) | Direct file read OR justified retention in IMPL report |
| **SC-B4** | `npx tsc --noEmit` exits 0 post-package-trim | `cd mingla-business && npx tsc --noEmit` |
| **SC-B5** | `package-lock.json` updated to reflect package.json removals | Direct file read shows the corresponding entries gone |
| **SC-C1** | `mingla-business/src/utils/evictEndedEvents.ts` exists with verbatim contract per §C.1 | Direct file read |
| **SC-C2** | `evictEndedEvents()` guards on `event.endedAt !== null` (F-H2) | Direct file read of util |
| **SC-C3** | `app/_layout.tsx` calls `evictEndedEvents()` once after `loading=false` | Direct file read of `_layout.tsx` |
| **SC-C4** | TTL constant = 30 days | Direct file read confirms `ENDED_EVENT_TTL_DAYS = 30` |
| **SC-D1** | `mingla-business/src/utils/reapOrphanStorageKeys.ts` exists with verbatim contract per §D.1 | Direct file read |
| **SC-D2** | `reapOrphanStorageKeys()` does NOT auto-clear orphans (log-only) | Direct file read confirms no `AsyncStorage.removeItem` calls |
| **SC-D3** | Whitelist matches the 11 known `mingla-business.*` keys | Direct file read of util's `KNOWN_MINGLA_KEYS` |
| **SC-D4** | `app/_layout.tsx` calls `reapOrphanStorageKeys()` once after `loading=false` | Direct file read |
| **SC-E1** | `currentBrandStore.ts` migrate function uses `if (version < 12) reset` pattern | Direct file read lines 428-?? |
| **SC-E2** | Helper functions `upgradeV2BrandToV3`, `upgradeV9BrandToV10`, `upgradeV10BrandToV11`, `upgradeV11BrandToV12` deleted from `currentBrandStore.ts` | Grep returns 0 hits in file |
| **SC-E3** | Type definitions `V2Brand`, `V9Brand`, `V10Brand`, `V11Brand` deleted | Grep returns 0 hits |
| **SC-E4** | tsc clean post-prune | `npx tsc --noEmit` exits 0 |
| **SC-F1** | `CreatorStep2When.tsx` LOC reduced to 1300-1500 range | `wc -l mingla-business/src/components/event/CreatorStep2When.tsx` |
| **SC-F2** | `CreatorStep5Tickets.tsx` LOC reduced to 1200-1400 range | `wc -l` |
| **SC-F3** | `event/[id]/index.tsx` LOC reduced to 800-1000 range | `wc -l` |
| **SC-F4** | All 3 CI gates (i37 + i38 + i39) exit 0 post-decompose | Run all 3 gates locally |
| **SC-F5** | tsc clean post-each-file refactor | `npx tsc --noEmit` exits 0 |
| **SC-G1** | Each of the 3 DoorPaymentMethod consumer files documented in IMPL report with import-removal verdict | IMPL report §G table populated |
| **SC-H1** | Operator-side bundle baseline instructions verbatim in IMPL report under "Operator-side post-CLOSE actions" | IMPL report read |
| **SC-PRE** | `npx tsc --noEmit` exits 0 against final code state | Build |
| **SC-CI** | All 3 CI gates exit 0 against final code state | Run gates |

**26 SC items total.**

---

## 5. Invariants

**Preserved (must continue to hold post-17d):**
- I-37 TOPBAR-DEFAULT-CLUSTER-ON-PRIMARY-TABS — verify post-§F (LOC decompose may introduce new TopBar consumers via sub-component extraction)
- I-38 ICONCHROME-TOUCH-TARGET-AA-COMPLIANT — verify post-§F (new sub-components may add IconChrome usages)
- I-39 INTERACTIVE-PRESSABLE-ACCESSIBILITY-LABEL — verify post-§F (new sub-components may add Pressable usages)
- All 14 constitutional rules — particularly #2 (one owner per truth — `evictEndedEvents` doesn't introduce parallel ownership), #3 (no silent failures — try/catch logs), #7 (label temporary — no new TRANSITIONAL), #8 (subtract before adding — package trim + migrate prune are pure subtractions)

**No new invariants in 17d.** This is hardening, not contract authoring.

---

## 6. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A1 | expo-image grep clean | Run grep | 0 hits | Static |
| T-B1 | post-trim tsc | `npx tsc --noEmit` | Exit 0 | Build |
| T-B2 | dev mode launch | `npx expo start` (operator) | App starts; no missing-dep error | Runtime |
| T-C1 | Eviction with no ended events | Empty `endedAt` set | `{ evictedEventCount: 0, evictedEntryCount: 0 }` | Util |
| T-C2 | Eviction with TTL-expired event | Mock event `endedAt = 31 days ago`, orderStore has 5 entries for that eventId | Returns `{evictedEventCount: 1, evictedEntryCount: 5}`; orderStore filtered | Util |
| T-C3 | Eviction guard: in-progress event | Mock event `endedAt = null`, end_at in past | Event NOT evicted (guard works) | Util |
| T-C4 | Eviction guard: malformed timestamp | Mock event `endedAt = "not-a-date"` | Event NOT evicted (Number.isNaN guard); no crash | Util |
| T-C5 | Eviction app-start | Cold-start app | Console log in DEV; tsc clean | Runtime |
| T-D1 | reapOrphan with clean state | All keys in whitelist | `{ orphanCount: 0, orphanKeys: [] }` | Util |
| T-D2 | reapOrphan with synthetic orphan | `AsyncStorage.setItem("mingla-business.fake.v1", "...")` | Returns `orphanCount: 1, orphanKeys: ["mingla-business.fake.v1"]`; console.warn in DEV; key NOT cleared | Util |
| T-D3 | reapOrphan with Supabase auth key | `sb-abc-auth-token` exists | Pattern-matched; NOT flagged as orphan | Util |
| T-E1 | currentBrand v12 passthrough | `version = 12, persistedState = {currentBrand, brands}` | Returns persistedState verbatim | Migrate |
| T-E2 | currentBrand v11 reset | `version = 11` | Returns `{currentBrand: null, brands: []}` | Migrate |
| T-E3 | currentBrand v1 reset | `version = 1` | Returns `{currentBrand: null, brands: []}` | Migrate |
| T-F1 | CreatorStep2When functional smoke | Open event creator wizard Step 2; pick a recurrence preset | Same behavior as pre-17d | Live-fire |
| T-F2 | CreatorStep5Tickets functional smoke | Add a ticket tier; edit an existing tier | Same behavior | Live-fire |
| T-F3 | event/[id] functional smoke | Open any event detail screen | Same render output | Live-fire |
| T-F4 | i37/i38/i39 post-§F | Run all 3 gates | All exit 0 | CI |
| T-G1 | DoorPaymentMethod usage check | Grep file body | If grep returns matches → import retained; else → removed | Static |
| T-PRE | Final tsc | `npx tsc --noEmit` | Exit 0 | Build |
| T-CI | Final 3 gates | Run all 3 | All exit 0 | CI |

**21 test cases.**

---

## 7. Implementation order (sequential — single-sweep per D-17d-1)

1. **§A — Pre-flight grep verification** (`expo-image` usage in `mingla-business/src|app`) — 5 min
2. **§B — `package.json` trim** (3 deps) + `npm install` + tsc baseline — 15 min
3. **§E — `currentBrandStore.ts` migrate prune** + helper-fn deletion + tsc — 30 min
4. **§G — DoorPaymentMethod cleanup verification + removal across 3 files** + tsc — 20 min
5. **§C — `evictEndedEvents()` utility authoring + unit-test mock-style verification + tsc** — 1 hr
6. **§D — `reapOrphanStorageKeys()` utility authoring + tsc** — 45 min
7. **`app/_layout.tsx` integration: §C + §D useEffects added** + tsc — 20 min
8. **§F.2 — `CreatorStep2When.tsx` decompose** (`/ui-ux-pro-max` pre-flight + extraction + tsc + 3 CI gates) — 1.5 hrs
9. **§F.3 — `CreatorStep5Tickets.tsx` decompose** — 1.5 hrs
10. **§F.4 — `event/[id]/index.tsx` decompose** — 1 hr
11. **Post-flight: final tsc + all 3 CI gates** — 15 min
12. **§H — IMPL report includes operator-side bundle baseline instructions** — 15 min
13. **Write `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17D_PERF_PASS_REPORT.md`** per template — included in 12

**Total estimate: ~7 hrs** (matches forensics 6-8h projection).

**Pre-flight per `feedback_implementor_uses_ui_ux_pro_max`:** Step 8 (CreatorStep2When refactor) MUST invoke `/ui-ux-pro-max` before code, even though refactor is structurally invisible. Same for steps 9 + 10. Single invocation can cover all 3 if the design query is generic enough.

---

## 8. Regression prevention

| Class of regression | Prevention |
|---|---|
| Eviction over-aggressive (cancels in-progress events) | F-H2 guard: `endedAt !== null` AND TTL elapsed; T-C3 test verifies |
| Eviction over-aggressive (timezone bug) | Use UTC `Date.parse` + ms math; T-C4 verifies malformed-timestamp guard |
| Orphan-reaper accidentally clears live data | NOT auto-clearing in 17d; only logging. Operator promotes to clear in future cycle after telemetry-confirmed safety |
| Migrate prune breaks stale-install user | Reset is safe per Cycle 0a "never seeded brands" precedent; user re-fetches from server (or no-op once 17e-A wires brands DB layer) |
| Package trim breaks dev mode | `tsc --noEmit` post-trim verifies; T-B1; if dev-mode runtime fails (reads at startup), implementor catches at "expo start" smoke and reverts the specific dep |
| LOC decompose breaks adjacent feature | Functional smokes T-F1/F2/F3 (operator live-fire post-IMPL); 3 CI gates verify accessibility/touch invariants preserved |
| Future store rename leaves orphan | `reapOrphanStorageKeys()` logs detect it; future cycle promotes to auto-clear |

---

## 9. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Unused `expo-image` dep is actually needed by an indirect transitive import | LOW | MEDIUM | §A pre-flight grep is exhaustive; if found used, leave verbatim + flag in IMPL report |
| Eviction TTL hits a vestibulating organiser ("I want to see last quarter's data") | MEDIUM | LOW | 30-day TTL is a reasonable trade; if operator complains, future cycle bumps to 90d via DEC entry |
| LOC decompose introduces hidden re-render regression | MEDIUM | MEDIUM | `React.memo` only where profiling shows benefit; if profiling skipped, regression unlikely (refactor doesn't change render shape) |
| `currentBrandStore` v11 reset strands an active user | LOW | LOW | Per Cycle 0a precedent + brand list is read-through cache; no permanent data loss |
| `app/_layout.tsx` integration introduces hydration-race condition | LOW | MEDIUM | `loading=false` dependency is the Cycle 16a-established pattern; reuse, don't re-invent |
| `npm install` post-trim doesn't update `package-lock.json` consistently | LOW | LOW | Implementor verifies lock-file diff; if missed, CI / dev-mode startup catches |

---

## 10. Operator-side checklist

### 10.1 Pre-CLOSE manual gates

- [ ] Operator runs `npx expo start` post-IMPL; cold-start succeeds (no dep-load error)
- [ ] Operator opens event creator wizard; navigates Step 2 + Step 5; confirms recurrence picker + ticket tier add/edit work
- [ ] Operator opens any event detail screen; confirms hero + stats + actions render correctly
- [ ] Operator checks DEV console at app start: `[Cycle17d §C] Evicted X entries from Y ended events.` log fires (X may be 0 if no ended events meet TTL)
- [ ] Operator checks DEV console: `[reapOrphanStorageKeys] Found N orphan keys` either silent (clean) or warns (orphan detected — review keys)

### 10.2 Bundle baseline (per §H)

```bash
cd mingla-business
npx expo export --platform ios --dump-sourcemap --output-dir dist/
# Inspect dist/_expo/static/js/ios/*.hbc.map (or equivalent)
npx source-map-explorer dist/_expo/static/js/ios/*.hbc.map
```

Capture top-10 deps + sizes; append to `Mingla_Artifacts/PERF_BASELINE.md` (new file).

### 10.3 Commit message draft (per `feedback_no_coauthored_by` — no AI attribution)

```
feat(business): Cycle 17d — perf pass + storage hygiene + LOC decompose

- Remove 3 unused npm deps: @tanstack/query-async-storage-persister, @tanstack/react-query-persist-client, expo-image
- New util evictEndedEvents() called at app start: 30-day TTL eviction for orderStore/guestStore/eventEditLogStore/scanStore/doorSalesStore entries from ended events; F-H2 guard against in-progress events
- New util reapOrphanStorageKeys() called at app start: log-only safety net for unknown mingla-business.* AsyncStorage keys; promotes to auto-clear in future cycle
- currentBrandStore migrate prune: v1-v11 dead branches → single if(version<12) reset; ~85 LOC trim + 4 helper fns + 4 type defs deleted
- LOC decompose 3 fattest .tsx: CreatorStep2When (2271→target ~1400), CreatorStep5Tickets (2148→~1300), event/[id]/index.tsx (1354→~900); ~1900-2500 LOC extracted into focused sub-components
- DoorPaymentMethod type imports cleanup across 3 consumer files (Cycle 17a §B.5 carry-forward)

Visual UI unchanged. tsc clean. 3 CI gates green (i37 + i38 + i39).
ORCH-IDs closed: D-17d-1..D-17d-8 (perf scope only); D-17d-FOUNDER-1 + D-17d-FOUNDER-2 queued as 17e-A + 17e-B.
QA verdict: PASS.
```

### 10.4 EAS dual-platform OTA (per `feedback_eas_update_no_web` — two separate commands)

```bash
cd mingla-business && eas update --branch production --platform ios --message "Cycle 17d perf pass + storage hygiene + LOC decompose"
cd mingla-business && eas update --branch production --platform android --message "Cycle 17d perf pass + storage hygiene + LOC decompose"
```

### 10.5 CLOSE protocol reminders (per `feedback_post_pass_protocol`)

- Update all 7 close-protocol artifacts (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS)
- Author DEC-105 entry in DECISION_LOG.md with the 8 D-17d-N decisions batched (DEC-103 reserved by ORCH-0733 Gemini cutoff; DEC-104 used by 17c CLOSE; DEC-105 unless ORCH-0734 closes first → bump to DEC-106)
- **No new invariants to flip** (17d is hardening, not contract authoring)
- **No new memory file to flip** (17d uses existing memories)

### 10.6 Post-17d-CLOSE next dispatches (queued)

- **17e-A SPEC dispatch** authored by orchestrator → forensics SPEC mode → covers brand CRUD wiring (create + read + update + delete) per D-17d-FOUNDER-1
- **17e-B SPEC dispatch** authored by orchestrator → forensics SPEC mode → covers event cover media picker (Tier 1: event cover with [Upload | Giphy | Pexels] tabs via edge function proxy) per D-17d-FOUNDER-2

---

**End of spec.**
