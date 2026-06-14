# SPEC — ORCH-1136 [business-web shell bugs]

**Phase:** SPEC (forensics). **Binding contract — implementor builds exactly this; no scope widening.**
**Surface:** `mingla-business/` — React-Native-Web at business.usemingla.com + SHARED native iOS/Android business app.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs]/` on branch `ORCH-1136-biz-web-shell-bugs` (rebased on origin/main; ORCH-1134 `62bb9c864` present).
**Upstream investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1136_BIZ_WEB_SHELL_BUGS.md` (FINAL, all 4 symptoms; F-1..F-4, Q1..Q5, per-call-site regression map).
**Comms ledger:** scanned on entry. No `BLOCK`/`OPEN` row addressed to `mingla-forensics`, `ORCH-1136`, or `ALL`. COMMS-0029 (WARN, `biz_update_live_trip` clobber → ORCH-1119/ALL) is out of scope; read, no action.

---

## 1. Executive summary

Four shell bugs on the mingla-business app, all rooted in shared RN/TS code (so all touch native iOS+Android too). They are fixed in THREE self-contained batches, ordered by proof strength and severity:

- **Batch A (proven, highest priority — Symptom 4 + Symptom 2).** The brand-list status machine (`resolveBrandListStatus`) downgrades an already-fetched, non-empty brand list to `query_loading` whenever a background refetch is in flight or the query is momentarily disabled — so the brand switcher and the Account brands list blank to "Loading your brands…" forever / after navigation, discarding cached data they already hold. Same authority feeds the event detail's brand resolution, so a momentarily-null brand makes the event `⋯` menu a silent dead tap (the menu only mounts when `brand !== null`, unlike trip/experience which mount unconditionally). Fix the predicate so a fetched non-empty list is `ready`/`empty` (never downgraded by `isFetching`), and make the event `⋯` menu never a silent no-op once the brand resolves.

- **Batch B (probable root — Symptom 3).** The brand switcher renders pushed up above the viewport when opened from Hub but correct from Home. `TopSheet` overlays via `StyleSheet.absoluteFill` (`position:absolute; top:0`) which anchors to the nearest positioned ancestor = the page host; on Hub the host can scroll (tall non-viewport-bound `<Slot/>` content), so `top:0` becomes the scrolled host top and the panel lands above the viewport. Fix: a **web-gated** anchor to the viewport (fixed positioning + live window dimensions) so host scroll can't offset the sheet; native untouched by construction.

- **Batch C (web-only polish — Symptom 1).** There is NO event-specific header defect — event/trip/experience detail headers resolve to byte-identical top boxes on web, and `insets.top === 0` on web so the bar sits flush against the browser viewport top. Add a **web-only, additive** top spacing to the detail + Home/Hub top bars so the chrome isn't glued to the viewport edge. Additive + web-gated = regression-safe by construction. This addresses the perceived "hug" via design spacing, not a code defect.

Every batch carries an explicit iOS+Android parity success-criterion because every touched file is shared with the native business app.

---

## 2. Scope & non-goals

### In scope
- Correct `resolveBrandListStatus` so a fetched, non-empty brand list is never downgraded to `query_loading` by a background `isFetching` (Batch A / F-4).
- Defense-in-depth at the two status-observing consumers (`BrandSwitcherSheet`, `account.tsx`) so a populated cached list renders even mid-refetch (Batch A / F-4).
- Update the existing `brandListState.test.ts` predicate unit test with the fails-on-revert assertion (Batch A).
- Make the event detail `⋯` menu never a silent dead tap — it must work once the brand resolves, matching trip/experience (Batch A / F-2).
- Web-gate the `TopSheet` overlay anchor to the viewport so host scroll can't offset it (Batch B / F-3).
- Web-only additive top spacing on detail + Home/Hub top bars (Batch C / F-1).

