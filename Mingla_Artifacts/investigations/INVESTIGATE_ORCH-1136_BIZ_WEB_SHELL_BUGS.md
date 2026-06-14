# INVESTIGATE — ORCH-1136 [business-web shell bugs] (FINAL, all 4 symptoms)

**Phase:** INVESTIGATE (forensics). **No fix proposed — direction + regression contract only.**
**Surface:** mingla-business React-Native-Web build (business.usemingla.com).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs]/` on branch `ORCH-1136-biz-web-shell-bugs` (rebased on origin/main; ORCH-1134 `62bb9c864` present).
**Runtime env (prior pass):** web dev build served from a bracket-free clone (`/tmp/orch1136-clean`, port 8125) driven with Playwright/Chromium. App boots + bootstraps auth + renders the signed-out welcome. **Authenticated detail pages were NOT reachable (no login credentials — a genuine STOP-and-ask blocker per forensics PD-9).** Pure-CSS/web-platform facts proven at runtime; auth-gated UI behaviors proven by source + deterministic predicate probes and labelled accordingly.
**This pass (continuation):** no new auth/screenshots available (Seth confirmed). Symptoms 1 & 3 driven to their honest ceiling by source + RNW internals + the four original screenshots; Symptom 4 helper turned into a per-call-site regression map; cross-platform parity notes + fix sequence added for all four.

Evidence: `Mingla_Artifacts/evidence/ORCH-1136/` (RUNTIME_FINDINGS.md, probe logs, 4 screenshots). Prior `/tmp` probe `.mjs` files were ephemeral; their verbatim outputs are transcribed in the Findings below.

---

## Comms ledger
Scanned `COMMS_LEDGER.md` active table. No `BLOCK`/`OPEN` entry addressed to `mingla-forensics`, `ORCH-1136`, or `ALL`. COMMS-0029 (WARN, `biz_update_live_trip` clobber) is addressed to ORCH-1119/ALL but concerns trip-update migration coordination — not this scope; read, no action. Nothing to ack.

---

## Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `app/event/[id]/index.tsx` | Symptom 1+2 — event header + ⋯ menu mount gate |
| 2 | `app/trip/[id]/index.tsx` | Symptom 1+2 — the "correct" comparison header + ⋯ |
| 3 | `app/experience/[id]/index.tsx` | 3rd datapoint — header + ⋯ parity |
| 4 | `src/components/ui/SafeScreen.tsx` | Symptom 1 — top-inset wrapper, web render output |
| 5 | `src/components/ui/TopBar.tsx` | shared header chrome (identical for all three) |
| 6 | `src/components/ui/TopSheet.tsx` | Symptom 3 — full sheet anchor geometry |
| 7 | `app/(tabs)/home.tsx` | Symptom 3 — Home switcher mount + host/scroll structure |
| 8 | `app/(tabs)/hub/_layout.tsx` | Symptom 3 — Hub switcher mount + Slot structure |
| 9 | `app/(tabs)/hub/{events,trips,experiences}.tsx` | Symptom 3 — Slot sub-route scroll/height divergence |
| 10 | `app/(tabs)/_layout.tsx` + `DesktopCanvas.tsx` | Symptom 3 — web containing-block chain |
| 11 | `app/+html.tsx` | Symptom 1+3 — viewport / safe-area / scroll-reset config |
| 12 | `src/components/brand/BrandSwitcherSheet.tsx` | Symptom 4 — loading-state render branch |
| 13 | `src/hooks/useBrandListShim.ts` + `src/utils/brandListState.ts` | Symptom 4 — the status state-machine + the two public hooks |
| 14 | `app/(tabs)/account.tsx` | Symptom 4 — the SECOND `useBrandListState` consumer (same bug) |
| 15 | `src/hooks/__tests__/brandListState.test.ts` | Symptom 4 — existing regression-test home |
| 16 | `src/hooks/useManagedEventRoute.ts` + `EventManageMenu.tsx` | Symptom 2 — brand-null mount gate + prop contract |
| 17 | all ~17 `useBrandList`/`useBrandListState` call sites | Symptom 4 — regression map |
| 18 | `node_modules/react-native-web/.../StyleSheet/index.js` | Symptom 3 — `absoluteFill` resolved CSS |

---

## Q-scorecard

- **Q1 — Why does the event detail header hug the viewport top vs trip?**
  **Verdict: RULED OUT (header-container theory) — proven-negative on web; positive root SUSPECTED/inconclusive.**
  The SafeScreen-vs-plain-View asymmetry the prior pass floated produces **zero** web spacing difference. Resolved box diff (below) shows event and trip have BYTE-IDENTICAL top spacing on web (host identical, headerWrap identical, both `paddingTop:0`, TopBar identical, SafeScreen emits no web fallback). The reported divergence is NOT a header-container difference. Capped at suspected for any real positive cause because authed side-by-side capture is blocked.

- **Q2 — Why does ⋯ no-op on event but fire on trip?**
  **Verdict: PROVEN (mechanism) / PROBABLE (runtime).** Event gates the menu mount on `brand !== null && manageMenuVisible`; `EventManageMenu` takes a **required non-null `brand` prop**. Null brand → tap sets state, nothing mounts → dead tap. Trip/experience mount their menu unconditionally.

- **Q3 — Why is the brand switcher offset up from Hub but correct from Home?**
  **Verdict: PROBABLE (single best-supported mechanism).** The sheet's `TopSheet` root is `StyleSheet.absoluteFill` (`position:absolute; top:0; bottom:0`), anchoring to its nearest positioned ancestor — the page host. On **Home** the host is viewport-bound (scroll lives in inner FlatLists), so the panel's `top:insets.top+76` lands at the true viewport top. On **Hub** the host stacks MORE chrome (TopBar + To-Do toggle + HubSubNav) ABOVE a tall `<Slot/>` sub-route, and at least one sub-route path (experiences / generation surface) is NOT viewport-flex-bound → the host/document can scroll; when Hub is scrolled at open time, `absoluteFill top:0` is the scrolled-up host top, so `top:76` lands ABOVE the viewport and only the panel's BOTTOM ("Create a new brand") peeks near the top — exactly the screenshot. Secondary contributor: `panelHeight = Dimensions.get('window').height * 0.7` mixes a `Dimensions` read with `useWindowDimensions` (used only for blur width), which can yield a short/stale height. Capped at probable: no authed DOM measurement of the panel's computed `top`/containing-block/scrollTop was possible.

- **Q4 — Why does the switcher go "Loading brands…" forever / vacant after navigating?**
  **Verdict: PROVEN (mechanism).** `resolveBrandListStatus` returns `query_loading` whenever `isFetching || !isFetched` — including when `brands` is ALREADY POPULATED but a 30s-stale background refetch is in flight, and permanently when the query is disabled (`isFetched=false`). The render branch checks `isLoading` BEFORE rendering cached `brands` → blanks to "Loading…" and discards data it holds. Proven deterministically with the verbatim predicate; reproduced as the SAME bug on a second surface (`account.tsx`).

- **Q5 — Are 2 and 4 the same root?** **Verdict: PROVEN linked.** Symptom 4's empty/wedged brand list makes `useManagedEventRoute` resolve `brand=null`, triggering Symptom 2's dead tap. Same brand-list authority feeds both.

---

## Findings

### F-1 — Symptom 1: event header hug — header containers are IDENTICAL on web (CONFIRMED negative)
- **Symptom:** event `/event/{id}` "Event" top bar appears flush to viewport top; trip allegedly spaced.
- **Layer:** code + runtime.
- **Probe:** read all three detail headers + `SafeScreen` (full) + `TopBar` styles + `+html.tsx`; diff resolved `host`/`headerWrap` style VALUES event-vs-trip; prior runtime measured `env(safe-area-inset-top)`.
- **Evidence (resolved-box diff — the deeper proof the prior pass skipped):**
  - **Event** `app/event/[id]/index.tsx:611` host `<View style={styles.host}>`; `:613` `<View style={[styles.headerWrap, { paddingTop: insets.top }]}>`.
    - `:930-933` `host: { flex:1, backgroundColor:"#0c0e12" }`
    - `:934-936` `headerWrap: { paddingHorizontal: spacing.md }` (NO top padding)
  - **Trip** `app/trip/[id]/index.tsx:358` `<SafeScreen style={styles.host}>`; `:364` `<View style={styles.headerWrap}>`.
    - `:672-674` `host: { flex:1, backgroundColor:"#0c0e12" }` — **identical to event**
    - `:697-699` `headerWrap: { paddingHorizontal: spacing.md }` — **identical to event**
  - **SafeScreen** `src/components/ui/SafeScreen.tsx:90-94` (FULL read): `const padding = { paddingTop: edges.includes("top") ? insets.top : 0, paddingBottom: ... }`; `:96` `<View style={[styles.host {flex:1}, padding, style]}>`. **No `env()`, no hardcoded fallback, no StatusBar spacer, no web minimum, no `headerShown` concept.** SafeScreen's ONLY top contribution is `insets.top`.
  - **Inset on web** `app/+html.tsx:27-30` viewport has NO `viewport-fit=cover` → `env(safe-area-inset-top)` resolves `0px` on web (prior runtime: `{"envTop":"0px"}`, SafeAreaProvider divs `top:0px`). So `useSafeAreaInsets().top === 0` for every web route.
  - **TopBar** `src/components/ui/TopBar.tsx:314-323` `bar`/`barInner` = `minHeight: TOPBAR_HEIGHT` + horizontal padding only; no internal top padding; no `expo-status-bar`/`StatusBar` anywhere. Shared identically by event/trip/experience.
  - **Hero** `app/event/[id]/index.tsx:646` the event hero/cover sits INSIDE the ScrollView BELOW the header — it does not overlap or pull the header up.
- **Mechanism:** On web, event and trip headers resolve to the SAME top box: `paddingTop = insets.top = 0`, same `host`, same `headerWrap`, same `TopBar`. SafeScreen contributes nothing extra on web. There is therefore **no header-container source of a top-spacing difference between event and trip on web** — the prior pass's plain-View-vs-SafeScreen lead is disproven at the style-value level, not merely asserted "cosmetic." On NATIVE, `insets.top` is non-zero but is applied EQUALLY by both paths (SafeScreen host vs headerWrap), so they match there too.
- **Severity:** RULED OUT (header-container theory). The residual "event hugs" Seth saw, if real on web, is NOT the header structure; remaining unexplored positive causes would need an authed capture (e.g. a brand/account banner above the header on trip only, or a native-only observation). Confidence: **proven negative / inconclusive positive** — capped because the authed pages can't be driven to capture the actual rendered offset.

### F-2 — Symptom 2: event ⋯ dead tap = brand-null mount gate (CONFIRMED ROOT CAUSE)
- **Symptom:** tapping ⋯ on `/event/{id}` does nothing; on `/trip/{id}` it opens the menu.
- **Layer:** code.
- **Probe:** trace ⋯ `onPress` → state → conditional mount; compare trip/experience; read `EventManageMenu` prop contract; blast-grep.
- **Evidence:**
  - `app/event/[id]/index.tsx:629` ⋯ `onPress={handleManageOpen}` → `:164` sets `manageMenuVisible=true`.
  - `app/event/[id]/index.tsx:841` — `{brand !== null && manageMenuVisible ? <EventManageMenu .../> : null}`. **`brand===null` → nothing mounts → dead tap (no sheet, no toast, no feedback).**
  - `src/components/event/EventManageMenu.tsx:46` — `brand: Brand;` **required, non-null** prop → the component cannot render without a brand → the call site gates on it.
  - `src/hooks/useManagedEventRoute.ts:57-63` — `brand = serverDetail?.brand ?? brands.find(...) ?? null`; for locally/trip-fallback-resolved events `brand` depends on `useBrandList()` containing the row; empty/wedged list (F-4) → `brand=null`.
  - Contrast: `app/trip/[id]/index.tsx:579` `<TripManageMenu visible=... >` mounted UNCONDITIONALLY (no brand prop); `app/experience/[id]/index.tsx:427` `<OfferingManageSheet visible=... >` also unconditional.
- **Mechanism:** event is the only detail surface whose ⋯ menu requires a non-null brand AND gates the mount on it; null brand → tap swallowed → Constitution #1 dead tap.
- **Severity:** CONFIRMED ROOT CAUSE. Confidence: **probable** (source-unambiguous; runtime tap-on-event capped by no-creds blocker).

### F-3 — Symptom 3: brand switcher offset up from Hub (PROBABLE root: scroll-anchored absoluteFill)
- **Symptom:** from Hub the switcher renders pushed up (only "Create a new brand" bottom edge peeks near the top, list clipped above viewport); from Home it renders correctly anchored below the topbar.
- **Layer:** code + RNW platform internals (runtime DOM measurement blocked).
- **Probe:** read TopSheet geometry FULL; both mount sites; the whole web containing-block chain (`(tabs)/_layout` → `DesktopCanvas` → route host → Slot); RNW `absoluteFill` resolved CSS; reconcile with the Hub screenshot.
- **Evidence:**
  - `src/components/ui/TopSheet.tsx:317` root `<View style={StyleSheet.absoluteFill}>`; `node_modules/react-native-web/.../StyleSheet/index.js:76-82` `absoluteFill = { position:'absolute', left:0, right:0, top:0, bottom:0 }`. So the sheet root is `position:absolute` filling its **nearest positioned ancestor** (every RNW `View` defaults `position:relative`).
  - `src/components/ui/TopSheet.tsx:334-341` anchor `<View style={[styles.anchor, { top: panelTop }]}>`; `:435-439` `anchor: { position:'absolute', left:0, right:0 }`; `:166` `panelTop = insets.top + TOPBAR_OFFSET(76)`. The panel is `position:absolute; top:76` **relative to the sheet root, which is relative to the page host**.
  - `src/components/ui/TopSheet.tsx:134` `screenHeight = Dimensions.get("window").height`; `:138` `useWindowDimensions()` used ONLY for `windowWidth` (blur kill); `:145` `fixedHeight = screenHeight*0.7`; `:167` `closedY = -panelHeight`. **Two different window-height sources in one component.**
  - **Home host (viewport-bound):** `app/(tabs)/home.tsx:416` `<View style={[styles.host {flex:1}, {paddingTop:insets.top}]}>`; the scrollable content is an inner `<FlatList style={styles.mobileUpcomingList}>` (`:836`) — internal scroll, host stays viewport height. `<BrandSwitcherSheet>` (`:863`) is a direct child of this viewport-bound host.
  - **Hub host (can overflow):** `app/(tabs)/hub/_layout.tsx:194` `<View style={[styles.host {flex:1}, {paddingTop:insets.top}]}>` stacking TopBar (`:195`) + To-Do toggle (`:212`) + HubSubNav (`:219`) + `<Slot/>` (`:233`) + `<LazyBrandSwitcherSheet>` (`:234`). The Slot sub-routes diverge: `events.tsx:579`/`trips.tsx:259` wrap content in a `flex:1` host (viewport-bound), but `experiences.tsx` returns a **bare `<ScrollView>` as the Slot root** (`:541,560`) AND for restaurant/play brands returns `<ExperienceGenerationSurface>` (`:515,528`) with no `flex:1` host wrapper — these paths are not guaranteed viewport-flex-bound, so the Hub host/document can grow taller than the viewport and scroll.
  - `app/(tabs)/_layout.tsx:133` host `flex:1`; `DesktopCanvas.tsx:115` on phone-width returns a Fragment passthrough (no extra View) — so on phone web the positioned-ancestor chain is `_layout host → route host`, all `position:relative`.
  - `app/+html.tsx:31` `<ScrollViewStyleReset/>` resets RNW ScrollView CSS but does NOT pin the route host to a non-scrolling viewport box.
  - **Screenshot reconciliation:** the Hub capture shows the panel shoved UP with only its bottom row ("Create a new brand") visible near the viewport top — exactly what `position:absolute; top:76` of a host whose top has scrolled ABOVE the viewport produces.
- **Mechanism (single best-supported):** the switcher's `absoluteFill` root anchors to the page host, not the viewport. Home's host is viewport-bound (no document scroll) → anchor = viewport top → panel correct at `top:76`. Hub stacks more chrome over a tall, non-viewport-bound `<Slot/>` → host/document scrolls → when scrolled at open, `absoluteFill top:0` is the scrolled host top, and `top:76` lands above the viewport → only the panel's bottom peeks. The `Dimensions.get('window')` vs `useWindowDimensions` mix is a SECONDARY contributor to a wrong `panelHeight`/`closedY` but does not by itself produce the "Hub-only offset up."
- **Severity:** CONFIRMED ROOT CAUSE (mechanism) / SECONDARY CONTRIBUTOR (the Dimensions mix). Confidence: **probable** — the source chain is decisive and matches the screenshot, but authed DOM measurement of the panel's computed `top`, the host's `scrollTop`, and the resolved containing block was blocked (no creds). To lift to "proven": login on the dev build, open the switcher from Hub after scrolling, measure `getBoundingClientRect().top` of the panel + `scrollTop` of its offset parent.

### F-4 — Symptom 4: brand switcher "Loading brands…" forever / vacant (CONFIRMED ROOT CAUSE)
- **Symptom:** after navigating, opening the switcher shows "Loading your brands…" and never resolves though brands loaded earlier.
- **Layer:** code (state machine) + runtime (predicate proven).
- **Probe:** trace switcher render → `useBrandListState` → `resolveBrandListStatus` → `useBrands`; run the verbatim predicate over navigation states.
- **Evidence:**
  - `src/components/brand/BrandSwitcherSheet.tsx:93-106` render branch: `brandList.isLoading ? <Loading "Loading your brands…"/> : status==="error" ? ... : <ScrollView>{brands.map(...)}</ScrollView>`. **`isLoading` checked BEFORE `brands` is rendered → any loading flag blanks the populated list.**
  - `src/hooks/useBrandListShim.ts:55` `isLoading: status === "auth_loading" || status === "query_loading"`.
  - `src/utils/brandListState.ts:34` `if (isLoading || isFetching || !isFetched) return "query_loading";` — **`isFetching` alone flips loading even when `itemCount>0`**, and `!isFetched` makes a disabled query loading "forever."
  - `src/hooks/useBrands.ts:58` `STALE_TIME_MS = 30_000`; `:136` `enabled = isAuthReady && accountId !== null`; `:191` queryKey → `DISABLED_KEY` when disabled.
  - **Verbatim predicate proof (transcribed from prior `rbls_probe.mjs`):**
    - populated `itemCount=3` + `isFetching=true` → `query_loading` → sheet Loading=TRUE (cached brands discarded). **FALSE LOADING.**
    - `enabled=false` (`isFetched=false`) → `query_loading` → Loading=TRUE permanently. **"FOREVER."**
    - GC'd remount (`isFetched=false`) → `query_loading` → Loading=TRUE.
    - steady `isFetched=true, isFetching=false, itemCount=3` → `ready` → Loading=FALSE.
  - **SAME bug on a 2nd surface:** `app/(tabs)/account.tsx:292-298` checks `status === "query_loading"` BEFORE `status === "ready"` (`:261`) → a populated-but-refetching list shows "Loading your brands…" and hides the cached brands there too.
  - `src/hooks/useBusinessTodos.ts:41` observes `useBrands` on Home AND Hub (keeps list warm); navigating to standalone `/event|/trip|/experience` drops the observer → on return the 30s-stale query background-refetches (`isFetching=true`) → false loading; if that refetch hangs OR the query is momentarily disabled (auth degraded / `accountId` null) → forever.
- **Mechanism:** the status machine conflates "background-refetching / disabled / not-yet-fetched" with "no data to show"; the consumers hide the cached list behind that loading flag.
- **Severity:** CONFIRMED ROOT CAUSE. Confidence: **probable** (mechanism deterministically proven; exact "forever" trigger — hung refetch vs disabled-window — needs authed runtime to pin, but BOTH wedge via the same line).
- **ORCH-1134 relation:** NOT a regression from `62bb9c864` (that consolidated brand-RECOVERY writer in `app/_layout.tsx`; did not touch `useBrands`/`resolveBrandListStatus`/the switcher). Bug predates it.

---

## Symptom-4 root-helper REGRESSION MAP (per-call-site verdict — implementor/tester gate)

**Proposed corrected behavior** (SPEC will bind exactly): `resolveBrandListStatus` must return `ready`/`empty` based on `itemCount` whenever the list has been fetched at least once and there is no auth/error/disabled blocker — i.e. **a background refetch (`isFetching` with `isFetched===true`) must NOT downgrade a populated list to `query_loading`.** `query_loading` stays only for the genuine FIRST load (`!isFetched` while enabled) and auth bootstrap. Consumers additionally must render cached `brands` if present even during a refetch (defense in depth), but the predicate change alone fixes both current bug surfaces.

**Two public hooks — only ONE observes the changing field:**
- `useBrandList(): Brand[]` returns ONLY `query.data ?? []` (`useBrandListShim.ts:61-64`). The `status`/`isLoading` it computes internally is DISCARDED. The proposed change does NOT alter the `brands` array (always `query.data ?? []` regardless of status). **⇒ every `useBrandList()` consumer is AUTOMATICALLY SAFE — it cannot observe the field that changes.**
- `useBrandListState(): BrandListState` exposes `status` + `isLoading` (`:38-59`). **Only these consumers can be affected.** There are exactly TWO in production.

| # | Call site | Hook | Reads status/isLoading? | Verdict |
|---|-----------|------|-------------------------|---------|
| 1 | `src/components/brand/BrandSwitcherSheet.tsx:41,93` | `useBrandListState` | YES (`isLoading` gates list render) | **TARGET — fix REQUIRED.** Corrected behavior shows cached brands while refetching. SAFE + intended. |
| 2 | `app/(tabs)/account.tsx:83,261-306` | `useBrandListState` | YES (`status` switch: ready/loading/error/empty) | **SAME BUG, same fix benefits it.** Corrected behavior: populated list shows under `ready` while refetching instead of "Loading…". SAFE + intended. Must be tested as a co-surface. |
| 3 | `app/account/delete.tsx:91` | `useBrandList` | NO (array only) | SAFE-AUTO. |
| 4 | `app/brand/[id]/edit.tsx:44` | `useBrandList` | NO (`.find(id)`) | SAFE-AUTO. |
| 5 | `app/brand/[id]/index.tsx` | `useBrandList` (via store re-export) | NO (`.find(id)`) | SAFE-AUTO. |
| 6 | `app/brand/[id]/payments/reports.tsx:28` | `useBrandList` | NO (`.find(id)`) | SAFE-AUTO. |
| 7 | `app/brand/[id]/team.tsx:89` | `useBrandList` | NO (`.find(id)`) | SAFE-AUTO. |
| 8 | `app/event/[id]/edit.tsx:137` | `useBrandList` | NO (`.find(id)`) | SAFE-AUTO. |
| 9 | `app/event/[id]/preview.tsx:77` | `useBrandList` | NO (`.find(id)`) | SAFE-AUTO. |
| 10 | `app/o/[orderId].tsx:169` | `useBrandList` | NO (`.find(id)`) | SAFE-AUTO. |
| 11 | `src/components/event/PublicEventPage.tsx:209` | `useBrandList` | NO (founder-role membership check on array) | SAFE-AUTO. **Note:** founder-role becomes *correct sooner* (no transient empty during refetch) — strictly an improvement; tester should confirm no flicker regression on the public page viewer-role banner. |
| 12 | `src/hooks/useCurrentBrandRole.ts:101` | `useBrandList` | NO (array → role) | SAFE-AUTO (same improvement note as #11). |
| 13 | `src/hooks/useManagedEventRoute.ts:34` | `useBrandList` | NO (array → `.find`) | SAFE-AUTO — and this is the F-2 link: a non-empty array sooner = fewer null-brand dead taps. Improvement. |
| 14 | `src/store/currentBrandStore.ts:226` | re-export of `useBrandList` | n/a (pass-through) | SAFE-AUTO. |
| 15 | `src/hooks/useCurrentBrand.ts` | (mirrors shim pattern; reads store) | NO | SAFE-AUTO. |
| 16 | `src/components/event/__tests__/PublicEventPage.closeButton...test.tsx` | mock | n/a (test mock) | No impact (mock). |
| 17 | `src/hooks/__tests__/brandListState.test.ts` | direct predicate tests | n/a (test) | **Must be UPDATED** — line 43-45 asserts `isFetched:false → "query_loading"` (keep), and a NEW assertion added: populated + `isFetching:true` + `isFetched:true` → `ready` (the fails-on-revert gate). |

**App-wide verdict: SAFE.** 15 of 17 sites use `useBrandList()` (array-only) and cannot observe the changed field. The 2 that observe it (`BrandSwitcherSheet`, `account.tsx`) BOTH currently carry the same false-loading bug and BOTH are improved by the fix. No surface is regressed; several are strictly improved (founder-role / managed-event null-brand resolve correctly sooner). **No risky surface.** The only mandatory care: the predicate change must keep genuine FIRST-load (`!isFetched`) and auth-bootstrap as loading so signed-out / cold-boot never flashes an empty "no brands" state.

---

## Cross-platform parity notes (shared RN/TS — verify on iOS + Android business app)

All four fixes touch code shared with the native business app. The web fix must not regress native.

| Fix | Shared file(s) | iOS/Android verification required |
|-----|----------------|-----------------------------------|
| **F-4 predicate** | `src/utils/brandListState.ts`, `useBrandListShim.ts` | On native business app: (a) open Account → brands list shows immediately on re-entry (no "Loading…" flash) while background-refetching; (b) open brand switcher from Home after backgrounding 30s+ → cached brands visible, not "Loading…"; (c) cold-boot signed-in → first load STILL shows "Loading…" until data arrives (no empty flash); (d) signed-out → "signed_out", never "empty". |
| **F-2 EventManageMenu gate** | `src/components/event/EventManageMenu.tsx`, `useManagedEventRoute.ts`, `app/event/[id]/index.tsx` | On native: tap ⋯ on a locally-resolved / trip-fallback event whose brand isn't yet in the list → menu MUST open (or show a clear loading/disabled affordance), never a silent dead tap. Confirm trip/experience ⋯ unchanged. Confirm `EventManageMenu`'s non-null `brand` contract is preserved or safely relaxed identically on both platforms. |
| **F-3 TopSheet geometry** | `src/components/ui/TopSheet.tsx` | TopSheet is shared by BrandSwitcherSheet + UniversalCreatorSheet (DEC-080/DEC-NEW-A — only 2 approved consumers). On native iOS+Android: open BOTH sheets from Home AND Hub; confirm anchor stays `insets.top+76` below the real topbar, open/close translate animation unchanged, swipe-up dismiss unchanged, `fixed-70` height unchanged, compact mode unchanged. Any switch from `Dimensions.get('window')` to `useWindowDimensions()` must preserve native height on rotation. |
| **F-1 (if any change)** | `src/components/ui/SafeScreen.tsx`, `app/event/[id]/index.tsx` | If event is converted to `SafeScreen` for convention parity: on native iOS+Android confirm the event header top inset is UNCHANGED (identical `insets.top` applied), the strict-grep `i-proposed-tr2-safearea-on-fullscreen-routes` gate still passes, and no double-inset (SafeScreen host + headerWrap both padding). NOTE: F-1 has no proven defect on web — any change here is convention-only, not a bug fix; recommend NOT shipping a behavioral change without an authed repro. |

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction |
|-------|-------|---------------|
| Docs | Memory: BrandSwitcherSheet via TopSheet `fixed-70`; SafeScreen mandated for non-tab routes | Event detail uses plain View + inline inset, not SafeScreen — deviates from convention but **web-immaterial (F-1 proven identical)** |
| Schema/Query | `useBrands` keyed `brands/list/{accountId}`, `enabled=isAuthReady && accountId`, 30s stale, 5min gc | — |
| Code | `resolveBrandListStatus` treats `isFetching`/`!isFetched` as loading; switcher + account gate render on it | **Contradiction:** populated cache exists but is hidden behind a transient/disabled loading flag (F-4, on TWO surfaces) |
| Runtime | `insets.top===0` on web (proven); RNW View default `position:relative` + `absoluteFill=position:absolute top:0 bottom:0` (proven); predicate transitions (proven) | event/trip headers both compute `paddingTop:0` → F-1 header theory disproven on web; `absoluteFill` anchors to scrollable host → F-3 mechanism |
| Data | brand list cached in React Query; no Zustand server-state copy | — |

---

## Repro evidence

- **Proven at runtime (web, no auth):** safe-area inset top = 0px on web; RNW View default `position:relative`; `absoluteFill` resolved CSS (`position:absolute;top:0;left:0;right:0;bottom:0`); `resolveBrandListStatus` false/forever-loading transitions (deterministic predicate). See `evidence/ORCH-1136/`.
- **Proven by source-value diff (this pass):** event vs trip header resolved boxes are identical on web (host/headerWrap/TopBar/SafeScreen) — F-1 negative is now value-level, not assertion-level.
- **NOT reproduced (named blocker):** the four symptoms on the actual authenticated event/trip/Hub/Home screens — blocked by lack of login credentials (STOP-and-ask). Caps F-2/F-4 at "probable", F-3 at "probable", F-1 positive at "inconclusive."

---

## Blast radius / cross-surface map

| Component | Consumers | In-scope? | Shared with native iOS/Android? |
|-----------|-----------|-----------|---------------------------------|
| `resolveBrandListStatus` / `useBrandListShim` (F-4) | 17 sites (2 observe status: BrandSwitcherSheet + account.tsx; 15 array-only) | central fix | **YES — pure TS shared all platforms.** Regression map above proves app-wide SAFE. |
| `EventManageMenu` + `useManagedEventRoute` (F-2) | event detail page (dead-tap surface); EventManageMenu also used by hub/events list, OfferingManageSheet | event detail | **YES — shared RN.** Gate/contract change touches native. |
| `TopSheet` (F-3) | BrandSwitcherSheet, UniversalCreatorSheet (DEC-080/NEW-A: 2 approved) | switcher positioning | **YES — shared.** Geometry change ripples to both consumers on all platforms. |
| `SafeScreen` (F-1) | 11 routes under `app/` | event header (convention only) | **YES — shared.** No proven defect; touch only for convention, with care. |

**In-scope:** Business Web (primary). **Blast-flagged:** Business iOS / Android (all fixes touch shared code). **Not touched:** Consumer app, Admin, Buyer-web.

---

## Invariant impact (flagged; NOT pre-decided)

- **I-37** (`TopBar` `leftKind="brand"` MUST NOT pass `rightSlot=`) — event/trip headers use `leftKind="back"` + `rightSlot=`; compliant. Any header rework (F-1) must preserve I-37.
- **I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES** — the strict-grep gate accepts event's `useSafeAreaInsets`+`paddingTop:insets.top` path; converting event to SafeScreen stays compliant. Don't break the gate.
- **DEC-080 / DEC-NEW-A/B** (TopSheet consumer carve-out) — any F-3 geometry change must stay within the 2 approved consumers and preserve `fixed-70` + `compact`.
- **Const #5** (server state in React Query, not Zustand) — F-4 fix MUST keep brand-list state in React Query; do not park it in Zustand to dodge the flicker.
- **NEW (SPEC may propose, DRAFT):** `I-PROPOSED-BRANDLIST-CACHED-OVER-REFETCH` — "a brand list that has been fetched at least once and is non-empty is NEVER hidden behind a background-refetch (`isFetching`) or disabled loading flag; `query_loading` is reserved for the genuine first load (`!isFetched`) and auth bootstrap." Enforced by the `resolveBrandListStatus` unit test asserting populated+`isFetching` → `ready`.

---

## Discoveries for orchestrator (ranked)

1. **[HIGH] `resolveBrandListStatus` false-loading is on TWO surfaces, not one (F-4).** Both `BrandSwitcherSheet` and `account.tsx` hide cached brands behind `isFetching`. Systemic root.
2. **[HIGH] Event ⋯ dead-tap on null brand (F-2).** Constitution #1; silent. Linked to F-4.
3. **[MED] `TopSheet` anchors via `absoluteFill` to a possibly-scrollable host (F-3).** The Hub mis-position; also a latent risk for UniversalCreatorSheet on any future scrollable host.
4. **[MED] `TopSheet` mixes `Dimensions.get('window').height` (snapshot semantics) with `useWindowDimensions()` (live) (F-3 secondary).** Single-source the window height.
5. **[LOW] Event detail diverges from the SafeScreen convention (F-1).** Web-immaterial (proven), maintenance/parity outlier only.
6. **[LOW] `useBrands` opens a fresh Realtime channel keyed on `Date.now()` per mount** — connection churn on rapid web navigation. Not a wedge.
7. **[LOW/ENV] Brackets in the per-ORCH worktree path break the web dev build** (expo-router require.context glob) — must clone bracket-free to run `expo start --web`. Worth a memory note.

---

## SPEC-readiness: recommended fix sequence + batching + regression sets

**Batch A (PRIMARY — proven, shared root, highest severity) — F-4 + F-2 together.**
They share the brand-list authority: fixing F-4 (stop hiding cached brands behind `isFetching`/disabled; reserve `query_loading` for genuine first load) removes the most common trigger of F-2's null-brand dead tap.
- **Fix F-4 first:** correct `resolveBrandListStatus` in `src/utils/brandListState.ts` (+ optional defense-in-depth: render cached `brands` even during refetch in `BrandSwitcherSheet.tsx` and `account.tsx`).
- **Then F-2:** make the event ⋯ open robustly when `brand` is momentarily null (e.g. mount the menu and show a brief loading/disabled affordance, or relax the contract) — never a silent dead tap.
- **Regression set A:**
  1. `brandListState.test.ts` — ADD: populated (`itemCount=3`) + `isFetching:true` + `isFetched:true` → `ready` (was `query_loading`). **Must FAIL on revert.** KEEP: `!isFetched → query_loading`, bootstrap → `auth_loading`, `itemCount:0 → empty`, signed-out → `signed_out`.
  2. New test/assert: `account.tsx` + `BrandSwitcherSheet.tsx` render the brands list when `status==='ready'` even with `isFetching` true (component test or source-grep that the cached-list branch precedes the loading branch).
  3. New test: event ⋯ tap with `brand===null` mounts a menu/affordance (no dead tap) — fails on revert to the `brand !== null &&` gate.
  4. Cross-platform manual gate per the parity table (iOS+Android: cached-list-while-refetching, cold-boot still loads, signed-out never empty; event ⋯ never dead).

**Batch B (SECONDARY — F-3) after an authed runtime confirm.**
F-3 is layout-independent of A. Root is **probable** (scroll-anchored `absoluteFill`) — recommend a 10-min authed dev-build confirm (measure panel `getBoundingClientRect().top` + host `scrollTop` from Hub vs Home) BEFORE SPEC'ing the exact fix, so the fix targets the proven mechanism (e.g. anchor the sheet to a portal/fixed viewport box on web, or pin the route host non-scrolling, or single-source window height) rather than guessing.
- **Regression set B:** TopSheet opens correctly anchored from BOTH Home and Hub (web + native), at any page scroll offset; `fixed-70` height correct on resize/rotate; UniversalCreatorSheet unaffected; both DEC-approved consumers verified.

**Batch C (OPTIONAL — F-1) convention-only, do NOT ship a behavioral change without an authed repro.**
F-1 has NO proven web defect (headers identical). If Seth still sees a hug, capture authed event-vs-trip side-by-side first. A convention cleanup (event → SafeScreen) is safe but fixes no proven bug; gate on the strict-grep + no double-inset.

**Recommended order:** Batch A → (authed confirm) → Batch B → (optional, authed repro) → Batch C. Every batch carries the cross-platform (iOS/Android) parity gate because all touched code is shared.

**Next phase:** SPEC the Batch A fix (F-4 + F-2; root proven). For Batch B, either an authed runtime-confirm dispatch or Seth-driven capture, THEN SPEC. Batch C only if an authed repro materializes.
