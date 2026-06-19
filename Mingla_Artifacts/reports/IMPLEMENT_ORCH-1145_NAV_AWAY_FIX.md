# IMPLEMENT — ORCH-1145 nav-away fix (Hub nav-lock redirect → branded 404)

- **ORCH:** ORCH-1145 follow-up (venue Hub tab → nav-away 404)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1145-[venue-hub-tab]/` · branch `ORCH-1145-venue-hub-tab`
- **Base at start:** `1e2a3badc`; **rebased onto** `origin/main` (`929c86cc5`, pulled in ORCH-1144 which also touched these files — clean rebase, no conflicts).
- **Fix commit:** `e54cfe923` (post-rebase HEAD)
- **Driver:** INVESTIGATE_ORCH-1145_NAV_AWAY_CRASH.md (F-1, root cause `probable`)
- **Mode:** IMPLEMENT — proven-fix only. No deploy / merge / close. Scope NOT widened.

---

## 1. Root cause (recap)

The Hub layout's nav-lock redirect string-concatenated the bare `HubTabName`
into a URL: `router.replace(\`/(tabs)/hub/${initialTab}\`)`. ORCH-1145 added
`"venue"` to `HubTabName`, but the Venue tab's route FILE is `listing.tsx`
(route `/(tabs)/hub/listing`), NOT `venue.tsx`. When the picker resolved
`"venue"`, the redirect built the non-existent `/(tabs)/hub/venue` →
expo-router served `app/+not-found.tsx` ("Hmm, that's not a real page").

## 2. Fix (exactly as specified — single source of truth, no rename)

Resolved the picked tab through the SAME route map `HubSubNav` already uses,
instead of bare-name concatenation. Did NOT rename `listing.tsx → venue.tsx`.

### Files changed (commit `e54cfe923`)

| File | Change |
|---|---|
| `mingla-business/src/components/hub/HubSubNav.tsx` | Promoted the private `ROUTES` map to an exported `HUB_TAB_ROUTES` (single source of truth; `const ROUTES = HUB_TAB_ROUTES` keeps the local name working). `venue: "/(tabs)/hub/listing"` unchanged. |
| `mingla-business/app/(tabs)/hub/_layout.tsx` | Import `HUB_TAB_ROUTES`; renamed the picked tab var `initialTab → targetTab` (the `HubTabName`); resolve it through `HUB_TAB_ROUTES` to the route SEGMENT at the redirect site. |
| `mingla-business/app/(tabs)/hub/__tests__/hub-nav-redirect-resolves-route.test.ts` | NEW append-only fails-on-revert regression test. |

### Exact before / after of the redirect (`_layout.tsx`)

**Before (broken — bare-name concat):**
```ts
const initialTab = useHubInitialTab(currentBrand?.id ?? null, visibleTabs.data ?? []);
...
if (!visibleTabs.data.includes(active)) {
  router.replace(`/(tabs)/hub/${initialTab}` as never);   // venue → /(tabs)/hub/venue → 404
}
```

**After (fixed — resolved through `HUB_TAB_ROUTES`):**
```ts
const targetTab = useHubInitialTab(currentBrand?.id ?? null, visibleTabs.data ?? []);
...
if (!visibleTabs.data.includes(active)) {
  // resolve the picked tab to its REAL route SEGMENT via the same map HubSubNav uses
  const initialTab = HUB_TAB_ROUTES[targetTab].replace("/(tabs)/hub/", "");
  router.replace(`/(tabs)/hub/${initialTab}` as never);   // venue → /(tabs)/hub/listing
}
```

`venue` now resolves: `HUB_TAB_ROUTES["venue"]` = `/(tabs)/hub/listing` →
`.replace("/(tabs)/hub/","")` = `listing` → `router.replace("/(tabs)/hub/listing")`.
All other tabs resolve to their existing route files unchanged
(events/trips/experiences/getstarted).

### Why this preserves `hub-layout-nav-lock.test.ts` (GREEN + UNMODIFIED)

That test pins (a) the `if (!activePath.includes("/hub/")) return;` early-return
and (b) the literal `router.replace(\`/(tabs)/hub/${initialTab}\`)` AFTER the
guard. The fix keeps the early-return verbatim and keeps the literal redirect
template intact — it only rebinds the in-block `initialTab` to the resolved
route segment immediately before it. Both pins, and `venueTab.contract.test.ts`'s
identical pin, stay green with NO test edit.

## 3. Regression test (fails-on-revert)

`app/(tabs)/hub/__tests__/hub-nav-redirect-resolves-route.test.ts` (append-only).
The biz harness is node/ts-jest with no RN renderer, so it parses `HUB_TAB_ROUTES`
from `HubSubNav.tsx` source (importing the component pulls RN JSX — same
constraint documented in the sibling pins). It asserts:
- the route map parsed (≥5 entries incl. `venue`);
- **every** `HubTabName` redirect target resolves to an EXISTING
  `app/(tabs)/hub/*.tsx` route file (`test.each`);
- `venue → listing.tsx` specifically, and `venue.tsx` does NOT exist;
- `_layout.tsx` resolves the picked tab THROUGH `HUB_TAB_ROUTES`
  (`expect(LAYOUT).toContain("HUB_TAB_ROUTES")` + `/HUB_TAB_ROUTES\[targetTab\]/`).

## 4. Gate results (post-rebase, on `e54cfe923`)

| Gate | Result |
|---|---|
| `hub-nav-redirect-resolves-route` (new) | **PASS** |
| `hub-layout-nav-lock.test.ts` (unmodified) | **PASS** |
| `venueTab.contract.test.ts` | **PASS** |
| Full hub/venue suite (8 files: events.pastTab ×2, hubExperiences.contract, metaOrch1059IntentsMultiAndHub, hub-layout-nav-lock, hub-nav-redirect, useHubTabs.venueGate, venueTab.contract) | **8 suites / 71 tests PASS** |
| `tsc --noEmit` (changed files) | **0 errors** in changed files. Repo-wide count 322 WITH and WITHOUT my changes (stash-and-rerun) → **zero new errors**. |
| `eslint` (changed files) | **0 errors.** One `'radius' is defined but never used` warning in `HubSubNav.tsx` — confirmed PRE-EXISTING via stash-and-rerun (not mine; not a line I touched). |
| Pre-existing `orch1004AllowlistIntegrity` + `brandListState` failures | 2 failed WITH and WITHOUT my changes (stash + remove-new-test rerun) → **NOT attributable to me.** |
| `experiences.tsx` | **UNTOUCHED** (no git status entry). |

## 5. Fails-on-revert proof

- **Verified on commit `e54cfe923`** (post-rebase HEAD).
- Reverted ONLY `_layout.tsx` to its pre-fix parent (`git checkout HEAD~1 -- _layout.tsx`),
  restoring the bare-name `router.replace(\`/(tabs)/hub/${initialTab}\`)` with no
  map resolution.
- Re-ran `hub-nav-redirect-resolves-route`: **FAILS** on
  `_layout.tsx resolves the picked tab through HUB_TAB_ROUTES, not the bare name`
  → `expect(LAYOUT).toContain("HUB_TAB_ROUTES")` (the layout no longer routes
  through the map). 7 passed / 1 failed.
- Restored the fix → **all 11 pass** (new + nav-lock). Working tree reset clean
  to match `e54cfe923`.

(Also proven pre-rebase on the original base before the ORCH-1144 rebase — same
failing assertion.)

## 6. Scope discipline

- Did NOT rename `listing.tsx`.
- Did NOT touch D-1 (redirect-flash in `brand/[id]/listing.tsx`), D-2
  (`gallery_urls` latent), or D-3 (global last-tab key). Left for separate
  follow-ups.
- Committed ONLY the 3 scoped files. Rebased onto `origin/main` (ORCH-1144
  landed on the same files — clean replay, fix verified intact post-rebase).
- Comms Ledger read on entry; no BLOCK/WARN row addressed to ORCH-1145 or
  mingla-implementor. No cross-ORCH discovery to write.

**Status:** fix implemented, gated, fails-on-revert proven. NOT deployed / merged / closed.