### Non-goals (explicitly NOT in this SPEC)
- **No new authentication / screenshot capture.** None available (Seth confirmed). Batch B is shipped at "probable" with a mandatory implementor runtime-verify on the web build; Batch C is a perceived-spacing polish with no code defect.
- **No conversion of event detail to `SafeScreen`** (the investigation's F-1 convention-cleanup idea). It fixes no proven bug and risks the `I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES` gate; explicitly OUT. Batch C is additive spacing only.
- **No change to the `useBrands` React-Query hook, query keys, `staleTime`, `enabled`, or the Realtime channel.** Const #5: brand-list state stays in React Query. Discovery #6 (Realtime channel keyed on `Date.now()`) is NOT this scope.
- **No change to `EventManageMenu`'s action wiring, Sheet primitive, or the ORCH-0862 conditional-mount-on-`manageMenuVisible` fix** (that fix prevents the iOS UIKit double-present freeze and MUST be preserved — see §4 Batch A).
- **No scope bleed to other ORCHs** (ORCH-1119 trip update, etc.). No consumer-app, admin-web, or buyer-web changes.
- **No `Dimensions.get('window')` → `useWindowDimensions()` swap on native** beyond what Batch B's web gate requires; the native height path stays as-is (the `Dimensions` mix is a logged secondary contributor, Discovery #4, and is addressed only as far as the web fix needs).

### Assumptions
- `insets.top === 0` on web (proven at runtime, F-1) — Batch C's web spacing is purely additive over zero.
- The 15 array-only `useBrandList()` consumers cannot observe `status`/`isLoading` and are automatically safe (per-call-site map, §F-4 regression map). Only `BrandSwitcherSheet` + `account.tsx` observe status.

---

## 3. Cross-Surface Impact Declaration (MANDATORY per-surface table)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | n/a — different app | none | n/a (separate codebase) |
| 2 | Consumer Android (`app-mobile/`) | NO | n/a — different app | none | n/a |
| 3 | Buyer/anonymous Web | NO | n/a — these are authed business shell screens | none | n/a |
| 4 | Business iOS | YES (parity) | A: brand list shows immediately on re-entry while refetching, never "Loading…" flash; event `⋯` never a silent dead tap. B: both TopSheet consumers unchanged on native (native-noop by gate). C: native top inset unchanged (web-gated). | `src/utils/brandListState.ts`, `src/components/brand/BrandSwitcherSheet.tsx`, `app/(tabs)/account.tsx`, `app/event/[id]/index.tsx`, `src/components/ui/TopSheet.tsx` (+ B's web gate), detail/Home/Hub headers (C, web-gated) | **Automatic (shared code)** — A predicate is pure TS; B+C are `Platform.OS==='web'`-gated so native is unchanged by construction. |
| 5 | Business Android | YES (parity) | Same as Business iOS. | same as #4 | Automatic (shared) + gate. |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NO | untouched | none | n/a |
| 7 | Business Web preview (PRIMARY) | YES | A: switcher + Account show cached brands while refetching; event `⋯` opens. B: switcher anchored correctly from Home AND Hub at any scroll. C: top bars have breathing room from viewport top. | same as #4 | Web is the primary surface. |

HARD GATE: every NOT-covered surface has a one-phrase reason above. The covered native surfaces (4, 5) get explicit parity success criteria in §5.

---

## 4. Layered specification

Only the Component / Util layers are touched (no DB / edge / service / hook / Realtime change). Skipped layers are genuinely unaffected.

---

### BATCH A — Symptom 4 (F-4) + Symptom 2 (F-2), shared brand-list root

#### A.1 — Util: `resolveBrandListStatus` (`src/utils/brandListState.ts`)

**Current (line 34):**
```ts
if (isLoading || isFetching || !isFetched) return "query_loading";
```
This returns `query_loading` whenever a refetch is in flight (`isFetching`) even with `itemCount>0` and `isFetched===true`, AND permanently when the query is disabled (`!isFetched`).

**Required change (described, not coded):** Split the loading decision so that **a background refetch never downgrades an already-fetched list**:
- `query_loading` is returned ONLY for the genuine first load — i.e. when the query has **not yet been fetched at least once** (`!isFetched`) OR React Query's own first-load flag `isLoading` is true. (`isLoading` from React Query is already `true` only on the initial fetch with no data — it is the correct first-load signal; keep it.)
- `isFetching` ALONE (with `isFetched === true`) must **no longer** force `query_loading`. After the first successful fetch, the status is decided by `itemCount`: `itemCount === 0 ? "empty" : "ready"`, regardless of an in-flight background refetch.
- All earlier guard branches are UNCHANGED and MUST remain in this exact order and precedence: `auth_loading` (bootstrapping/refreshing) → `error` (authStatus) → `signed_out` → `query_disabled` (`!hasUser`) → `error` (`isError`). These preserve the "signed-out / cold-boot never flashes empty" guarantee.

Net: the final two lines become equivalent to "first-load-only loading, then itemCount decides." The genuine-first-load (`!isFetched`) and auth-bootstrap paths STILL resolve to a loading status (so a cold boot never flashes an empty "no brands" state). The ONLY behavior that changes: a populated-or-empty list that is merely background-refetching now resolves to `ready`/`empty` instead of `query_loading`.

> Note on `query_disabled`: when `hasUser` is false the status is `query_disabled` (unchanged). When `hasUser` is true but the underlying query is disabled for another reason (e.g. `accountId` momentarily null) `isFetched` will be false and the status is `query_loading` — that is acceptable (it is a genuine "not yet fetched" state and the consumers below render cached brands defensively). Do NOT add a new "disabled-but-have-cache" branch; the consumer-level defense (A.2/A.3) covers the cached-display case.

#### A.2 — Component: `BrandSwitcherSheet` (`src/components/brand/BrandSwitcherSheet.tsx`)

**Current (lines 93–106):** `brandList.isLoading ? <Loading> : status==='error' ? <Error> : <ScrollView>{brands.map(...)}</ScrollView>`. The `isLoading` branch precedes the list branch, so any loading flag blanks a populated list.

**Required change (defense-in-depth):** Render the cached `brands` list whenever `brands.length > 0`, **before** falling back to the loading branch. Precisely: reorder/guard the render so the order of precedence is:
1. `status === "error"` AND `brands.length === 0` → error state.
2. `brands.length > 0` → render the `<ScrollView>` brand list (even if `isLoading`/`isFetching` — they're being refreshed in the background).
3. `brandList.isLoading` (and `brands.length === 0`) → "Loading your brands…".
4. otherwise (empty, fetched) → the existing empty/create affordance (current `mode==='create'` path already covers `isTrueEmpty`).

The A.1 predicate change alone fixes the reported bug; this consumer reorder is mandatory defense-in-depth so a populated list is NEVER hidden behind a transient loading flag even if a future status regression reappears. Keep the existing `mode === "create"` branch (BrandCreationFlow) and the `isTrueEmpty` logic exactly as-is.

#### A.3 — Screen: `account.tsx` (`app/(tabs)/account.tsx`, lines 261–306)

**Current:** `status === "ready"` renders the list; the very next branch renders "Loading your brands…" for `auth_loading || query_loading || isAuthWarming`. With A.1 fixed, a populated-but-refetching list is now `ready`, so it renders correctly. Add the same defense-in-depth:

**Required change:** Make the "ready / show brands" branch fire whenever `brands.length > 0` (not only `status === "ready"`), so a populated list renders even if the status machine is transiently in a loading state. Concretely: change the leading condition from `brandList.status === "ready"` to `brandList.status === "ready" || brands.length > 0`. Leave the `auth_loading || query_loading || isAuthWarming` loading branch, the `error` branch, and the `empty` branch unchanged in order after it. The existing `brandListState.test.ts` source-grep assertions (`brandList.status === "empty"`, `"Loading your brands"`, `useBrandListState`) MUST still pass — do not remove those literal strings.

#### A.4 — Screen: event detail `⋯` menu (`app/event/[id]/index.tsx`, line 841)

**Current:** `{brand !== null && manageMenuVisible ? <EventManageMenu .../> : null}`. When `brand === null`, tapping `⋯` (`handleManageOpen` → `manageMenuVisible = true`) mounts nothing → silent dead tap (Constitution #1). `EventManageMenu` (`src/components/event/EventManageMenu.tsx:46`) declares `brand: Brand;` — required non-null — which is why the call site gates on it.

**Root-cause constraint:** Two real constraints collide and BOTH must be honored:
1. `EventManageMenu` needs a non-null `brand` to render its actions (brand page link, public-page URL, etc.).
2. The ORCH-0862 fix (comment at lines 825–840) requires the menu to fully UNMOUNT when `manageMenuVisible` is false (mounting `EventManageMenu` with `visible=false` left a lingering native Modal that caused an iOS UIKit double-present freeze). So the `&& manageMenuVisible` half of the gate MUST be preserved.

**Required change (described, not coded) — eliminate the silent no-op without regressing ORCH-0862:** The fix is at the `handleManageOpen` handler + a feedback affordance, NOT by mounting `EventManageMenu` with a null brand. Implement BOTH:

- **(a) Make brand resolve reliably.** Batch A.1 already removes the most common null-brand trigger (the wedged/empty brand list). After A.1, `useManagedEventRoute`'s `brands` array (line 34, `useBrandList()` — array-only, SAFE-AUTO per the regression map) is populated sooner, so `brand` resolves for locally/trip-fallback-resolved events. This is the primary fix and is automatic from A.1.

- **(b) Guarantee no silent dead tap when brand is still null.** Modify `handleManageOpen` so that when `brand === null` at tap time it does NOT silently set `manageMenuVisible` to a state that mounts nothing. Instead it must give explicit feedback. The mandated behavior: if `brand === null`, show a brief, already-present toast affordance (the screen already renders a `Toast` — reuse it) with copy `"Loading brand… tap again in a moment."` (or trigger a refetch of the brand list and keep the existing toast pattern), and do NOT enter a silent no-op state. When `brand !== null`, behavior is exactly as today (set `manageMenuVisible = true`, the existing conditional mounts the menu). The line-841 conditional mount stays `{brand !== null && manageMenuVisible ? ... : null}` UNCHANGED (preserving ORCH-0862); the dead-tap is cured at the handler, not the mount.

This satisfies Const #1 (no silent no-op), preserves the non-null `brand` prop contract of `EventManageMenu`, and preserves the ORCH-0862 unmount-on-close invariant — all three.

> Implementor note: confirm the `Toast` state/setter already in `app/event/[id]/index.tsx` (it renders `<Toast>` near line 814+ region). If the toast setter is not in scope at `handleManageOpen`, surface it the same way other handlers on this screen do (do not introduce a new toast system).

---

### BATCH B — Symptom 3 (F-3): Hub brand-switcher offset (WEB-GATED viewport anchor)

#### B.1 — Component: `TopSheet` (`src/components/ui/TopSheet.tsx`)

**Current root (lines 314–319):** the sheet overlay root is `<View style={StyleSheet.absoluteFill} ...>`. RNW resolves `absoluteFill` to `position:absolute; top:0; left:0; right:0; bottom:0`, anchoring to the nearest positioned ancestor (every RNW `View` defaults `position:relative`) = the page host. On Hub the host can document-scroll (tall non-viewport-bound `<Slot/>`), so `top:0` is the scrolled host top and the panel (`anchor` at `top = insets.top + 76`, line 166) lands above the viewport. Home's host is viewport-bound (inner FlatList scroll) so the anchor is correct there.

Secondary (lines 134/138/145): `screenHeight = Dimensions.get('window').height` (snapshot) drives `fixedHeight = screenHeight * 0.7` and `closedY = -panelHeight`, while `useWindowDimensions()` is used only for blur width. On web a stale snapshot can yield a short/wrong panel height.

**Required change (WEB-GATED, native-noop by construction):**

1. **Anchor the overlay to the viewport on web only.** Add a `Platform.OS === 'web'` style override on the root overlay `View` (line ~315–318) that sets `position: 'fixed'` and `top/left/right/bottom: 0` so the overlay fills the **browser viewport**, not the scrollable page host. On native, `StyleSheet.absoluteFill` is used UNCHANGED (RN has no `position:'fixed'`; the gate must NOT apply it on native). Concretely: compute a `rootStyle` = `Platform.OS === 'web' ? [StyleSheet.absoluteFill, { position: 'fixed' }] : StyleSheet.absoluteFill` and apply to the root `View`. (`position:'fixed'` is a valid RNW web value; it is not a valid RN native value, hence the gate.) This makes the `anchor`'s `top: insets.top + 76` resolve relative to the viewport regardless of host scroll — fixing the Hub offset at the root.

2. **Single-source the window height on web to a live value.** On web, derive the panel's `fixedHeight` from a live viewport height rather than the `Dimensions.get('window')` snapshot. Use the existing `useWindowDimensions()` hook (already imported and called at line 138) — read its `height` as well as `width`, and on web use that live height for `fixedHeight`/`closedY`. On native, keep `Dimensions.get('window').height` UNCHANGED (the snapshot semantics are fine on native and the parity table requires native height behavior to be preserved on rotation). Concretely: `const liveHeight = Platform.OS === 'web' ? windowHeight : Dimensions.get('window').height;` then `fixedHeight = liveHeight * PANEL_HEIGHT_RATIO`. This removes the secondary short-panel contributor on web without altering native.

3. **No change to** the `anchor` style, `panelTop` (`insets.top + TOPBAR_OFFSET`), animation curves/durations, swipe-up dismiss, scrim, compact-mode measurement, `heightMode` branching, Escape/back handlers, or the L1–L4 glass stack. The fix is ONLY: (a) web root `position:fixed`, (b) web live height.

**Confidence: probable.** The implementor MUST runtime-verify on the web build (see SC-3-Web). If the web runtime shows the offset persists after the fixed-position anchor, STOP and request a SPEC amendment (do not guess a second mechanism).

---

### BATCH C — Symptom 1 (F-1): top-bar breathing room (WEB-ONLY additive spacing)

#### C.1 — Detail headers + Home/Hub top bars (web-gated additive top padding)

**Current:** On web `insets.top === 0` (no `viewport-fit=cover`; F-1 runtime-proven). Event detail (`app/event/[id]/index.tsx:613`) applies `paddingTop: insets.top` (= 0 on web) to `headerWrap`; trip (`app/trip/[id]/index.tsx:358/364`) and experience (`app/experience/[id]/index.tsx:262`) apply `insets.top` via `SafeScreen` host (= 0 on web). Home (`app/(tabs)/home.tsx:416`) and Hub (`app/(tabs)/hub/_layout.tsx:194`) apply `paddingTop: insets.top` (= 0 on web). All four/five top bars therefore sit flush against the browser viewport top — the perceived "hug." There is NO event-specific defect (event/trip headers are byte-identical on web — F-1).

**Chosen spacing value + justification:** add **`spacing.sm` (8px)** of additional top padding on web only. Rationale: it is a real design token (`src/constants/designSystem.ts:32`, `sm: 8`), it approximates a minimal web "status-bar-equivalent" breathing gap without mimicking a native notch inset (which would look wrong on desktop web), and it is the smallest token that visibly unglues the bar from the viewport edge. (Do NOT use `insets.top`'s native magnitude — desktop web has no notch.)

**Required change (WEB-ONLY, additive, applied CONSISTENTLY to all detail + Home/Hub top bars):** At each of the five top-bar wrappers, add `Platform.OS === 'web' ? spacing.sm : 0` to the existing top padding. Apply identically to:
- `app/event/[id]/index.tsx:613` `headerWrap` — `paddingTop: insets.top + (Platform.OS === 'web' ? spacing.sm : 0)`.
- `app/trip/[id]/index.tsx` — the `SafeScreen`-wrapped `host`/`headerWrap`. Since trip/experience get their inset from `SafeScreen` (which is shared), DO NOT edit `SafeScreen` (that would change every route). Instead add the web-only `spacing.sm` to the trip/experience **`headerWrap`** style (currently `paddingHorizontal: spacing.md` only) via an inline `Platform.OS === 'web'` top padding, mirroring the event change so all three detail headers match.
- `app/experience/[id]/index.tsx` — same web-only `spacing.sm` on its `headerWrap`/equivalent header container.
- `app/(tabs)/home.tsx:416` and `app/(tabs)/hub/_layout.tsx:194` — add `(Platform.OS === 'web' ? spacing.sm : 0)` to the host's `paddingTop` (currently `insets.top`).

Use the existing `Platform` import where present (`event/[id]/index.tsx` already imports `Platform`); add the import where missing (trip, experience, home, hub `_layout` — confirm and add `Platform` + `spacing` imports as needed). `insets.top` stays in the expression so native is byte-identical (`+ 0` on native).

**Honesty note (carried into the report):** This is a perceived-spacing polish, not a code-defect fix. F-1's header-container theory is proven negative on web; there is no event-vs-trip asymmetry. Batch C makes Seth's perceived "hug" go away via additive design spacing. It is regression-safe by construction (additive + web-gated).

---

## 5. Success criteria (numbered, per-surface where parity is manual)

### Batch A
- **SC-A1 (predicate):** `resolveBrandListStatus({ ...base, isFetching: true, isFetched: true, itemCount: 3 })` returns `"ready"` (was `"query_loading"`). With `itemCount: 0` it returns `"empty"`. With `isFetched: false` it STILL returns `"query_loading"`. With `authStatus: "bootstrapping"` it STILL returns `"auth_loading"`. With `hasUser: false` it STILL returns `"query_disabled"`. Signed-out → `"signed_out"`.
- **SC-A2-Web:** On the web build, open the brand switcher after navigating to a standalone detail route and back (background refetch in flight): the cached brand rows render immediately; "Loading your brands…" does NOT appear when brands are already known. Navigating repeatedly never wedges it on "Loading…".
- **SC-A3-Web:** On the web build, open Account after 30s+ idle (stale background refetch): "Your brands" list renders the cached rows; no "Loading your brands…" flash while brands exist.
- **SC-A4-Web:** On the web build, on an event whose brand is resolvable, tapping `⋯` opens `EventManageMenu`. On an event whose brand is momentarily null, tapping `⋯` shows the loading toast (`"Loading brand… tap again in a moment."`) — NEVER a silent dead tap. Once brand resolves, `⋯` opens the menu. Trip/experience `⋯` behavior is unchanged (opens immediately).
- **SC-A5-iOS / SC-A6-Android (parity):** On the native business app: (a) open Account → brands list shows immediately on re-entry (no "Loading…" flash) while background-refetching; (b) open brand switcher from Home after backgrounding the app 30s+ → cached brands visible, not "Loading…"; (c) cold-boot signed-in → first load STILL shows "Loading…" until data arrives (no empty flash); (d) signed-out → switcher/Account never show an empty "no brands" state; (e) event `⋯` on a locally/trip-fallback-resolved event whose brand isn't yet in the list → menu opens after A.1 resolves the brand, or shows the loading toast — never a silent dead tap; trip/experience `⋯` unchanged; the ORCH-0862 unmount-on-close behavior (no double-present freeze) is preserved.

### Batch B
- **SC-B1-Web (PRIMARY, runtime-verify mandatory):** On the web build, open the brand switcher from **Hub** (after scrolling the Hub content down) → the panel anchors at `insets.top + 76` below the topbar, fully visible, identical to opening from **Home**. Measure: the panel's `getBoundingClientRect().top` is the same from Hub-scrolled and Home-unscrolled (≈76px from viewport top), and is independent of the host's `scrollTop`. The "only the bottom row peeks" symptom is gone.
- **SC-B2-Web:** Both TopSheet consumers verified from BOTH a scrolled and an unscrolled host on web: (a) `BrandSwitcherSheet` (`heightMode="fixed-70"`) from Home (unscrolled) and Hub (scrolled + unscrolled); (b) `UniversalCreatorSheet` (`heightMode="compact"`) from Home and Hub (scrolled + unscrolled). All four open correctly anchored. Panel height is correct (no short/stale panel) on window resize.
- **SC-B3-iOS / SC-B4-Android (parity):** On native iOS+Android, open BOTH sheets (BrandSwitcherSheet + UniversalCreatorSheet) from Home AND Hub → anchor stays `insets.top + 76` below the real topbar; open/close translate animation, swipe-up dismiss, scrim, `fixed-70` height, and `compact` measurement are all UNCHANGED. Rotate the device → panel height tracks the new dimensions correctly (the web live-height change is gated off on native, so native uses `Dimensions.get('window')` exactly as before). The native sheet position/animation is byte-identical to pre-fix.

### Batch C
- **SC-C1-Web:** On the web build, the event, trip, and experience detail top bars each sit `spacing.sm` (8px) below the browser viewport top — visibly un-glued, and identical to each other (no event-vs-trip asymmetry).
- **SC-C2-Web:** Home and Hub top bars also have the same `spacing.sm` web breathing gap.
- **SC-C3-iOS / SC-C4-Android (parity):** On native iOS+Android, the event/trip/experience/Home/Hub top insets are BYTE-IDENTICAL to pre-fix (`+ 0` on native; only `insets.top` applies). No double-inset, no layout shift.

---

## 6. Invariants

### Preserved
- **Const #1 (no silent dead taps)** — A.4 cures the event `⋯` dead tap with an explicit toast affordance; verified by SC-A4.
- **Const #5 (server state in React Query, not Zustand)** — A.1/A.2/A.3 keep brand-list state in React Query; no Zustand copy introduced. Verified by no new `setBrands(`/Zustand-write path (the existing shim `useBrandListShim.ts` stays read-only).
- **ORCH-0862 unmount-on-close (no iOS UIKit double-present freeze)** — A.4 preserves the `{brand !== null && manageMenuVisible ? ... : null}` conditional mount UNCHANGED; the dead-tap fix is at the handler. Verified by SC-A5(e).
- **DEC-080 / DEC-NEW-A / DEC-NEW-B (TopSheet 2 approved consumers + `fixed-70`/`compact`)** — Batch B touches only `TopSheet` internals, web-gated; both approved consumers verified (SC-B2); `fixed-70` + `compact` preserved. No third consumer added.
- **I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES** — Batch C does NOT convert event to `SafeScreen` and does NOT edit `SafeScreen`; the strict-grep gate stays green. The trip/experience header change is an additive inline web padding on `headerWrap`, not a `SafeScreen` edit.
- **I-37 (TopBar `leftKind="brand"` MUST NOT pass `rightSlot=`)** — detail headers use `leftKind="back"` + `rightSlot=`; unchanged.

### New (DRAFT — orchestrator flips ACTIVE on CLOSE)
- **I-PROPOSED-BRANDLIST-CACHED-OVER-REFETCH** (Batch A primary)
  - **Rule:** A brand list that has been fetched at least once (`isFetched === true`) and is non-empty is NEVER hidden behind a background-refetch (`isFetching`) or disabled loading flag. `query_loading` is reserved for the genuine first load (`!isFetched` / React-Query `isLoading`) and auth bootstrap (`auth_loading`).
  - **Enforcement:** the `resolveBrandListStatus` unit test asserts `{ isFetching: true, isFetched: true, itemCount: 3 } → "ready"` (and `itemCount: 0 → "empty"`), and a source-grep that the cached-list render branch precedes the loading branch in `BrandSwitcherSheet.tsx` and `account.tsx`.
  - **Regression test:** `src/hooks/__tests__/brandListState.test.ts` — the new `ready`-while-refetching assertion FAILS if line 34's `|| isFetching` is restored.
- **I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR** (Batch B, DRAFT)
  - **Rule:** On web, the `TopSheet` overlay anchors to the browser viewport (`position:'fixed'`), not the scrollable page host, so host document scroll cannot offset the sheet. The native overlay continues to use `StyleSheet.absoluteFill` (no `position:'fixed'`).
  - **Enforcement:** source-grep that `TopSheet.tsx` applies `position:'fixed'` only under a `Platform.OS === 'web'` guard; runtime SC-B1.
  - **Regression test:** a source-grep gate asserting the web root style includes `position: 'fixed'` behind a `Platform.OS === 'web'` gate; FAILS if reverted to bare `absoluteFill`.
- **I-PROPOSED-WEB-TOPBAR-BREATHING-GAP** (Batch C, DRAFT)
  - **Rule:** Detail + Home/Hub top bars add `spacing.sm` top padding ONLY on web (`Platform.OS === 'web'`); native top insets are untouched.
  - **Enforcement:** source-grep that the five top-bar wrappers add `Platform.OS === 'web' ? spacing.sm : 0`; native parity SC-C3/C4.
  - **Regression test:** source-grep gate; FAILS if a non-web-gated top padding is introduced or the web gap is removed.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-A1 (happy) | populated list, background refetch | `{...base, isFetching:true, isFetched:true, itemCount:3}` | `"ready"` | util (unit) |
| T-A2 (happy) | empty list, fetched, refetching | `{...base, isFetching:true, isFetched:true, itemCount:0}` | `"empty"` | util (unit) |
| T-A3 (edge, KEEP) | genuine first load | `{...base, isFetched:false}` | `"query_loading"` | util (unit) |
| T-A4 (edge, KEEP) | auth bootstrap | `{...base, authStatus:"bootstrapping", itemCount:0}` | `"auth_loading"` | util (unit) |
| T-A5 (edge, KEEP) | no user | `{...base, hasUser:false}` | `"query_disabled"` | util (unit) |
| T-A6 (error) | query error | `{...base, isError:true}` | `"error"` | util (unit) |
| T-A7 (signed out) | signed out | `{...base, authStatus:"signed_out"}` | `"signed_out"` | util (unit) |
| T-A8 (source-grep) | consumer order | `BrandSwitcherSheet.tsx` + `account.tsx` source | cached-list branch (`brands.length > 0`) precedes loading branch | component (grep) |
| T-A9 (happy, runtime) | event ⋯ with brand | resolvable brand event, tap ⋯ | menu opens | component (web + native) |
| T-A10 (error path) | event ⋯ null brand | brand momentarily null, tap ⋯ | loading toast, NOT a dead tap | component (web + native) |
| T-B1 (happy, runtime) | switcher from Hub scrolled | Hub scrolled down, open switcher | panel `getBoundingClientRect().top ≈ 76`, same as Home | component (web) |
| T-B2 (edge, runtime) | compact sheet from Hub | UniversalCreatorSheet from Hub scrolled | anchored correctly | component (web) |
| T-B3 (parity) | native both sheets Home+Hub | iOS+Android | anchor/anim/height unchanged vs pre-fix | component (native) |
| T-C1 (happy, runtime) | web top-bar gap | event/trip/exp/Home/Hub on web | `spacing.sm` gap above bar, all equal | component (web) |
| T-C2 (parity) | native top inset | iOS+Android | byte-identical to pre-fix (`+0`) | component (native) |

---

## 8. Implementation order

1. **Batch A.1** — edit `src/utils/brandListState.ts` line 34 (split first-load vs refetch).
2. **Batch A** — update `src/hooks/__tests__/brandListState.test.ts`: ADD T-A1/T-A2 assertions; KEEP T-A3..T-A7; run `npm test` and confirm T-A1 FAILS on a reverted predicate, PASSES on the fix.
3. **Batch A.2** — `BrandSwitcherSheet.tsx`: reorder render so `brands.length > 0` precedes the loading branch.
4. **Batch A.3** — `account.tsx`: change leading condition to `status === "ready" || brands.length > 0`; keep the literal strings the existing source-grep test asserts.
5. **Batch A.4** — `app/event/[id]/index.tsx`: harden `handleManageOpen` to show the loading toast when `brand === null` (no silent no-op); leave line-841 conditional mount unchanged.
6. **Batch B.1** — `TopSheet.tsx`: web-gated `position:'fixed'` root + web live-height; native unchanged. **Runtime-verify SC-B1 on the web build before proceeding.**
7. **Batch C.1** — add web-only `spacing.sm` top padding to event/trip/experience `headerWrap` + Home/Hub host `paddingTop`; add `Platform`/`spacing` imports where missing.
8. Run the full `mingla-business` jest suite + the relevant strict-grep gates; build the web bundle; runtime-verify each `-Web` SC; hand the native parity SCs to the tester / Seth-driven device run.

---

## 9. Regression prevention (fails-on-revert contract)

- **Batch A (structural safeguard):** `src/hooks/__tests__/brandListState.test.ts` gains the assertion `resolveBrandListStatus({...base, isFetching:true, isFetched:true, itemCount:3}) === "ready"`. **This test MUST FAIL when line 34 is reverted to `if (isLoading || isFetching || !isFetched) return "query_loading"` and PASS when the fix is in place.** Plus a source-grep test that the `brands.length > 0` render branch precedes the loading branch in both consumers. Protective comment at the predicate explaining "background refetch must not downgrade a fetched non-empty list — ORCH-1136 F-4."
- **Batch A.4:** a component/source test that an event `⋯` tap with `brand === null` does not reach a silent no-op (asserts the toast affordance fires). Fails on revert to a bare silent `setManageMenuVisible(true)`.
- **Batch B:** source-grep gate asserting `TopSheet.tsx` applies `position:'fixed'` only behind `Platform.OS === 'web'`; FAILS if reverted to bare `absoluteFill`. Plus the mandatory runtime SC-B1 (probable → must be runtime-confirmed before merge).
- **Batch C:** source-grep gate asserting the five top-bar wrappers carry `Platform.OS === 'web' ? spacing.sm : 0`; FAILS if the web gap is removed or a non-web-gated top padding is introduced. Protective comment: "web-only breathing gap; native uses insets only — ORCH-1136 F-1 (no code defect, perceived-spacing polish)."

---

## 10. Open questions

- **Batch B confidence is "probable," not proven** (no authed DOM measurement was possible — no creds). The implementor MUST runtime-verify SC-B1 on the web build (login on the dev build, scroll Hub, open switcher, measure panel `getBoundingClientRect().top` + host `scrollTop`). If the `position:'fixed'` anchor does NOT eliminate the offset, STOP and request a SPEC amendment — do not guess a second mechanism (candidate alternates noted in the investigation: portal to document root, or pin the route host non-scrolling). Resolve before CLOSE.
- **Batch C is a perceived-spacing polish, not a code-defect fix** (F-1 header theory proven negative on web). If after shipping `spacing.sm` Seth still perceives a "hug," the next step is an authed event-vs-trip side-by-side capture (not a code change) — flagged, not silently resolved. The `spacing.sm` value is the SPEC's choice; if Seth wants more, it's a one-token bump (`spacing.md` = 16), not a re-architecture.
- **Toast plumbing in A.4** — confirm the `Toast` setter is in scope at `handleManageOpen` in `app/event/[id]/index.tsx`. If it is not, surface it the same way the screen's other handlers do; do NOT introduce a new toast system (would be scope creep).

---

## 11. Downstream routing

- **Next = `mingla-implementor`.** Build Batches A → B → C in §8 order. Batch B requires the mandatory web runtime-verify before it can be marked done; Batch C is additive/web-gated.
- **Then = `mingla-tester`.** Verify every `-Web` SC on the web build and the iOS+Android parity SCs (SC-A5/A6, SC-B3/B4, SC-C3/C4) on native — the native runs are human-in-the-loop on the physical/sim business app. Confirm all fails-on-revert gates. Batch B's "probable" label is lifted to "proven" only by the tester's web runtime measurement of the panel anchor.
- **Then = orchestrator CLOSE.** Flip the three DRAFT invariants ACTIVE; sync World Map / bug list; reconcile the registration against Seth's original 4-symptom request (no scope bleed).
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs]/` on branch `ORCH-1136-biz-web-shell-bugs`.

---

## Scoped allowlist (implementor may modify ONLY these)

- `mingla-business/src/utils/brandListState.ts` (A.1)
- `mingla-business/src/hooks/__tests__/brandListState.test.ts` (A test)
- `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (A.2)
- `mingla-business/app/(tabs)/account.tsx` (A.3)
- `mingla-business/app/event/[id]/index.tsx` (A.4 + C.1)
- `mingla-business/src/components/ui/TopSheet.tsx` (B.1)
- `mingla-business/app/trip/[id]/index.tsx` (C.1)
- `mingla-business/app/experience/[id]/index.tsx` (C.1)
- `mingla-business/app/(tabs)/home.tsx` (C.1)
- `mingla-business/app/(tabs)/hub/_layout.tsx` (C.1)
- New strict-grep gate file(s) under the repo's existing gate location (for I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR + I-PROPOSED-WEB-TOPBAR-BREATHING-GAP), matching the existing gate pattern.

## DO-NOT-TOUCH (stop-and-amend before modifying any of these)

- `mingla-business/src/hooks/useBrandListShim.ts` — read-only shim; do NOT add Zustand writes or change the public hook contract (Const #5). The predicate fix is entirely in `brandListState.ts`.
- `mingla-business/src/hooks/useBrands.ts` — query key, `staleTime`, `enabled`, Realtime channel UNCHANGED.
- `mingla-business/src/components/ui/SafeScreen.tsx` — do NOT edit (would change every route; breaks the safe-area gate). Batch C uses inline web padding on `headerWrap`, not `SafeScreen`.
- `mingla-business/src/components/event/EventManageMenu.tsx` — the non-null `brand` prop contract STAYS; do NOT relax it to nullable.
- The line-841 `{brand !== null && manageMenuVisible ? ... : null}` conditional mount — preserve the ORCH-0862 unmount-on-close behavior; do NOT mount `EventManageMenu` with a null brand or with `visible=false`.
- `TopSheet` native code path — the `Dimensions.get('window')` height on native, animation curves/durations, swipe-up, scrim, `heightMode` branching, glass L1–L4 stack — all UNCHANGED (web-gated changes only).
- Any consumer-app (`app-mobile/`), admin-web (`mingla-admin/`), or buyer-web file. Any other ORCH's files.
- The 15 array-only `useBrandList()` call sites — they need no change (SAFE-AUTO).
