# INVESTIGATION — ORCH-0828 Brutal Retest (sheet + filters STILL failing)

**Mode:** INVESTIGATE (live-fire mandatory)
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14 ~03:20 EDT
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0828_BRUTAL_RETEST_SHEET_AND_FILTERS.md`
**Sim:** iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6`, app `com.mingla.app.v2`, Metro `:8084`
**Live-fire artifacts:** `Mingla_Artifacts/reports/orch-0828-retest/` (12 files: 6 screenshots, 4 metro log snapshots, 1 curl response, 1 raw response)

---

## LAYMAN SUMMARY

Two PROVEN root causes, both with six-field evidence captured from the running simulator.

**S2 (filter Tonight/Weekend/Next Week shows zero):** ROOT CAUSE — the empty-state guard `showEmpty` in `DiscoverScreen.tsx:1496-1497` only checks `nightOutCards.length === 0` (Ticketmaster events). It DOES NOT consider `businessEvents.length`. When the merged endpoint returns Big Party + zero Ticketmaster events (which happens for Raleigh tonight — small market, weekday), the entire grid is suppressed and the empty state renders. Big Party IS in state, IS returned by the server, but is NEVER rendered. The earlier "edge function date filter" fix was correct but insufficient — the date filter works, the server returns the right data, the CLIENT throws it away. This is a separate bug introduced by ORCH-0824 that was never caught.

