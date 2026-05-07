# SPEC — ORCH-0743 — currentBrand cold-start polish + ORCH-0742 fallout cleanup

**Mode:** SPEC (Forensics SPEC mode; INVESTIGATE phase done by predecessor evidence below)
**Authored by:** mingla-forensics, 2026-05-06
**Dispatch:** [`prompts/SPEC_ORCH_0743_CURRENT_BRAND_COLD_START_POLISH.md`](../prompts/SPEC_ORCH_0743_CURRENT_BRAND_COLD_START_POLISH.md)
**Predecessor evidence:**
- [`reports/QA_ORCH_0742_PHASE_2_REPORT.md`](../reports/QA_ORCH_0742_PHASE_2_REPORT.md) — C1, C2, C3, C4 (cold-start polish conditions)
- [`reports/INVESTIGATION_ORCH_0744_LATENT_DEFECTS_SWEEP.md`](../reports/INVESTIGATION_ORCH_0744_LATENT_DEFECTS_SWEEP.md) — RC-1, RC-2, CF-2, CF-3 (ORCH-0744 forensic findings folded in)
- [`reports/IMPLEMENTATION_ORCH_0742_REPORT.md`](../reports/IMPLEMENTATION_ORCH_0742_REPORT.md) — what shipped in ORCH-0742
- [`specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md`](SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md) — §4.2 (relocation contract this SPEC finishes), §4.7 (hydration contract this SPEC closes)

**Branch / commit at SPEC time:** `Seth` / `cfb121e8`

---

## 0. Layman summary

ORCH-0742 shipped the architectural fix (currentBrand ID-only persist) but left four loose ends that surfaced after CLOSE: a cold-start visual flash where the app briefly renders "no brand" before React Query resolves the live Brand row; a deep-link edge case in `/event/create` that redirects to home before the fetch completes; an obsolete error-log message; and the require-cycle the SPEC §4.2 explicitly tried to prevent.

ORCH-0744 forensics found three more defects on the same surface: a **latent destruction risk** where the orphan-key reaper whitelists the wrong persist version (v12 vs the live v14 — promote the reaper to delete-mode and it wipes ORCH-0742 silently); a web-deprecated `textShadow*` style on the event hero (the source of the Metro warning); and 15 leftover `[ORCH-XXXX-DIAG]` console.error markers from 5 closed cycles still firing on every brand mutation.

This SPEC bundles all eight items into one coherent mingla-business code-side cleanup cycle. **No DB changes. No edge-function changes. No new dependencies.** Single commit's worth of "ORCH-0742 fallout cleanup."

---

## 1. Pre-flight investigation summary (from predecessors, re-verified at SPEC time)

### 1.1 — RC-1 confirmed via direct file read

`mingla-business/src/store/currentBrandStore.ts:446`:
```ts
export { useCurrentBrand } from "../hooks/useCurrentBrand";
```

`mingla-business/src/hooks/useCurrentBrand.ts:30-34`:
```ts
import { useBrand } from "./useBrands";
import {
  useCurrentBrandStore,
  type Brand,
} from "../store/currentBrandStore";
```

→ Bidirectional dependency at module-init. Metro emits `Require cycle:` warning each cold-start.

### 1.2 — RC-2 confirmed via direct file read (LATENT DESTRUCTION)

`mingla-business/src/utils/reapOrphanStorageKeys.ts:17-29`:
```ts
const KNOWN_MINGLA_KEYS = new Set<string>([
  "mingla-business.currentBrand.v12",  // ← STALE — actual current key is v14
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
```

`mingla-business/src/store/currentBrandStore.ts:375`:
```ts
name: "mingla-business.currentBrand.v14",
```

→ Mismatch verified char-for-char. Reaper reports the LIVE v14 blob as ORPHAN every cold-start. Today log-only per Cycle 17d §D; promote-to-delete = catastrophe.

### 1.3 — CF-2 confirmed via direct file read

`mingla-business/app/event/[id]/index.tsx:819-828`:
```ts
heroTitle: {
  fontSize: 24,
  fontWeight: "700",
  letterSpacing: -0.2,
  color: "#ffffff",
  textShadowColor: "rgba(0, 0, 0, 0.4)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 12,
  marginBottom: 4,
},
```

→ Three RN-only props that react-native-web silently strips. Hero text shadow invisible on Expo Web. Source of the Metro `"shadow*" deprecated` warning.

### 1.4 — CF-3 confirmed via direct file read (15 markers across 4 files)

| File | Lines | ORCH-IDs | Block type |
|---|---|---|---|
| `BrandSwitcherSheet.tsx` | 124-130 | 0728 | AUTH-NOT-READY guard with diagnostic-only log; preserve `if (...) return;` |
| `BrandSwitcherSheet.tsx` | 135-149 | 0728 | PRE-MUTATE session probe (sessionProbe const + diagnostic) — **entire `sessionProbe` chain is diagnostic-only** because the actual mutation at line 305 uses `user.id` directly, not session |
| `BrandSwitcherSheet.tsx` | 150-208 | 0733 | JWT decode probe (try-catch wrapper + nested decode + diagnostic log) — wholesale delete |
| `BrandSwitcherSheet.tsx` | 209-260 | 0729 | Raw fetch probe — wholesale delete |
| `BrandSwitcherSheet.tsx` | 261-304 | 0730 | Creator-accounts probe — wholesale delete |
| `BrandSwitcherSheet.tsx` | 316-326 | 0728 | Catch-block diagnostic; preserve catch + downstream `if (error instanceof SlugCollisionError)` logic |
| `useBrands.ts` | 185-196 | 0728 | useCreateBrand.onError diagnostic; preserve rollback at lines 198-205 |
| `useBrands.ts` | 273-284 | 0728 | useUpdateBrand.onError diagnostic; preserve rollback at lines 285-290 |
| `useBrands.ts` | 322-324 | 0734-RW | useSoftDeleteBrand mutationFn ENTER probe; preserve `softDeleteBrand(brandId)` at line 325 |
| `useBrands.ts` | 326-331 | 0734-RW | useSoftDeleteBrand mutationFn RESULT probe; preserve `return result;` at line 332 |
| `useBrands.ts` | 351-358 | 0734-RW | useSoftDeleteBrand.onError diagnostic; preserve `// Caller's mutateAsync still receives the throw` comment + intent at line 359 |
| `brandsService.ts` | 228-233 | 0734-RW | softDeleteBrand step 2 UPDATE ATTEMPT log; preserve subsequent supabase.update().select("id") chain at line 234 |
| `brandsService.ts` | 242-248 | 0734-RW | softDeleteBrand step 2 UPDATE RESULT log; preserve `if (data === null || data.length === 0) throw...` at line 249 |
| `creatorAccount.ts` | 30-41 | 0728 | ensureCreatorAccount error log; preserve `if (error)` guard structure (the `if (error) {}` becomes empty after console.error removal — collapse to `if (error) throw error;` per Const #3 — see Note A below) |

**Note A — `creatorAccount.ts:30-41` special case:** the existing block is:
```ts
if (error) {
  // [DIAG ORCH-0728-PASS-3] — replaced by logError() on full IMPL
  // eslint-disable-next-line no-console
  console.error("[ORCH-0728-DIAG] creatorAccount#ensureCreatorAccount FAILED", { ... });
}
```
Removing the console.error leaves an empty `if (error) { }` block that **silently swallows the error** — Const #3 violation. Implementor MUST either (a) collapse to `if (error) throw error;` (preferred, surfaces error to caller), or (b) leave a single-line `if (error) throw error;` if the surrounding function signature already throws. Verify call sites of `ensureCreatorAccount` handle the throw before locking choice. **Default decision: (a)** — see Implementation Order Step 6.

### 1.5 — C1 root cause re-confirmed via direct file read

`mingla-business/app/_layout.tsx:55-75` splash-gate logic:
```ts
const SPLASH_MIN_VISIBLE_MS = 500;

function RootLayoutInner(): React.ReactElement {
  const { loading } = useAuth();   // ← gates ONLY on AuthContext loading
  const mountedAt = useRef(Date.now());
  const [splashHidden, setSplashHidden] = useState(false);

  useEffect(() => {
    if (loading || splashHidden) return;
    const elapsed = Date.now() - mountedAt.current;
    const remaining = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync().catch(() => {});
      setSplashHidden(true);
    }, remaining);
    return () => clearTimeout(timer);
  }, [loading, splashHidden]);
```

→ Splash hides on `loading: false && elapsed >= 500ms`. Does NOT wait for `useBrand(currentBrandId).isFetched`. This is the C1 flash root cause confirmed.

### 1.6 — C3 scope CORRECTION via direct file read

The QA report C3 listed three sites for migration to `useCurrentBrandId`: `home.tsx:103`, `events.tsx:111`, `event/create.tsx:39`. Direct read shows:

- `home.tsx:103` — `currentBrand = useCurrentBrand()`. Used at line 181 for `currentBrand?.currentLiveEvent ?? null` (full Brand needed for the live-event card). **STAYS as `useCurrentBrand`** — not ID-only.
- `events.tsx:111` — `currentBrand = useCurrentBrand()`. Used at lines 530, 562 as `brand={currentBrand}` prop to child components (`SettlementSheetView`, `ManageEventSheet`). **STAYS as `useCurrentBrand`** — not ID-only.
- `event/create.tsx:39` — `currentBrand = useCurrentBrand()`. Used only at line 47 `createDraft(currentBrand.id)`. **MIGRATES to `useCurrentBrandId()`** — ID-only.

→ C3 narrows to **1 site** (event/create.tsx). The home/events flash isn't fixed by `useCurrentBrandId` migration; it's fixed by C1 (extend splash gate). This SPEC honors that distinction. Discovery filed as D-0743-FOR-1 below.

---

## 2. Scope, Non-goals, Assumptions

### 2.1 — Scope (8 sub-deliverables)

| ID | Sub-deliverable | LOC est. | Effort |
|---|---|---|---|
| C1 | Extend splash gate in `_layout.tsx` to wait on `useBrand(currentBrandId).isFetched` (with 2s hard timeout fallback) | ~25 | 2-4h |
| C2 | `event/create.tsx` redirect-on-null edge case fixed by C3 migration (same code change) | 0 incremental | included in C3 |
| C3 | Migrate `event/create.tsx:39` from `useCurrentBrand()` → `useCurrentBrandId()` | ~5 | 30min |
| C4 | `liveEventConverter.ts:46` log message: "store" → "cache" | 1 | 5min |
| RC-1 | Break `currentBrandStore.ts ↔ useCurrentBrand.ts` cycle by extracting `Brand` type to `src/types/brand.ts` + dropping store re-export | ~60 | 1.5h |
| RC-2 | `reapOrphanStorageKeys.ts:18` whitelist `v12 → v14` + add unit test | ~20 | 30min |
| CF-2 | `event/[id]/index.tsx:824-826` `textShadow*` → `Platform.select` web/native | ~8 | 30min |
| CF-3 | Mass-delete 15 `[ORCH-XXXX-DIAG]` markers across 4 files (with Note A applied to creatorAccount.ts) | ~-180 net | 1h |

**Total:** ~1 day implementor effort. Single coherent commit on `mingla-business/`.

### 2.2 — Non-goals (rejected if implementor drifts)

- **Cycle 3 Realtime push** (separate ORCH; cross-device propagation lag from 30s→2s).
- **Cycle 4 per-store Zustand classification audit** (separate; verifies remaining 10 stores against I-PROPOSED-J).
- **React Query AsyncStorage persistence** (alternative C1 Option (b) per dispatch — bigger scope ~1 day; deferred to a future cycle if Option (a) proves insufficient).
- **Touching ORCH-0742 architectural decisions** beyond bug fixes above. The store, wrapper, and `getBrandFromCache` helper are correct and shipped.
- **Touching Cycle 1 work** (focusManager, queryClient.clear, brandRoleKeys factory, 30s role TTL).
- **The 4 pre-existing AuthContext require cycles** (CF-1 in ORCH-0744 forensics) — separate ORCH-0746.
- **The 8 unsafe `e.target as unknown as { value: string }` casts** (CF-4 in ORCH-0744) — separate ORCH-0747.
- **The 13 inline `elevation: 12` hardcodes** (HF-2 in ORCH-0744) — defer to designSystem cleanup cycle.
- **`TopBar.tsx:303` `elevation: 1000` outlier** (HF-3) — defer to dedicated forensics sub-investigation.
- **9 stale TRANSITIONAL markers without exit conditions** (HF-4) — defer to ORCH-0748 (Const #7 audit).
- **HF-5 / HF-6 platform-coverage uncertainty** — defer to ORCH-0744 forensics second-pass.
- **DB / RLS / migration changes:** none.
- **New dependencies:** none.

### 2.3 — Assumptions

| ID | Assumption | Verified? |
|---|---|---|
| A-1 | `useCurrentBrandId` is exported from `currentBrandStore.ts` and returns `string \| null` synchronously | ✅ Verified at `currentBrandStore.ts:424` |
| A-2 | `useBrand(brandId)` returns `UseQueryResult<Brand \| null>` with `.isFetched` field that flips true after queryFn resolves at least once | ✅ Verified at `useBrands.ts:122-135` (TanStack Query v5 behavior) |
| A-3 | `_layout.tsx` `RootLayoutInner` already lives inside `<QueryClientProvider>` so `useBrand` can be called there | ✅ Verified at `_layout.tsx:165-168` (RootLayoutInner is wrapped by QueryClientProvider in default export) |
| A-4 | The 4 import sites of `useCurrentBrand` (TopBar, home, events, event/create) currently import from `"../../store/currentBrandStore"` (the re-export path) | ✅ Verified by grep `useCurrentBrand from` |
| A-5 | `Brand` type and its sub-types (`BrandRole`, `BrandStripeStatus`, `BrandPayout`, `BrandRefund`, `BrandStats`, `BrandLiveEvent`, `BrandContact`, `BrandCustomLink`, `BrandLinks`, `BrandEventStub`, `BrandPayoutStatus`) are co-located in `currentBrandStore.ts` lines 91-348 | ✅ Verified |
| A-6 | After CF-3 mass-delete, no other code references the `[ORCH-XXXX-DIAG]` strings, so removal is structurally safe | ⚠️ Implementor MUST grep-verify post-delete: `grep -r "\[ORCH-[0-9]*-DIAG\]" mingla-business/` returns zero matches |

---

## 3. Per-layer specification

### 3.1 — C1: Splash gate extension (`_layout.tsx:55-91`)

**Decision locked:** Option (a) per dispatch §2.1 recommendation. Operator may override before implementor dispatch.

**Target file:** `mingla-business/app/_layout.tsx`

**Required change shape:**

Add a new state-derivation hook above `RootLayoutInner` body:

```ts
// New helper: tracks whether the splash should hide. Hides when ALL gates open.
// Gate 1: AuthContext bootstrap done (existing).
// Gate 2: brand-fetch done (new — closes Const #14 gap from ORCH-0742).
// Hard-timeout fallback: 2s after auth-loading=false, hide regardless. Prevents
// indefinite splash on bad networks; flash falls back to ORCH-0742 default behavior.
const BRAND_FETCH_TIMEOUT_MS = 2000;
```

Inside `RootLayoutInner`:

```ts
const { loading } = useAuth();
const currentBrandId = useCurrentBrandId();
const { isFetched: brandFetched, fetchStatus: brandFetchStatus } = useBrand(currentBrandId);
const mountedAt = useRef(Date.now());
const [splashHidden, setSplashHidden] = useState(false);
const [brandFetchTimedOut, setBrandFetchTimedOut] = useState(false);

// 2s hard-timeout: if useBrand hasn't resolved within 2s of auth bootstrap completing,
// release the splash anyway — flash falls back to ORCH-0742 default behavior.
useEffect(() => {
  if (loading) return; // auth still bootstrapping; no timeout yet
  if (brandFetchTimedOut) return;
  const timer = setTimeout(() => {
    setBrandFetchTimedOut(true);
  }, BRAND_FETCH_TIMEOUT_MS);
  return () => clearTimeout(timer);
}, [loading, brandFetchTimedOut]);

// Brand-fetch is "ready" when:
//   - currentBrandId is null (no brand selected; nothing to fetch), OR
//   - useBrand has fetched at least once (success or null), OR
//   - the 2s hard-timeout fired
const brandReady =
  currentBrandId === null ||
  brandFetched ||
  brandFetchStatus === "idle" ||
  brandFetchTimedOut;

useEffect(() => {
  if (loading || !brandReady || splashHidden) return;
  const elapsed = Date.now() - mountedAt.current;
  const remaining = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
  const timer = setTimeout(() => {
    void SplashScreen.hideAsync().catch(() => {
      // Web no-op or already-hidden race. Constitution #3 exemption:
      // hideAsync is idempotent + platform-no-op on web; not a real failure.
    });
    setSplashHidden(true);
  }, remaining);
  return () => clearTimeout(timer);
}, [loading, brandReady, splashHidden]);
```

**Required imports added at top of `_layout.tsx`:**

```ts
import { useBrand } from "../src/hooks/useBrands";
import { useCurrentBrandId } from "../src/store/currentBrandStore";
```

**Documentation comment block to add above the splash effect:**

```ts
// J-X5 — splash hide synchronized with TWO gates:
//   1. AuthContext bootstrap completes (loading: false)
//   2. useBrand(currentBrandId) has fetched OR currentBrandId is null OR 2s timeout fired
//
// ORCH-0743 / Cycle 2 polish: gate 2 is NEW post-ORCH-0742. It closes the Const
// #14 gap where the wrapper hook returned null during the fetch window, causing
// TopBar/home/events to render empty-state during cold-start with persisted brand.
// The 2s hard-timeout prevents indefinite splash on bad networks (graceful
// fallback to ORCH-0742 baseline behavior — flash, not hang).
//
// Note on `fetchStatus === "idle"`: when `enabled: false` (currentBrandId === null)
// React Query reports `fetchStatus: "idle"` and `isFetched: false` indefinitely.
// We accept "idle" as ready because there's no fetch to wait for. The
// `currentBrandId === null` short-circuit above also handles this; both paths
// converge on the same brandReady=true condition (defensive belt-and-suspenders).
```

**Constraints:**
- DO NOT touch the `focusManager`, `evictEndedEvents`, `reapOrphanStorageKeys` blocks below the splash effect — those are Cycle 1 + Cycle 17d work, untouched.
- DO NOT add a `currentBrand` (full Brand) read at this layer — only `useCurrentBrandId` is needed for the gate. Reading `useCurrentBrand` would re-introduce the loading-window dependency.

### 3.2 — C2 + C3: `event/create.tsx` migration to `useCurrentBrandId`

**Target file:** `mingla-business/app/event/create.tsx`

**Before (lines 33, 39, 43, 47, 49):**
```ts
import { useCurrentBrand } from "../../src/store/currentBrandStore";
// ...
const currentBrand = useCurrentBrand();
const createDraft = useDraftEventStore((s) => s.createDraft);

useEffect(() => {
  if (currentBrand === null) {
    router.replace("/(tabs)/home" as never);
    return;
  }
  const newDraft = createDraft(currentBrand.id);
  router.replace(`/event/${newDraft.id}/edit?step=0` as never);
}, [currentBrand, createDraft, router]);
```

**After:**
```ts
import { useCurrentBrandId } from "../../src/store/currentBrandStore";
// ...
const currentBrandId = useCurrentBrandId();
const createDraft = useDraftEventStore((s) => s.createDraft);

useEffect(() => {
  if (currentBrandId === null) {
    router.replace("/(tabs)/home" as never);
    return;
  }
  const newDraft = createDraft(currentBrandId);
  router.replace(`/event/${newDraft.id}/edit?step=0` as never);
}, [currentBrandId, createDraft, router]);
```

**Why this fixes both C2 and C3:** `useCurrentBrandId()` reads synchronously from Zustand. On cold-start + deep-link, `currentBrandId` is either the persisted value (real ID — proceed to createDraft) OR null (truly no brand selected — redirect). No loading window. No race between fetch and effect.

**Constraint:** the file's docstring comment at line 4 references `currentBrand` — implementor SHOULD update that docstring to reflect the migration, but it's a 1-line cosmetic touch.

### 3.3 — C4: `liveEventConverter.ts:46` cosmetic

**Target file:** `mingla-business/src/utils/liveEventConverter.ts`

**Before (line 46):**
```ts
console.error(
  `[liveEventConverter] Cannot publish: brand ${draft.brandId} not found in store.`,
);
```

**After:**
```ts
console.error(
  `[liveEventConverter] Cannot publish: brand ${draft.brandId} not found in cache.`,
);
```

1 LOC. Cosmetic only — accuracy after ORCH-0742 migration from Zustand-store lookup to React Query cache lookup.

### 3.4 — RC-1: Break the require cycle via Brand-type extraction

**Decision locked:** Option (a) per dispatch §2.5 recommendation.

#### 3.4.1 — Create new file `mingla-business/src/types/brand.ts`

Move ALL of these from `currentBrandStore.ts:91-348` to the new file (verbatim — no behavior change):

- `BrandRole` type
- `BrandStripeStatus` type
- `BrandPayoutStatus` type
- `BrandPayout` interface
- `BrandRefund` interface
- `BrandEventStub` interface
- `BrandStats` interface
- `BrandLiveEvent` interface
- `BrandContact` interface
- `BrandCustomLink` interface
- `BrandLinks` interface
- `Brand` type (with all its docblock comments preserved)

The new file's top-level docblock:
```ts
/**
 * Brand types — mingla-business/src/types/brand.ts (Cycle 2 / ORCH-0743).
 *
 * Co-located here to break the `currentBrandStore.ts ↔ useCurrentBrand.ts`
 * require cycle introduced by ORCH-0742. Both store and wrapper hook now
 * import the type from here independently; neither side depends on the other
 * at module-init.
 *
 * Ownership: types only. No runtime values, no Zustand state, no React hooks.
 *
 * Schema-version evolution comments (v3 → v14) stay at the top of
 * currentBrandStore.ts where they're operationally relevant. The shape itself
 * lives here.
 */
```

#### 3.4.2 — Update `currentBrandStore.ts` to import-and-re-export Brand types

**Before (lines 91-348 — 250+ lines of type definitions):** types defined inline.
**After:** delete the type definitions, replace with:

```ts
// Cycle 2 / ORCH-0743 — Brand types co-located in src/types/brand.ts to break
// the currentBrandStore ↔ useCurrentBrand require cycle. Re-exported here for
// backwards-compat with ~25 import sites (TopBar, home, events, brand/edit,
// services, hooks, components/orders, etc.) that import `Brand` from this file.
export type {
  Brand,
  BrandRole,
  BrandStripeStatus,
  BrandPayoutStatus,
  BrandPayout,
  BrandRefund,
  BrandEventStub,
  BrandStats,
  BrandLiveEvent,
  BrandContact,
  BrandCustomLink,
  BrandLinks,
} from "../types/brand";
```

#### 3.4.3 — DROP the `useCurrentBrand` re-export at `currentBrandStore.ts:441-446`

**Before:**
```ts
// Cycle 2 / ORCH-0742 — `useCurrentBrand` is a server-fresh wrapper around
// useBrand(currentBrandId). Lives in src/hooks/ (not src/store/) to avoid
// circular imports between currentBrandStore.ts and useBrands.ts. Re-exported
// here so existing import sites do not change (mirrors useBrandList shim
// pattern). I-PROPOSED-J satisfied: persisted state holds only the ID.
export { useCurrentBrand } from "../hooks/useCurrentBrand";
```

**After:** delete entirely. The cycle's last back-edge gone.

#### 3.4.4 — Update `useCurrentBrand.ts` import

**Before (lines 30-34):**
```ts
import { useBrand } from "./useBrands";
import {
  useCurrentBrandStore,
  type Brand,
} from "../store/currentBrandStore";
```

**After:**
```ts
import { useBrand } from "./useBrands";
import { useCurrentBrandStore } from "../store/currentBrandStore";
import type { Brand } from "../types/brand";
```

#### 3.4.5 — Update 4 import sites that imported `useCurrentBrand` via the store re-export

These 4 files currently import `useCurrentBrand` from `"../../store/currentBrandStore"` (the dropped re-export). Update to import from `"../../hooks/useCurrentBrand"`:

| File | Line | Before | After |
|---|---|---|---|
| `app/(tabs)/home.tsx` | 46 | `useCurrentBrand,` (inside multi-import from `currentBrandStore`) | move `useCurrentBrand` to a separate import from `"../../src/hooks/useCurrentBrand"` |
| `app/(tabs)/events.tsx` | (similar pattern) | same | same |
| `src/components/ui/TopBar.tsx` | 35 | `import { useCurrentBrand } from "../../store/currentBrandStore";` | `import { useCurrentBrand } from "../../hooks/useCurrentBrand";` |
| `app/event/create.tsx` | (Note: post-C3 migration this file no longer imports `useCurrentBrand` — verify after C3 lands) | — | — |

**Constraint:** The `Brand` type imports across the codebase remain unchanged because `currentBrandStore.ts` keeps re-exporting `Brand` (per §3.4.2). Only `useCurrentBrand` import paths shift. ~25 other consumer files keep working untouched.

#### 3.4.6 — Cycle verification (post-implementation)

Run `cd mingla-business && npx expo start --clear 2>&1 | grep "Require cycle"` for ~30s. Expected output: NO line containing `currentBrandStore.ts → useCurrentBrand.ts → currentBrandStore.ts` or its reverse. The 4 pre-existing AuthContext cycles (CF-1) WILL still appear — those are out of scope for this SPEC; ORCH-0746 addresses them.

### 3.5 — RC-2: Whitelist sync + regression-prevention test

#### 3.5.1 — `reapOrphanStorageKeys.ts:18` whitelist update

**Before:**
```ts
const KNOWN_MINGLA_KEYS = new Set<string>([
  "mingla-business.currentBrand.v12",
  "mingla-business.draftEvent.v1",
  // ...
]);
```

**After:**
```ts
const KNOWN_MINGLA_KEYS = new Set<string>([
  // Cycle 2 / ORCH-0743 — bumped from v12 → v14 to match
  // currentBrandStore.ts:375 post-ORCH-0742 persist key.
  // I-PROPOSED-L codifies this whitelist-sync invariant.
  "mingla-business.currentBrand.v14",
  "mingla-business.draftEvent.v1",
  // ...10 other entries unchanged
]);
```

1 LOC plus an inline comment.

#### 3.5.2 — NEW unit test `mingla-business/src/utils/reapOrphanStorageKeys.test.ts`

**File:** `mingla-business/src/utils/reapOrphanStorageKeys.test.ts` (new)

**Required test cases:**

```ts
import { reapOrphanStorageKeys } from "./reapOrphanStorageKeys";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Mock AsyncStorage so we can plant fake keys and assert reaper output.
jest.mock("@react-native-async-storage/async-storage", () => ({
  getAllKeys: jest.fn(),
}));

describe("reapOrphanStorageKeys", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does NOT report the LIVE currentBrand v14 blob as orphan (RC-2 regression test)", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
      "mingla-business.currentBrand.v14",
    ]);
    const result = await reapOrphanStorageKeys();
    expect(result.orphanKeys).not.toContain("mingla-business.currentBrand.v14");
    expect(result.orphanCount).toBe(0);
  });

  it("DOES report a v13 leftover as orphan (predecessor key correctly flagged)", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
      "mingla-business.currentBrand.v13",
    ]);
    const result = await reapOrphanStorageKeys();
    expect(result.orphanKeys).toContain("mingla-business.currentBrand.v13");
    expect(result.orphanCount).toBe(1);
  });

  it("ignores Supabase auth keys (sb-*-auth-token pattern)", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
      "sb-gqnoajqerqhnvulmnyvv-auth-token",
    ]);
    const result = await reapOrphanStorageKeys();
    expect(result.orphanKeys).not.toContain("sb-gqnoajqerqhnvulmnyvv-auth-token");
    expect(result.orphanCount).toBe(0);
  });

  it("ignores keys outside mingla-business namespace", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
      "expo.modules.fonts",
      "@some-third-party.cache",
    ]);
    const result = await reapOrphanStorageKeys();
    expect(result.orphanKeys).toEqual([]);
    expect(result.orphanCount).toBe(0);
  });

  it("returns safe defaults on AsyncStorage.getAllKeys() throw", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockRejectedValue(new Error("native failure"));
    const result = await reapOrphanStorageKeys();
    expect(result).toEqual({ orphanCount: 0, orphanKeys: [] });
  });
});
```

The first test PINS the v14 whitelist entry. Any future persist-key bump that forgets to update the whitelist fails this test on CI. This is the regression-prevention test the dispatch §2.6 demanded.

### 3.6 — CF-2: textShadow* → Platform.select web/native

**Target file:** `mingla-business/app/event/[id]/index.tsx`

**Before (lines 819-828):**
```ts
heroTitle: {
  fontSize: 24,
  fontWeight: "700",
  letterSpacing: -0.2,
  color: "#ffffff",
  textShadowColor: "rgba(0, 0, 0, 0.4)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 12,
  marginBottom: 4,
},
```

**After:**
```ts
heroTitle: {
  fontSize: 24,
  fontWeight: "700",
  letterSpacing: -0.2,
  color: "#ffffff",
  // ORCH-0743 / CF-2 — textShadow* RN-only props removed; replaced with
  // Platform.select so web target gets the CSS textShadow shorthand
  // (react-native-web 0.21+ supports the shorthand). iOS/Android keep the
  // RN-native triple for fidelity.
  ...(Platform.OS === "web"
    ? { textShadow: "0 2px 12px rgba(0, 0, 0, 0.4)" }
    : {
        textShadowColor: "rgba(0, 0, 0, 0.4)",
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 12,
      }),
  marginBottom: 4,
},
```

**Required import:** `import { Platform } from "react-native";` at top of file (verify it's already imported; mingla-business uses Platform extensively).

**Token decision:** This shadow does NOT recur elsewhere (verified via grep `textShadowRadius: 12` in mingla-business/ — single hit). Inline pattern is acceptable. If CF-2 follows-up surface a second site with the same shadow, introduce `designSystem.shadows.heroTextShadow` then.

### 3.7 — CF-3: Mass-delete 15 DIAG markers

**Approach:** delete in pass-by-pass discipline. After each file's edit, run `cd mingla-business && npx tsc --noEmit` to verify no broken references. The DIAG markers don't expose any imports, but `BrandSwitcherSheet.tsx` had a downstream `Constants` import only used by the diagnostic probes — verify `Constants` import is still needed post-delete.

#### 3.7.1 — `BrandSwitcherSheet.tsx`

**Lines to delete (in order from bottom to preserve line-number stability):**

- **Lines 261-304** (creator-accounts probe) — wholesale delete
- **Lines 209-260** (raw-fetch probe) — wholesale delete
- **Lines 150-208** (JWT decode probe) — wholesale delete
- **Lines 135-149** (PRE-MUTATE session probe) — wholesale delete; `sessionProbe` was used only by these probes
- **Lines 124-130** (AUTH-NOT-READY console.error) — preserve `if (...) return;`, delete the 3-line console.error + comment + eslint-disable
- **Lines 317-326** (catch-block diagnostic) — preserve outer `catch (error) { ... }` AND the `if (error instanceof SlugCollisionError)` block at 327-338 AND the `finally { setSubmitting(false); }` at 339-341. Only delete the leading 10 lines of console.error + comment + eslint-disable.

**Imports to verify after delete:**
- `import Constants from "expo-constants";` at top of file — was used only by the diagnostic probes (Constants.expoConfig?.extra access). After CF-3, `Constants` is unused. Delete the import line.
- `import { supabase } from "../../services/supabase";` — was used by the PRE-MUTATE session probe at line 137 AND by the raw fetch probe at lines 223-238 (the `supabase` client wasn't actually used in the raw fetch — that used global `fetch` directly with explicit headers). Verify `supabase` is no longer used; delete the import if so.

#### 3.7.2 — `useBrands.ts`

**Lines to delete (line-number stable since each block is small):**

- **Lines 185-196** (useCreateBrand.onError diagnostic) — delete the 12 lines of console.error + comment + eslint-disable. Preserve the rollback logic at 198-205.
- **Lines 273-284** (useUpdateBrand.onError diagnostic) — delete 12 lines. Preserve rollback at 285-290.
- **Lines 322-324** (useSoftDeleteBrand mutationFn ENTER) — delete 3 lines. Preserve `softDeleteBrand(brandId)` at 325.
- **Lines 326-331** (useSoftDeleteBrand mutationFn RESULT) — delete 6 lines (eslint-disable + console.error + 4-line object). Preserve `return result;` at 332.
- **Lines 351-358** (useSoftDeleteBrand.onError diagnostic) — delete 8 lines. Preserve `// Caller's mutateAsync still receives the throw` comment at 359.

#### 3.7.3 — `brandsService.ts`

- **Lines 228-233** (UPDATE ATTEMPT log) — delete 6 lines. Preserve subsequent `.update().select("id")` chain at 234.
- **Lines 242-248** (UPDATE RESULT log) — delete 7 lines. Preserve `if (data === null || data.length === 0) throw...` at 249.

#### 3.7.4 — `creatorAccount.ts` — Note A applied

**Before (lines 30-41):**
```ts
if (error) {
  // [DIAG ORCH-0728-PASS-3] — replaced by logError() on full IMPL
  // eslint-disable-next-line no-console
  console.error("[ORCH-0728-DIAG] creatorAccount#ensureCreatorAccount FAILED", {
    name: (error as { name?: string })?.name,
    message: error.message,
    code: (error as { code?: string })?.code,
    details: (error as { details?: string })?.details,
    hint: (error as { hint?: string })?.hint,
    userId: user.id,
  });
}
```

**After (per Note A — Const #3 throw on error):**
```ts
if (error) {
  throw error;
}
```

**Caller verification before locking choice:** Implementor MUST grep callers of `ensureCreatorAccount` and confirm they handle the throw. Expected callers (per AuthContext.tsx and useCreatorAccount.ts patterns): `await ensureCreatorAccount(user)` inside try/catch in AuthContext.bootstrap. If caller doesn't catch → escalate to orchestrator before proceeding (don't ship a silent change in error semantics).

**Implementor effort:** ~5 min for the change + ~10 min to verify caller handling.

---

## 4. Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-1 | Cold-start with persisted `currentBrandId` exhibits no visible flash from null/empty-state to populated state on networks ≤500ms RTT (≤2s on slow networks via timeout fallback) | Manual cold-start smoke (operator) — fresh app launch + sign in + pick brand + force-quit + relaunch; observe TopBar/home/events for any flash longer than 100ms |
| SC-2 | `event/create.tsx` cold-start + deep-link does NOT redirect to home before the brand fetch resolves | Manual: cold-start + simulate deep-link to `/event/create` (via Expo dev URL) with persisted brand; confirm createDraft fires, no home-redirect |
| SC-3 | `event/create.tsx:39` uses `useCurrentBrandId()` (not `useCurrentBrand()`); home/events legitimately stay on `useCurrentBrand` | Code read confirms |
| SC-4 | TopBar.tsx and other genuine full-Brand consumers continue to use `useCurrentBrand()` | Code read confirms; no regression in TopBar displayName rendering |
| SC-5 | `liveEventConverter.ts:46` log message says "cache" not "store" | Direct file read |
| SC-6 | `cd mingla-business && npx tsc --noEmit` exit 0 | CI |
| SC-7 | `cd mingla-business && npx expo export -p web` exit 0; full route table emitted | CI |
| SC-8 | All 4 strict-grep CI gates pass; no `setBrands(` write paths introduced; I-PROPOSED-C and I-PROPOSED-J preserved | CI |
| SC-9 | No regression in any of the 15 ORCH-0742 consumers | Tester re-walks the §1.2 cascade from ORCH-0742 SPEC |
| SC-10 | (RC-1) `npx expo start --clear` produces ZERO `Require cycle: ...currentBrandStore...useCurrentBrand...` warnings (other AuthContext cycles MAY remain — those are CF-1, out of scope) | Live grep of Metro output |
| SC-11 | (RC-1) `Brand` + sub-types live in `mingla-business/src/types/brand.ts`; ~25 consumer sites that import `Brand` from `currentBrandStore.ts` keep working unchanged via re-export | Code read + tsc=0 |
| SC-12 | (RC-2) `reapOrphanStorageKeys.ts:18` whitelist contains `"mingla-business.currentBrand.v14"` (not v12) | Direct file read |
| SC-13 | (RC-2) Unit test `reapOrphanStorageKeys.test.ts` passes — planted v14 blob NOT reported as orphan | Jest run: `cd mingla-business && npx jest reapOrphanStorageKeys.test` |
| SC-14 | (CF-2) `app/event/[id]/index.tsx:824-826` uses `Platform.select({ web: { textShadow: "..." }, default: { textShadowColor: ..., ... } })` | Direct file read |
| SC-15 | (CF-2) `npx expo export -p web 2>&1 | grep "shadow.* style props are deprecated"` returns ZERO matches | CI / manual |
| SC-16 | (CF-3) Zero `[ORCH-XXXX-DIAG]` markers across `mingla-business/src/` | grep verification |
| SC-17 | (CF-3) Live error-handling preserved per §3.7 specification: `useCreateBrand` rollback fires on error; `useUpdateBrand` rollback fires on error; `useSoftDeleteBrand` correctly throws; `ensureCreatorAccount` throws on error per Note A; SlugCollisionError handling in BrandSwitcherSheet still fires | Implementor includes before/after diff per file in report; tester runs error-path smoke for each |
| SC-18 | (CF-3) `BrandSwitcherSheet.tsx` no longer imports `Constants` (was only used by diagnostic probes) — verify post-delete | Direct file read |
| SC-19 | All 8 sub-deliverables shipped in a single coherent commit (no partial states) | Git log inspection |

---

## 5. Invariants

### 5.1 — Preserved (no change)

- **Constitutional #1** (no dead taps) — UI behaviour unchanged
- **Constitutional #2** (one owner per truth) — preserved (no new state owners)
- **Constitutional #3** (no silent failures) — STRENGTHENED via Note A (`creatorAccount.ts` collapses silent-swallow `if (error) {}` to `throw error`)
- **Constitutional #4** (one query key per entity) — preserved
- **Constitutional #5** (server state via React Query) — preserved
- **Constitutional #6** (logout clears everything) — preserved
- **Constitutional #7** (label temporary) — preserved (no new TRANSITIONAL markers)
- **Constitutional #8** (subtract before adding) — STRENGTHENED (-180 LOC net via CF-3 + RC-1 re-export drop)
- **Constitutional #9** (no fabricated data) — N/A
- **Constitutional #14** (persisted-state startup) — **ELEVATED FROM PARTIAL TO PASS** via C1 splash-gate extension. ORCH-0742 left this rule "PARTIAL by design"; ORCH-0743 closes the gap.
- **I-PROPOSED-C** (server state via React Query) — preserved
- **I-PROPOSED-J** (Zustand persist no server snapshots) — preserved (no Zustand changes that touch persist shape)
- **I-32** (BrandRole rank parity) — preserved (orthogonal)
- **I-PROPOSED-H/I** — preserved (orthogonal)

### 5.2 — No NEW invariants in this SPEC

The 5 new invariants from ORCH-0744 forensics (I-PROPOSED-K through I-PROPOSED-O for require-cycles, persist-key whitelist, TRANSITIONAL-exit, DIAG-marker-closed-with-ORCH, web-export-clean) are owned by **META-ORCH-0744-PROCESS**, not this SPEC. ORCH-0743 makes the underlying problems go away on the existing surface; META-PROCESS bakes the gates that prevent recurrence.

---

## 6. Test Cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| T-01 | Cold-start, no persist (fresh install) | First launch | Splash → null TopBar / "No brands yet" home — no flash because nothing to load | _layout splash + home |
| T-02 | Cold-start, valid persist, fast network (≤300ms) | v14 blob with valid `currentBrandId` | Splash holds extra ~300ms (gate 2 waits) → TopBar renders displayName immediately, no flash | _layout splash + useBrand |
| T-03 | Cold-start, valid persist, slow network (3s) | v14 blob with valid `currentBrandId`, network 3s RTT | Splash holds 2s (timeout fallback) → falls through to ORCH-0742 baseline (brief flash on home/events) → fetch resolves → populated state | _layout splash + timeout |
| T-04 | Cold-start, deleted-brand persist | v14 blob with `currentBrandId` of deleted brand | Fetch returns null → wrapper auto-clear fires → splash releases (brandReady because `brand === null && isFetched`) → null state cleanly | useCurrentBrand auto-clear + splash |
| T-05 | Cold-start + deep-link to `/event/create` with valid persist | Cold-start, route directly to `/event/create` | `useCurrentBrandId()` reads synchronously → effect creates draft → redirect to `/event/{id}/edit?step=0` | event/create + useCurrentBrandId |
| T-06 | Cold-start + deep-link to `/event/create` with NO brand selected | Cold-start, route directly, currentBrandId=null | effect redirects to `/(tabs)/home` cleanly | event/create + useCurrentBrandId |
| T-07 | Brand picker tap (warm cache) | User on home, taps BrandSwitcher → picks brand X | `setCurrentBrand(X)` → currentBrandId=X.id → wrapper returns Brand → TopBar updates within 100ms | full stack |
| T-08 | RC-1: tsc=0 + zero-cycle Metro check | `npx tsc --noEmit` + `npx expo start --clear 2>&1 \| grep "currentBrandStore.*useCurrentBrand"` | tsc exit 0; grep returns zero matches | build |
| T-09 | RC-1: ~25 Brand-type consumers compile | `import type { Brand } from "../../store/currentBrandStore"` keeps working via re-export | tsc=0 | type system |
| T-10 | RC-2: planted v14 blob NOT reported as orphan | `AsyncStorage.getAllKeys` returns `["mingla-business.currentBrand.v14"]` | `reapOrphanStorageKeys()` returns `{orphanCount: 0, orphanKeys: []}` | unit test |
| T-11 | RC-2: planted v13 leftover IS reported as orphan | `AsyncStorage.getAllKeys` returns `["mingla-business.currentBrand.v13"]` | `reapOrphanStorageKeys()` returns `{orphanCount: 1, orphanKeys: ["mingla-business.currentBrand.v13"]}` | unit test |
| T-12 | CF-2: web export emits zero shadow-deprecation warnings | `EXPO_PUBLIC_SUPABASE_URL=stub EXPO_PUBLIC_SUPABASE_ANON_KEY=stub npx expo export -p web 2>&1 \| grep -i "shadow"` | Zero matches | CI |
| T-13 | CF-2: text shadow visible on web | Open `/event/{id}` on web build | Hero title has visible text shadow | UI smoke |
| T-14 | CF-3: zero DIAG markers post-delete | `grep -r "\[ORCH-[0-9]*-DIAG\]" mingla-business/` | Zero matches | grep |
| T-15 | CF-3: useCreateBrand rollback still fires on error | Throw mock error in createBrand service | optimistic snapshot restored to React Query cache | unit / integration test |
| T-16 | CF-3: useSoftDeleteBrand still throws on error | Throw mock error in softDeleteBrand service | mutation.error populated; caller's catch fires | unit / integration test |
| T-17 | CF-3: ensureCreatorAccount throws on error per Note A | Mock supabase upsert returns error | function throws; caller's catch fires (verify via AuthContext bootstrap test) | unit / integration test |
| T-18 | CF-3: SlugCollisionError handling preserved | BrandSwitcherSheet.handleSubmit catches SlugCollisionError | inline error "This brand name is taken..." set via setSlugError | UI smoke |
| T-19 | C4: log message uses "cache" not "store" | `grep -n "not found in store" mingla-business/src/utils/liveEventConverter.ts` | Zero matches | grep |
| T-20 | Cross-domain blast | grep mingla-admin / supabase / app-mobile for currentBrandStore.ts touches | Zero matches (this SPEC is mingla-business only) | grep |

---

## 7. Implementation Order

Database → edge fns → services → hooks → components convention. Since this SPEC has no DB or edge-fn changes, ordering is: **types → store → utils → hooks → components → tests**. Each step ends with `tsc --noEmit` checkpoint.

**Step 1 — Brand-type extraction (RC-1 part 1):**
1.1 — Create `mingla-business/src/types/brand.ts` with the verbatim types per §3.4.1.
1.2 — `tsc --noEmit` checkpoint. Expect no errors yet (types not consumed from new path).

**Step 2 — Update store + drop re-export (RC-1 part 2):**
2.1 — Edit `currentBrandStore.ts`: delete inline type definitions at lines 91-348, replace with re-export-from-`../types/brand` per §3.4.2.
2.2 — Delete `useCurrentBrand` re-export at lines 441-446 per §3.4.3.
2.3 — Edit `useCurrentBrand.ts` import per §3.4.4.
2.4 — Update 4 import sites (TopBar, home, events — event/create gets handled in Step 5) per §3.4.5.
2.5 — `tsc --noEmit` checkpoint. Expect 0 errors.
2.6 — `expo start --clear` smoke: confirm no `currentBrandStore.ts → useCurrentBrand.ts` cycle warning.

**Step 3 — Whitelist + unit test (RC-2):**
3.1 — Edit `reapOrphanStorageKeys.ts:18` per §3.5.1.
3.2 — Create `reapOrphanStorageKeys.test.ts` per §3.5.2.
3.3 — Run `npx jest reapOrphanStorageKeys.test` — confirm all 5 cases pass.

**Step 4 — Cosmetic message (C4):**
4.1 — Edit `liveEventConverter.ts:46` per §3.3.

**Step 5 — `event/create.tsx` migration (C2 + C3):**
5.1 — Edit `event/create.tsx` import + body per §3.2.
5.2 — `tsc --noEmit` checkpoint.

**Step 6 — DIAG marker mass-delete (CF-3):**
6.1 — Edit `BrandSwitcherSheet.tsx` per §3.7.1 (delete in bottom-up order; verify imports).
6.2 — `tsc --noEmit` checkpoint.
6.3 — Edit `useBrands.ts` per §3.7.2.
6.4 — `tsc --noEmit` checkpoint.
6.5 — Edit `brandsService.ts` per §3.7.3.
6.6 — Edit `creatorAccount.ts` per §3.7.4 (apply Note A — verify callers handle throw before locking).
6.7 — `tsc --noEmit` checkpoint.
6.8 — Run `grep -r "\[ORCH-[0-9]*-DIAG\]" mingla-business/` — must return zero hits.

**Step 7 — Web text-shadow Platform.select (CF-2):**
7.1 — Edit `event/[id]/index.tsx:824-826` per §3.6.
7.2 — `tsc --noEmit` checkpoint.

**Step 8 — Splash-gate extension (C1):**
8.1 — Edit `_layout.tsx` per §3.1 (this is the largest single edit; do last so other changes don't conflict).
8.2 — `tsc --noEmit` checkpoint.
8.3 — `npx expo start --clear` smoke: confirm splash holds for cold-start with persisted brand until brand resolves.

**Step 9 — Final verification:**
9.1 — `cd mingla-business && npx tsc --noEmit` exit 0.
9.2 — `cd mingla-business && EXPO_PUBLIC_SUPABASE_URL=stub EXPO_PUBLIC_SUPABASE_ANON_KEY=stub npx expo export -p web 2>&1 | tee export-web.log` exit 0; grep `export-web.log | grep -i "shadow"` → 0 hits.
9.3 — `cd mingla-business && npx jest reapOrphanStorageKeys.test` — pass.
9.4 — `grep -r "\[ORCH-[0-9]*-DIAG\]" mingla-business/` → 0 hits.
9.5 — `cd mingla-business && npx expo start --clear` — capture Metro output for 30s; confirm zero `Require cycle: ...currentBrandStore.*useCurrentBrand...` (4 pre-existing AuthContext cycles MAY remain — that's CF-1 out-of-scope).

**Step 10 — Implementation report:**
Implementor writes `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0743_REPORT.md` per implementor template. Required sections:
- 8 sub-deliverable old→new receipts
- Per-file CF-3 before/after diff with explicit "preserved" annotations
- AuthContext caller verification for Note A (creatorAccount.ts)
- Step 9 verification log evidence

---

## 8. Regression Prevention

**Structural safeguards delivered by this SPEC:**

- **C1 + Const #14 to PASS:** the splash gate now structurally waits on the brand fetch. The class of "loading-window flash on cold-start" cannot recur for the currentBrand surface as long as `useCurrentBrandId` + `useBrand(id)` is the resolution chain.
- **RC-1 type extraction:** the `currentBrandStore ↔ useCurrentBrand` cycle structurally cannot recur — both files import from `src/types/brand.ts` (a leaf with no upward dependencies), not each other.
- **RC-2 unit test:** the regression-prevention test pins the v14 whitelist forever. Any future persist-key bump that forgets to update the whitelist fails the test on CI.
- **CF-3 mass-delete + imports cleanup:** Constants + supabase imports removed from BrandSwitcherSheet (if unused post-delete) — preventing accidental re-introduction of the diagnostic probe pattern.

**Forward safeguards (deferred to META-ORCH-0744-PROCESS):**

- I-PROPOSED-K (require-cycle CI gate via `madge`) — prevents NEW cycles from entering codebase
- I-PROPOSED-L (persist-key whitelist sync CI gate) — generalizes RC-2's per-store unit test into a workspace-wide gate
- I-PROPOSED-N (DIAG-marker closed-with-ORCH at CLOSE) — prevents the CF-3 class from recurring across future ORCHs
- I-PROPOSED-O (web-export deprecation parser) — prevents new CF-2-class warnings from shipping

**Protective comments to include in implementation:**

- Top of `_layout.tsx` splash-effect block: full docblock per §3.1 explaining the dual-gate + 2s timeout
- Top of `src/types/brand.ts`: docblock per §3.4.1 explaining the type-extraction rationale
- Inline at `reapOrphanStorageKeys.ts:18`: comment per §3.5.1 referencing ORCH-0743 + I-PROPOSED-L
- Inline at `event/[id]/index.tsx:824`: comment per §3.6 explaining ORCH-0743 / CF-2 web fix
- Inline at `creatorAccount.ts:30`: comment explaining Note A — `if (error) throw error;` is the Const #3 collapse, replaces silent-swallow that fired on the diagnostic probe path

---

## 9. Discoveries for Orchestrator

| ID | Type | Description | Action |
|----|------|-------------|--------|
| D-0743-FOR-1 | 🔵 process | QA report C3 listed home.tsx + events.tsx as candidates for `useCurrentBrandId` migration. Direct code read shows both legitimately need full Brand for child component props (`brand={currentBrand}` at events.tsx:530, 562) and live-event card display (home.tsx:181 `currentBrand?.currentLiveEvent`). Their flash is fixed by C1, not C3. SPEC narrows C3 to `event/create.tsx` only. | Documented in §1.6; no new ORCH needed |
| D-0743-FOR-2 | 🟡 hidden flaw | `BrandSwitcherSheet.tsx` may have unused `Constants` and/or `supabase` imports post-CF-3 mass-delete. Implementor verifies + removes; flagged here for orchestrator awareness. | Folded into Step 6.1 verification |
| D-0743-FOR-3 | 🟡 hidden flaw | `creatorAccount.ts` Note A — collapsing `if (error) {}` (silent swallow under diagnostic-only) to `if (error) throw error;` is a behavior change for callers. Implementor MUST verify AuthContext.bootstrap and useCreatorAccount callers handle the throw. | Folded into Step 6.6 verification + report |
| D-0743-FOR-4 | 🔵 observation | `BrandSwitcherSheet.tsx` is now ~600 LOC; post-CF-3 mass-delete (~-180 LOC), it drops to ~420 LOC. Still above Cycle 17d Stage 2 §F decompose threshold of ~400 LOC. Defer to a future LOC-decompose cycle if needed. | No action; observation |
| D-0743-FOR-5 | 🔵 observation | The QA report C1 ranked Option (b) (React Query AsyncStorage persistence) as "the proper long-term fix" over Option (a). This SPEC locks Option (a) for scope reasons but Option (b) remains the better architectural choice. If C1 splash gate proves insufficient (e.g., 2s timeout fires too often on real-world networks), revisit with a Cycle 5 RQ-persistence cycle. | No action; documented for future |

---

## 10. Confidence

**HIGH** on all 8 sub-deliverables.
- C1: dispatch §2.1 recommendation + direct code read of `_layout.tsx` confirm Option (a) is the lowest-risk smallest-scope fix that closes Const #14.
- C2/C3: code-read confirms `event/create.tsx` is the only true ID-only consumer; home/events legitimately need full Brand.
- C4: trivial 1-LOC.
- RC-1: extraction pattern is mechanical; the only risk is import-site count (~25 sites for `Brand` type) but the re-export from `currentBrandStore.ts` keeps them all working.
- RC-2: 1-LOC + unit test.
- CF-2: Platform.select is the standard mingla-business pattern (verified in 69+ existing branches per ORCH-0744 T1.E).
- CF-3: per-line spec eliminates implementor judgment; Note A flags the only judgment call (creatorAccount.ts caller verification).

No layer of the SPEC is "probable" or "suspected" — every line traces back to a verified code read at SPEC time.

---

**Awaiting:** orchestrator REVIEW → operator dispatches `/mingla-implementor` → implementor executes per §7 → tester PASS → CLOSE protocol (standard 4-step; no DEPRECATION extension because no DROP COLUMN/TABLE/feature retirement).