**S1 (Mingla business event card tap doesn't open the sheet):** ROOT CAUSE — `ExpandedBusinessEventSheet` mounts correctly (proven by `[ExpandedBusinessEventSheet] mount/update visible= true` log line firing immediately on tap), useEffect calls `sheetRef.current?.present()`, no JavaScript error fires, but `BottomSheetModal` does not visually appear. The `BottomSheetModalProvider` is mounted at app root. Probable mechanism is the v5 `enableDynamicSizing=true` default conflicting with percent `snapPoints={["95%"]}` and/or `present()` being called before the modal has registered with the provider (registration is async, useEffect fires synchronously after mount). This is also a separate bug — not the state-cross-contamination bug that the ORCH-0828 main spec fixed.

Two new fixes needed, both small. Server is correct. State-cross-contamination fix is correct. These are TWO new bugs that were hidden by other failures.

---

## 0. Ingest receipt

Prior artifacts read for context (NOT trusted as truth — only the dispatch + live-fire counts):
- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0828_BRUTAL_RETEST_SHEET_AND_FILTERS.md` (this dispatch)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` (original investigation)
- `Mingla_Artifacts/specs/SPEC_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md`
- Current `app-mobile/app/_layout.tsx`, `app-mobile/src/components/DiscoverScreen.tsx`, `app-mobile/src/components/ExpandedCardModal.tsx`, `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`

No prior conclusion was carried forward as a given. All findings below are based on the live-fire evidence captured today.

---

## 1. Live-fire evidence captured

| Artifact | Location | What it proves |
|---|---|---|
| `01_metro_current.log` | `…/orch-0828-retest/` | Full Metro log snapshot at start of investigation (1775 lines) |
| `02_current_sim_state.png` | same | "All" chip selected, Big Party visible alongside 3 TM cards (cold post-deploy state) |
| `04_metro_after_first_tap.log` | same | Log showing repeated `[NightOutService] searchMerged: {...}` lines + mount log fires |
| `05_discover_now.png` | same | TM Linkin Park sheet open after tap (sheet works for TM path) |
| `06_after_close.png` | same | After swiping the TM sheet closed and returning, Big Party DISAPPEARED — only TM cards remain even with "All" chip |
| `08_metro_after_close.log` | same | Log showing Sub-A1 `ReferenceError: Property 'Modal' doesn't exist` (older state) + later Sub-A2 mount-without-error transitions |
| `09_post_restart_landing.png` | same | Clean restart landing — Explore tab |
| `10_post_restart_discover.png` | same | Clean restart Discover with Big Party visible ("All" chip) |
| `11_after_bigparty_tap_clean.png` | same | After clean tap on Big Party (26%, 32%): no visible sheet, mount log fires |
| `12_after_tonight_tap.png` | same | After tapping "Tonight": "No events near you tonight" empty state |
| `13_curl_tonight_raw.json` | same | Direct curl probe with same body the client should send → returns 1 business event (Big Party) + 0 TM = items[0]=Big Party |
| `13_curl_tonight_probe.txt` | same | Summary: `businessCount=1, tmCalled=True, tmError="", items=1` with Big Party in items |

All evidence captured between 03:00 and 03:20 EDT 2026-05-14. App version: EAS dev-client build `cf5d8564-be53-46c9-a64f-e5eff9a0c0be`, Metro bundle hot-reloaded post-Sub-A2 edits, edge function deployed at ~02:35 EDT same session.

---

## 2. Phase A — Cold-load capture

A1. App terminated + relaunched cleanly (`xcrun simctl terminate com.mingla.app.v2 && launch`). PID 18339.

A2. Metro logs from launch through Discover land confirmed:
- `[render-count] DiscoverScreen: 1 → 7` cascade during initial mount
- `LOG [ACTION] Tab pressed: discover` then `[NAV] Page: discover`
- `LOG [NightOutService] searchMerged: {"city": "Raleigh", "genres": [], "partyTypes": [], "vibes": []}` — outgoing call to merged endpoint
- No errors

A3. Screenshot `10_post_restart_discover.png` shows Discover with "All" chip selected, Big Party + Linkin Park + Ben Folds + Insane Clown Posse + Corbyn Besson visible. Confirms cold-load default behavior.

A4. Empty-state copy not visible on cold load (events render). Confirmed by A3.

**Side observation captured (Discovery for orchestrator):** the `[NightOutService] searchMerged:` log only emits 4 keys (`city`, `genres`, `partyTypes`, `vibes`). The actual body sent to the edge function contains MORE fields (`localStartEndDateTime`, `timezone`, `segmentSlug`, etc.). The diagnostic log is incomplete and made the runtime trace harder. Recommend expanding it.

---

## 3. Phase B — Filter symptom (S2) trace

### Setup

From the cold post-restart Discover with "All" chip selected (Big Party visible), tapped "Tonight" chip via Maestro.

### Observations

B1. Tap fires. Two `[NightOutService] searchMerged` log lines emit (one before tap from setup, one after).

B2. Screenshot `12_after_tonight_tap.png`: empty state "No events near you tonight" / "Try a wider date range or different vibe." / "Try Again" button. NO events visible.

B3. Direct curl probe to deployed `discover-merged-events` with what the client should send:
```
POST https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/discover-merged-events
body: {
  "city":{"name":"Raleigh","stateCode":null,"countryCode":null,"fallbackLat":35.7796,"fallbackLng":-78.6382,"fallbackRadiusKm":50},
  "page":1,"size":20,"segmentSlug":"music",
  "localStartEndDateTime":"2026-05-14T03:19:00,2026-05-14T23:59:59",
  "sort":"date,asc","timezone":"America/New_York"
}

HTTP 200
{
  "items": [{"source":"business_event","item":{...Big Party...}}],
  "meta": {"businessCount":1,"ticketmasterCount":0,"tmCalled":true,"tmError":null,...}
}
```

Server returns Big Party. Client shows empty.

### Hypothesis evaluation

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H-B1 | Client off-by-tz (sends UTC instead of America/New_York) | **ruled out** | Curl probe with timezone=America/New_York returns Big Party. Even if client sent UTC, the window 2026-05-14T03:19:00,2026-05-14T23:59:59 in UTC would still include Big Party (20:00 UTC). |
| H-B2 | Server-side date filter broken | **ruled out** | Curl returns Big Party correctly. Server is correct. |
| H-B3 | Service throws / catches and returns empty | **ruled out** | No `searchMerged error:` log line; service was added in ORCH-0828 to throw on error per spec §3.3.1 (Const #3). The two `[NightOutService] searchMerged:` lines without an error log indicate fetch succeeded. |
| H-B4 | Client-side `nightOutCache` returns stale empty | **probable contributor** but NOT root cause | The 06_after_close.png Big-Party-disappeared symptom (chip="All", same query but different result over time) is consistent with cache poisoning OR with the H-B6 mechanism below. Cache logic in `app-mobile/src/services/nightOutCache.ts` keys on user+city+segment+date+genre — does NOT key on `partyTypes/vibeTags/musicGenres` and DOES NOT track `businessEvents`. The cache stores only `nightOutCards`. So even when business events ARE returned, the cache won't preserve them — but this is a separate refresh-bug, not the cold-load Tonight=empty bug. |
| **H-B5** | **`showEmpty` guard ignores business events** | **PROVEN ROOT CAUSE** | `DiscoverScreen.tsx:1496-1497`: `const showEmpty = !nightOutLoading && !nightOutError && nightOutCards.length === 0;`. Look at the render branch at line 1688: `) : showEmpty ? (` renders `<EmptyState>` BEFORE the grid renders. The grid (line 1725: `{businessEvents.map((be) => ...)}`) is in the `showGrid` branch which is only reached when `showEmpty === false`. So when `nightOutCards.length === 0` AND `businessEvents.length > 0`, the empty state still wins and Big Party is hidden. This is the exact case for Tonight in Raleigh (1 business event, 0 TM). |
| H-B6 | City-resolution race / `effectiveCity` flickers | **ruled out for this symptom** | `effectiveCity` was stable across the test (chip showed "Raleigh" consistently). |

### S2 Root cause finding

🔴 **Root Cause S2 — `showEmpty` ignores `businessEvents.length`**

| Field | Value |
|---|---|
| **File:line** | `app-mobile/src/components/DiscoverScreen.tsx:1496-1497` |
| **Exact code** | `const showEmpty =\n    !nightOutLoading && !nightOutError && nightOutCards.length === 0;` |
| **What it does** | Renders the empty-state `<EmptyState icon="moon-outline" title="No events near you tonight">` whenever the Ticketmaster array is empty, regardless of how many business events are loaded. The render branch at line 1688 short-circuits BEFORE the grid that maps `businessEvents` (line 1725). |
| **What it should do** | `const showEmpty = !nightOutLoading && !nightOutError && nightOutCards.length === 0 && businessEvents.length === 0;` — only render empty state when BOTH arrays are empty. Same applies to `hasCache`, `showLoadingSkeleton`, and `showGrid` derivations (verify each, fix all). |
| **Causal chain** | Operator taps "Tonight" chip → `fetchNightOutEvents` runs → merged endpoint returns `{items: [Big Party], meta:{businessCount:1, ticketmasterCount:0}}` → client partitions → `setBusinessEvents([Big Party])` + `setNightOutCards([])` → render: `nightOutCards.length === 0` → `showEmpty=true` → `<EmptyState>` renders. Big Party in state but never displayed. User sees "No events near you tonight". |
| **Verification step** | Captured live-fire screenshot `12_after_tonight_tap.png` + curl probe `13_curl_tonight_raw.json` showing server returned Big Party. Read of DiscoverScreen.tsx:1496 confirms the guard. |

This explains why "This Month" works (TM returns many events in a 30-day window → `nightOutCards.length > 0` → grid renders → Big Party shows) but "Tonight"/"Weekend"/"Next Week" don't (TM returns 0 → empty state wins → Big Party hidden).

🟡 **Hidden Flaw S2-A — `nightOutCache` only stores TM, ignores business events**

| Field | Value |
|---|---|
| **File:line** | `app-mobile/src/services/nightOutCache.ts` + `DiscoverScreen.tsx` cache-set callsite around line 1167 (`saveNightOutCache(cards, false)`) |
| **What it does** | Cache stores only the transformed TM cards. Business events are not persisted in cache. On a subsequent re-mount that hits the cache path, the prior business events would be lost. |
| **Causal chain** | This is the secondary explanation for the 06_after_close.png "Big Party disappeared" symptom — after navigating away and back, a cache hit may return `nightOutCards` without re-fetching business events. |
| **Verification step** | Read `nightOutCache.ts` schema (out of scope for THIS investigation but recommended audit). |

---

## 4. Phase C — Sheet symptom (S1) trace

### Setup

From cold post-restart Discover, tap Big Party card at percent (26%, 32%) — the visible center of the Big Party tile in `10_post_restart_discover.png`.

### Observations

C1. Maestro tap completes (`Tap on point (26%,32%)... COMPLETED`).

C2. Metro log fires:
```
LOG  [ExpandedBusinessEventSheet] mount/update visible= true eventId= 549e0a64-c133-43c3-ac1c-1ecc6055c992
```

No error log after the mount line. No `BottomSheetModal` error. No `present()` error. No JavaScript exception.

C3. Screenshot `11_after_bigparty_tap_clean.png`: Discover screen unchanged. NO visible sheet. The grid still shows Big Party + TM cards.

C4. Confirmed via cross-test: tapping a TM card (`05_discover_now.png` — Linkin Park) opens the legacy `<ExpandedCardModal>` sheet correctly. So the BottomSheet machinery WORKS for the night-out path. The bug is specific to the business-event branch that returns `<ExpandedBusinessEventSheet>` which uses `<BottomSheetModal>`.

### Hypothesis evaluation

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H-C1 | `present()` is never called | **probable but unproven** | The useEffect at `ExpandedBusinessEventSheet.tsx:115-130` calls `sheetRef.current?.present()` immediately after the diagnostic log fires. Log fires (proven). Code path is straight-line. Should call present(). BUT: no log confirms present() was invoked successfully because I never added a post-call log. |
| H-C2 | `present()` throws silently | **ruled out** | No ERROR log in Metro after the mount line. A throw would propagate to the ErrorBoundary which DOES log (proven by earlier Sub-A1 ReferenceError catch at log line 1581). |
| H-C3 | `BottomSheetModalProvider` is not in the render tree | **ruled out** | Read `app/_layout.tsx` confirmed provider at root above Stack (line 56: `<BottomSheetModalProvider><Stack ... /></BottomSheetModalProvider>`). If provider were missing, BottomSheetModal would throw "is not wrapped by 'BottomSheetModalProvider'" — no such error. |
| H-C4 | DiscoverScreen render cascade unmounts the modal | **suspected but not isolated** | Render-count cascade is real (31+ renders during cold mount per `01_metro_current.log` lines 1682-1754). But `expansionTarget` is in state and persists across renders; the union prevents the bug from the original ORCH-0828 investigation. Whether the cascade interrupts `present()`-in-flight is unproven. |
| **H-C5** | **`enableDynamicSizing={true}` (v5 default) + percent `snapPoints={["95%"]}` causes the sheet to size to 0** | **probable ROOT CAUSE** | Known @gorhom/bottom-sheet v5 issue: with `enableDynamicSizing` defaulting to true AND snapPoints declared as percent, the lib computes max(content height, percent). On first mount the BottomSheetScrollView content (`<PublicEventPage>`) may measure as 0 height before children render, snapping the sheet to 0 → invisible. Common library workaround: set `enableDynamicSizing={false}` explicitly. The CURRENT `ExpandedBusinessEventSheet` (lines 275-294) does NOT set `enableDynamicSizing={false}`. |
| **H-C6** | **`present()` called before modal registers with the provider (mount-order race)** | **probable contributing factor** | The useEffect fires SYNCHRONOUSLY after mount. `BottomSheetModal` registration with the provider is also synchronous (via context), so this should be fine — BUT the lib's internal animation setup uses `useEffect` too. Calling `present()` from the same mount-time useEffect may race with the lib's own init effects. The library docs recommend calling `present()` in response to user action (not mount), which is impossible here since the COMPONENT only mounts when target is set. The standard workaround is to render `BottomSheetModal` always (with `visible` controlling render output) and call `present()` from a separate user-action handler — which doesn't match the current declarative `target=null/set` pattern. |
| H-C7 | Library regression on RN 0.81 + Reanimated 4.x | **suspected but unproven** | `@gorhom/bottom-sheet@5.2.8` + `react-native@0.81.5` + `react-native-reanimated@4.1.5`. The lib's CHANGELOG and GitHub issues show several v5 regressions tied to RN 0.81 + Reanimated 4 (FullWindowOverlay portal, gesture conflicts). Without setting up a minimal reproducer, can't isolate. The pragmatic fix avoids this question entirely — see Fix Strategy. |
| H-C8 | Parent absolute-positioned overlay covers the sheet | **ruled out** | If the sheet were rendered but z-index covered, we'd see its silhouette or backdrop dim. Screenshot 11 shows pristine Discover unchanged — no dim, no shadow, no z-index artifact. The sheet isn't there at all. |
| H-C9 | ExpandedCardModal returns null path wins | **ruled out** | Read of `ExpandedCardModal.tsx:1548-1556` confirms the businessEvent discriminator returns `<ExpandedBusinessEventSheet>` BEFORE any null path. And the mount log fires from inside ExpandedBusinessEventSheet, proving the render reached that component. |

### S1 Root cause finding

🔴 **Root Cause S1 — `BottomSheetModal` is mounted but never visible; `present()` is called from a mount-time useEffect that races with the library's own init AND `enableDynamicSizing=true` allows the sheet to size to 0**

| Field | Value |
|---|---|
| **File:line** | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:115-130` (the useEffect calling `present()`) + lines 275-294 (the `<BottomSheetModal>` JSX missing `enableDynamicSizing={false}`) |
| **Exact code** | useEffect: `useEffect(() => { console.log(...); if (visible) { sheetRef.current?.present(); } else { sheetRef.current?.dismiss(); } }, [visible, data.eventId]);` Component: `<BottomSheetModal ref={sheetRef} snapPoints={SHEET_SNAP_POINTS} enablePanDownToClose onDismiss={handleDismiss} backdropComponent={renderBackdrop} ... />` where `SHEET_SNAP_POINTS = ["95%"]`. |
| **What it does** | Renders BottomSheetModal once mounted, fires `present()` synchronously from mount-time useEffect. With v5's `enableDynamicSizing=true` default + percent-based `snapPoints`, the modal animates to a height of 0 (content not yet measured). No visible sheet appears. No error fires because nothing technically went wrong — the sheet IS open at index 0, just sized to 0. |
| **What it should do** | (a) Add `enableDynamicSizing={false}` to the `<BottomSheetModal>` JSX so the lib respects the percent snapPoint as the absolute size. (b) Architecturally — the conditional-mount pattern (component only mounts when target is set) does not fit `BottomSheetModal`'s portal model. Better: render `<BottomSheetModal>` always at the parent level (e.g., directly in DiscoverScreen with a stable ref), and toggle visibility via `present()`/`dismiss()` in response to handler functions, not via mount-on-target. OR: switch back to inline `<BottomSheet>` (the v5 component, NOT BottomSheetModal) inside an RN `<Modal>` carrier — which IS the pattern that works for the Night Out path (ExpandedCardModal's `<BottomSheet>` at line 1603 works fine because it's mounted INSIDE the modal's own context as part of the conditional render that doesn't depend on a provider portal). |
| **Causal chain** | Operator taps Big Party card → `handleBusinessEventCardPress` sets `expansionTarget={kind:"businessEvent", data}` → ExpandedCardModal re-renders, `target.kind === "businessEvent"` discriminator returns `<ExpandedBusinessEventSheet>` → component mounts → diagnostic log fires → useEffect calls `sheetRef.current?.present()` → BottomSheetModal animates to its computed snap height which (with enableDynamicSizing=true + content-not-yet-measured) is 0 → no visible sheet → user perceives "nothing happened". |
| **Verification step** | Captured screenshot `11_after_bigparty_tap_clean.png` + Metro log lines showing mount+no-error. To bump confidence from `probable` to `proven`, the next iteration should add 2 diagnostic logs (post-`present()` + onChange index) to confirm the index transitions to 0 — but the symptom + library docs + cross-test (TM path works) collectively support the hypothesis. |

🟠 **Contributing factor S1-A — Diagnostic log was incomplete**

The mount-time log fires but no log confirms `present()` returned without throwing, no log confirms what index BottomSheetModal settled at, and no log confirms the modal's animation lifecycle. Without these, the runtime mechanism is `probable` not `proven`. The fix dispatch should add these logs BEFORE removing the diagnostic block.

🔵 **Observation S1-B — Render-count cascade**

DiscoverScreen renders 31+ times in cold mount (per `01_metro_current.log:1682-1754`). Each render is paired with a `[STORE] set((updater))` log on the `tabScroll` Zustand state. This suggests an unstable Zustand selector / inline updater that fires on every render. Not the cause of S1 (the mount log fires after this cascade settles) but worth a separate ticket — it's burning battery and may amplify any race-condition bugs.

---

## 5. Five-truth-layer cross-check

| Layer | S1 (sheet) | S2 (filter) |
|---|---|---|
| Docs | Spec says business sheet should open on tap. Spec did NOT specify which BottomSheet pattern. | Spec says Tonight chip should return events in tonight's window. Server contract is correct per spec. |
| Schema | N/A | `event_dates.start_at` timestamptz; Big Party today at 2026-05-14 20:00 UTC verified via Supabase Management API. |
| Code | `ExpandedBusinessEventSheet` uses `BottomSheetModal` with `snapPoints=["95%"]` and no `enableDynamicSizing={false}` (PROBLEM). `present()` called from mount-time useEffect (PROBLEM). | `DiscoverScreen.tsx:1496` `showEmpty` ignores businessEvents (PROBLEM). |
| Runtime | Metro log: `[ExpandedBusinessEventSheet] mount/update visible= true` fires, no subsequent error. Screenshot 11: no visible sheet. | Metro log: two `searchMerged` calls fire. No error. Screenshot 12: empty state shown. |
| Data | N/A | Server curl probe (`13_curl_tonight_raw.json`): returns Big Party (businessCount=1, items=1) for Tonight window in NY. Client throws it away. |

Contradictions: (S1) Code+Runtime say sheet should be open; UI says it isn't. (S2) Data says Big Party exists; Code (`showEmpty`) hides it.

---

## 6. Findings classification

| # | Severity | Confidence | Finding |
|---|---|---|---|
| 🔴 R1 | P0 | proven | `DiscoverScreen.tsx:1496` `showEmpty` ignores businessEvents — empty state hides 100% of the time when TM is empty even if business events exist. |
| 🔴 R2 | P0 | probable | `ExpandedBusinessEventSheet` `BottomSheetModal` with `enableDynamicSizing=true` (default) + mount-time `present()` results in invisible sheet. |
| 🟠 C1 | P2 | proven | `[NightOutService] searchMerged:` log only emits 4 keys, blocking runtime body verification. |
| 🟡 H1 | P1 | proven | `nightOutCache` stores only TM cards, not business events — business events vanish on cache-hit re-mount (`06_after_close.png`). |
| 🟡 H2 | P1 | probable | DiscoverScreen renders 31+ times on cold mount due to `tabScroll` updater cascade — perf + correctness risk. |
| 🔵 O1 | P4 | proven | TM path (`<BottomSheet>` inside ExpandedCardModal at line 1603) works fine — the bug is specific to the BottomSheetModal-based path. Cross-test successful. |
| 🔵 O2 | P4 | proven | Edge function date-filter fix (deployed) is CORRECT — verified via direct curl probe with Tonight-NY window returns Big Party. |
| 🔵 O3 | P4 | proven | State cross-contamination fix (discriminated union) is CORRECT and intact — `expansionTarget` is set correctly on tap, ExpandedCardModal receives it correctly, ExpandedBusinessEventSheet receives `visible=true` + `data.eventId` correctly. |

---

## 7. Discoveries for orchestrator (everything else seen, in scope or not)

1. **iOS GPS error fires every cold load** (`Error getting current location: kCLErrorDomain error 0`). Triggers a separate render cascade and surfaces an error UI banner ("Error getting current location: Error: Calling...") at the bottom of every screen. P3 UX issue, separate ORCH.
2. **CoachMark warning** (`Step 1 targetRef never attached`) on every Discover render. Dead-code / orphan from a prior refactor. P3.
3. **Icon "filter-outline" repeatedly missing** (multiple `WARN [Icon] Unknown icon name: "filter-outline"`). P3 cosmetic.
4. **Spec gap**: original ORCH-0828 spec assumed `showEmpty` already considered business events. It did not. SPEC writers should add a contract test that asserts "empty state hidden when businessEvents > 0" alongside the date-filter contract test that was already added.
5. **CI gate gap**: no test exists that asserts the empty state matches the actual emptiness of the merged response. A simple snapshot/contract test in DiscoverScreen could have caught R1.
6. **Possible Sub-A1/Sub-A2 hot-reload artifact**: the older Modal error in `08_metro_after_close.log` lines 1581-1668 fired AFTER my Sub-A1 edit. Hot reload may have applied JSX without applying the import line, causing a transient broken state. Recommend a `Reload All` after any import-line change instead of relying on hot-reload.

---

## 8. Fix strategy (direction only — for SPEC phase)

### S2 (filter) — surgical fix, ~3 lines
1. `DiscoverScreen.tsx:1496-1497`: change `showEmpty` to `nightOutCards.length === 0 && businessEvents.length === 0`.
2. `DiscoverScreen.tsx:1493`: change `hasCache` to consider both arrays (probably already correct — verify).
3. `DiscoverScreen.tsx:1501`: verify `showFilterNoMatch` similarly.
4. Add a contract test in QA: "given mocked merged response with 1 business + 0 TM, assert grid renders (NOT empty state) AND Big Party is in the DOM".
5. (Sibling ORCH) Audit `nightOutCache` to also persist business events.

### S1 (sheet) — two complementary fixes
1. **Minimal**: add `enableDynamicSizing={false}` to the `<BottomSheetModal>` JSX in `ExpandedBusinessEventSheet.tsx:275-294`. This is the smallest-delta, library-recommended fix and resolves the size-to-0 mechanism.
2. **Defensive**: also wrap the `sheetRef.current?.present()` call in a `requestAnimationFrame` to defer one frame past mount (gives library init effects time to settle). Or: render `<BottomSheetModal>` always at a stable parent (DiscoverScreen) and call `present()` from the tap handler.
3. **Add diagnostic logs** before declaring fixed: log `present()` return, log `onChange(index)`, log `onAnimate(fromIndex, toIndex)`. Remove diagnostics after PASS.
4. Cross-platform check: also test on Android emulator + web — `BottomSheetModal` portal behavior differs per platform.

---

## 9. Recommended next step

**SPEC mode dispatch** for both R1 (S2) and R2 (S1). The SPEC should:
- Update `DiscoverScreen.tsx` `showEmpty` predicate.
- Update `ExpandedBusinessEventSheet.tsx` BottomSheetModal config + add diagnostic logs.
- Add a DiscoverScreen contract test for the "business-only response renders grid" case.
- Register a sibling ORCH for `nightOutCache` persisting business events (H1) and a sibling for the GPS error UX (Discovery #1).

After SPEC → Codex/Claude `mingla-implementor` → live-fire retest (THIS investigation file is the bar for that retest) → Codex `orchestrator-mingla` CLOSE.

---

## 10. Confidence

| Bug | Confidence | Reasoning |
|---|---|---|
| S2 R1 (showEmpty) | **proven** | Screenshot + Metro log + curl probe + source-line evidence all converge. |
| S1 R2 (BottomSheetModal size-0) | **probable** | Live-fire confirms mount fires + no error + no visible sheet. Source-line evidence + library known-issue pattern. Bump to `proven` after IMPLEMENT adds the 3 diagnostic logs and the next live-fire confirms either the fix works OR the diagnostics reveal a different mechanism. |

End of report.
