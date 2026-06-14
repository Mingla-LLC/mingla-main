# IMPLEMENTATION — ORCH-1136 [business-web shell bugs]

**Phase:** IMPLEMENT (mingla-implementor). **Built exactly the binding SPEC; no scope widening.**
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs]/` on branch `ORCH-1136-biz-web-shell-bugs` (rebased on origin/main `f68495ca6`).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1136_BIZ_WEB_SHELL_BUGS.md`. **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1136_BIZ_WEB_SHELL_BUGS.md`.
**Commits:** Batch A `d1a1378bf` · Batch B `ee4c539cf` · Batch C + gates `dc81a6c39`.

---

## 1. Summary

Four business-app shell bugs fixed in three web-gated batches, all in shared RN/TS so native iOS+Android are unchanged by construction:

- **Batch A (proven):** the brand-list status machine no longer downgrades an already-fetched, non-empty brand list to "Loading…" during a background refetch — the brand switcher and Account brands list now render cached brands instead of wedging on "Loading your brands…". The event `⋯` menu no longer silently dead-taps when the brand is momentarily null: it shows a "Loading brand… tap again in a moment." toast (Const #1), while preserving the ORCH-0862 unmount-on-close mount gate.
- **Batch B (probable → mechanism-proven on web):** the `TopSheet` overlay anchors to the browser viewport (`position:'fixed'`) on web only, so a scrolled Hub host can't offset the brand switcher. Native keeps `StyleSheet.absoluteFill`.
- **Batch C (web-only polish):** an additive `spacing.sm` (8px) web-only top padding on the event/trip/experience detail headers + Home/Hub top bars so the chrome isn't glued to the browser viewport top. Native insets byte-identical (`+0`).

Two new strict-grep gates (Batch B + C) added and registered in CI; both proven fails-on-revert. Batch A's predicate gains a fails-on-revert unit assertion.

---

## 2. SPEC success-criteria coverage

| SC | Status | Evidence / commit |
|----|--------|-------------------|
| **SC-A1** (predicate: fetched+refetching → ready/empty; first-load/auth/disabled/signed-out preserved) | ✓ VERIFIED | unit test `brandListState.test.ts` all 4 predicate tests green; new "does not downgrade…" test asserts `{isFetching:true,isFetched:true,itemCount:3}→ready`, `itemCount:0→empty`, `isFetched:false→query_loading`. `d1a1378bf` |
| **SC-A2-Web** (switcher shows cached rows while refetching) | ✓ IMPLEMENTED, partially verified | A.1 predicate + A.2 reorder built; web bundle compiles. Authed runtime nav-and-reopen needs login (no creds) → handed to tester. `d1a1378bf` |
| **SC-A3-Web** (Account shows cached rows after idle refetch) | ✓ IMPLEMENTED, partially verified | A.1 + A.3 `status==='ready' || brands.length>0`. Authed runtime → tester. `d1a1378bf` |
| **SC-A4-Web** (event `⋯`: opens w/ brand, loading toast when null, never dead tap) | ✓ IMPLEMENTED, partially verified | A.4 `handleManageOpen` shows toast on null brand; line-841 mount unchanged. Authed runtime → tester. `d1a1378bf` |
| **SC-A5-iOS / SC-A6-Android** (native parity) | ⚠ UNVERIFIED — native device run | Shared pure-TS predicate + handler; native build untouched by construction. Human-in-the-loop device run required. |
| **SC-B1-Web** (Hub switcher anchored at ~76px == Home, scroll-independent) | ✓ MECHANISM-PROVEN on web | Deterministic Playwright CSS harness reproducing the exact F-3 scenario: bare `absolute` → top 76px unscrolled / **−524px** scrolled-600 (the bug); `position:fixed` → **76px at both** (fix). Web bundle confirmed to emit `rootOverlayStyle` + `position:"fixed"`. FULL authed end-to-end Hub measurement blocked by no-creds (SPEC §10) → tester. `ee4c539cf` |
| **SC-B2-Web** (both TopSheet consumers from scrolled+unscrolled) | ✓ MECHANISM-PROVEN, partially verified | Fix is in the shared `TopSheet` root, so both consumers (`fixed-70` + `compact`) inherit the viewport anchor; harness proves the anchor math. Per-consumer authed runtime → tester. `ee4c539cf` |
| **SC-B3-iOS / SC-B4-Android** (native sheets byte-identical, rotation height correct) | ⚠ UNVERIFIED — native device run | `position:'fixed'` + live-height are `Platform.OS==='web'`-gated; native path uses `StyleSheet.absoluteFill` + `Dimensions.get('window')` UNCHANGED. Device run required. |
| **SC-C1-Web** (event/trip/exp top bars 8px below viewport top, equal) | ✓ IMPLEMENTED, partially verified | web-only `spacing.sm` on all three `headerWrap`. Web bundle compiles. Visual authed capture → tester/Seth. `dc81a6c39` |
| **SC-C2-Web** (Home/Hub same web gap) | ✓ IMPLEMENTED, partially verified | web-only `spacing.sm` on Home + Hub hosts. `dc81a6c39` |
| **SC-C3-iOS / SC-C4-Android** (native insets byte-identical, `+0`) | ✓ VERIFIED by construction | `Platform.OS==='web' ? spacing.sm : 0` / `: null` — native expression resolves to the pre-fix value. `i-proposed-tr2-safearea` violation count identical (13) on HEAD vs origin/main → no SafeScreen conversion, no double-inset. `dc81a6c39` |

---

## 3. Files changed (13; all in allowlist)

| File | Batch | ± |
|------|-------|---|
| `mingla-business/src/utils/brandListState.ts` | A.1 | +8/−1 |
| `mingla-business/src/hooks/__tests__/brandListState.test.ts` | A test | +33 |
| `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | A.2 | +9/−3 |
| `mingla-business/app/(tabs)/account.tsx` | A.3 | +4/−1 |
| `mingla-business/app/event/[id]/index.tsx` | A.4 + C.1 | +27/−4 |
| `mingla-business/src/components/ui/TopSheet.tsx` | B.1 | +20/−4 |
| `mingla-business/app/trip/[id]/index.tsx` | C.1 | +9/−1 |
| `mingla-business/app/experience/[id]/index.tsx` | C.1 | +8/−1 |
| `mingla-business/app/(tabs)/home.tsx` | C.1 | +9/−1 |
| `mingla-business/app/(tabs)/hub/_layout.tsx` | C.1 | +10/−1 |
| `.github/scripts/strict-grep/i-proposed-topsheet-web-viewport-anchor.mjs` | B gate | +110 (new) |
| `.github/scripts/strict-grep/i-proposed-web-topbar-breathing-gap.mjs` | C gate | +84 (new) |
| `.github/workflows/strict-grep-mingla-business.yml` | gate registration | +13 |

No DO-NOT-TOUCH file modified: `SafeScreen.tsx`, `useBrandListShim.ts`, `useBrands.ts`, `EventManageMenu.tsx` prop contract, and the line-841 mount gate are all untouched.

---

## 4. Data-model / 5. Edge functions

None. Component/util layer only — no DB, RLS, edge, service, hook, or query-key change (Const #5: brand-list state stays in React Query).

---

## 6. Regression tests + fails-on-revert proofs

### Batch A — unit (`src/hooks/__tests__/brandListState.test.ts`)
Added `test("does not downgrade a fetched non-empty list during a background refetch")` asserting `{isFetching:true,isFetched:true,itemCount:3}→"ready"`, `itemCount:0→"empty"`, and `{isFetched:false}→"query_loading"` (first-load preserved).
**fails-on-revert PROVEN:** reverting the predicate line to `if (isLoading || isFetching || !isFetched) return "query_loading"` (true line deletion of the fix, via `perl` line-replacement) → the new test FAILED at `.toBe("ready")`; restoring the fix → PASSES. Proven against the working tree that became commit **`d1a1378bf`**. (The 1 pre-existing failure in this file at line 93 — `useCurrentBrand.ts` no longer contains the stale grep string `"!isError && brand === null"` — is confirmed to fail identically on origin/main and is OUTSIDE my allowlist; see Discoveries.)

### Batch B — strict-grep gate (`i-proposed-topsheet-web-viewport-anchor.mjs`)
Asserts `TopSheet.tsx` co-locates a `Platform.OS === 'web'` gate with `position:'fixed'` in `rootOverlayStyle`, and still references `StyleSheet.absoluteFill` for native.
**fails-on-revert PROVEN:** removing the `position:'fixed'` web ternary → gate FAILED (`exit=1`, "rootOverlayStyle does not co-locate the gate with position:fixed"); restoring → OK. Tested against the tree at **`ee4c539cf`**.

### Batch C — strict-grep gate (`i-proposed-web-topbar-breathing-gap.mjs`)
Asserts all five top-bar hosts carry a web-gated `spacing.sm` top padding (event ≥2, others ≥1).
**fails-on-revert PROVEN:** reverting the Hub host to bare `insets.top` → gate FAILED (`exit=1`, "found 0"); restoring → OK. Tested against the tree at **`dc81a6c39`**.

The tester writes the second, adversarial test (authed runtime measurement of the Hub panel anchor + the cached-list-while-refetching behavior).

---

## 7. Old → New receipts

### `src/utils/brandListState.ts` (A.1)
- **Before:** `if (isLoading || isFetching || !isFetched) return "query_loading";` — any in-flight background refetch (`isFetching`) downgraded a populated, already-fetched list to loading.
- **Now:** `if (isLoading || !isFetched) return "query_loading";` — `query_loading` is reserved for genuine first load (RQ `isLoading` / `!isFetched`); after first fetch, `itemCount` decides. All prior guard branches (auth_loading/error/signed_out/query_disabled/error) unchanged in order.
- **Why:** F-4 — stop discarding cached brands during a 30s-stale background refetch.
- **Lines:** ~8 (incl. protective comment).

### `src/components/brand/BrandSwitcherSheet.tsx` (A.2)
- **Before:** `brandList.isLoading ? <Loading> : status==='error' ? <Error> : <ScrollView>{brands}…` — any loading flag blanked a populated list.
- **Now:** precedence reordered: error-AND-empty → error; empty-AND-loading → Loading; otherwise → the `<ScrollView>` list (renders cached brands even mid-refetch).
- **Why:** F-4 defense-in-depth. **Lines:** ~9.

### `app/(tabs)/account.tsx` (A.3)
- **Before:** `brandList.status === "ready" ? <list> : …loading…` — a populated-but-refetching list fell into the loading branch.
- **Now:** `brandList.status === "ready" || brands.length > 0 ? <list> : …`. The `brandList.status === "empty"` literal (asserted by an existing grep test) is preserved.
- **Why:** F-4 defense-in-depth. **Lines:** ~4.

### `app/event/[id]/index.tsx` — `handleManageOpen` (A.4)
- **Before:** `setManageMenuVisible(true)` unconditionally → with `brand===null` the line-841 `{brand !== null && manageMenuVisible ? … : null}` mounted nothing → silent dead tap.
- **Now:** if `brand === null`, `setToast({visible:true, message:"Loading brand… tap again in a moment."})` and return (no silent no-op); otherwise unchanged. The line-841 mount gate is UNCHANGED (ORCH-0862 unmount-on-close preserved); `EventManageMenu`'s non-null `brand` contract preserved.
- **Why:** F-2 / Const #1. **Lines:** ~10. (Uses the in-scope `setToast` state setter, same shape as `showToast`, to avoid a use-before-declaration in the callback dep array.)

### `src/components/ui/TopSheet.tsx` (B.1)
- **Before:** root overlay `style={StyleSheet.absoluteFill}` (web → `position:absolute` anchored to the scrollable host); `screenHeight = Dimensions.get('window').height` snapshot for `fixedHeight`.
- **Now:** `rootOverlayStyle = Platform.OS==='web' ? [absoluteFill,{position:'fixed'}] : absoluteFill` (web anchors to the viewport); `screenHeight = Platform.OS==='web' ? windowHeight(live) : Dimensions.get('window').height`. Anchor style, `panelTop`, animations, swipe, scrim, `heightMode`, glass stack UNCHANGED.
- **Why:** F-3 Hub offset + secondary stale-height. **Lines:** ~20.

### event/trip/experience/home/hub top bars (C.1)
- **Before:** top padding = `insets.top` (= 0 on web) → bar glued to the viewport top.
- **Now:** `insets.top + (Platform.OS==='web' ? spacing.sm : 0)` (event/home/hub) or an additive `Platform.OS==='web' ? {paddingTop: spacing.sm} : null` style entry (trip/experience headerWrap, which get their inset from the shared SafeScreen — NOT edited). `Platform` import added to home + hub `_layout`.
- **Why:** F-1 perceived "hug" — additive, web-gated, regression-safe. **Lines:** ~9 each.

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS / Android (`app-mobile/`) | NO — different app | n/a |
| Buyer/anonymous Web | NO — these are authed business shell screens | n/a |
| Business iOS | YES | Automatic (shared) — A is pure TS; B+C web-gated → native unchanged by construction |
| Business Android | YES | Same as iOS |
| Admin Web (`mingla-admin/`) | NO | untouched |
| Business Web preview (PRIMARY) | YES | primary surface — all fixes land here |

---

## 9. Smoke / runtime result

- **Web build:** served the bracket-free detached worktree (`/tmp/orch1136-clean`, port 8125, the SPEC/evidence-documented workaround for the literal `[brackets]` that break expo-router's require.context) via `npx expo start --web`. Bundle compiled cleanly (2282 modules, HTTP 200, no resolve/syntax errors) WITH all batches applied — confirms `position:'fixed'`, the live-height read, and all five Batch C edits + new imports are valid in the actual RNW web build. The served `index.bundle` contains `rootOverlayStyle` + `position:"fixed"`.
- **Batch B mechanism proof (deterministic, unauthenticated):** Playwright/Chromium harness replicating the exact F-3 DOM/CSS (a `position:relative` scrollable host scrolled down, overlay child anchored at `top: insets.top+76`):
  - BEFORE (bare `absolute`): unscrolled top = **76px**; scrolled-600 top = **−524px** (the Hub bug — panel above viewport, only bottom row peeks).
  - AFTER (`absolute + position:fixed`): unscrolled = **76px**; scrolled-600 = **76px** (scroll-independent — Hub == Home). VERDICT: PASS.
- **NOT runtime-verified (named blocker):** the four symptoms on the ACTUAL authenticated event/Hub/Home/Account screens — blocked by no login credentials (SPEC §10, investigation PD-9, Seth-confirmed). The authed end-to-end SC-A2/A3/A4 + SC-B1/B2 full measurements + SC-C visual capture + all native parity SCs are handed to the tester / Seth-driven device run.

---

## 10. Known issues / deferred

- **Batch B confidence:** mechanism-proven on web via the deterministic harness + bundle inspection, but the SPEC's authed Hub `getBoundingClientRect().top` measurement requires login. Per SPEC §10, if the authed runtime shows the offset persists after `position:'fixed'`, STOP and request a SPEC amendment — the harness strongly indicates it will NOT persist (the CSS mechanism is decisive), but the authed confirm is the tester's to lift "probable" → "proven".
- **Batch C** is a perceived-spacing polish, not a code-defect fix (F-1 header theory proven negative on web). `spacing.sm` (8px) is the SPEC's chosen value; if Seth wants more it's a one-token bump to `spacing.md` (16), not a re-architecture.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

- **No migration, no edge-function deploy** (component/util only).
- **Native parity SCs** (SC-A5/A6, SC-B3/B4, SC-C3/C4) require a human-in-the-loop run on the physical/sim business iOS+Android app — hand to tester / Seth.
- **Authed web SCs** (SC-A2/A3/A4, SC-B1/B2, SC-C1/C2) require a logged-in web session — hand to tester (login on the dev build, scroll Hub, open switcher, measure panel `getBoundingClientRect().top` + host `scrollTop`).

---

## 12. Discoveries for orchestrator

1. **[COMMS-0034 — read + honored, no overlap]** ORCH-1137 owns the systemic business-web lucide-icon blank-out (`metro.config.js` icon aliasing / `src/shims/lucideReactNativeWebStub.js`). ORCH-1136 touched NEITHER file; the web-icon surface is fully out of my scope (no icon-stub work in this SPEC). The COMMS-0034 anchor ledger row is dirty from a parallel session, so I did NOT entangle my ack-append into another session's in-flight COMMS_LEDGER.md edit (per the "direct-to-main ledger commits on a dirty anchor are fragile" hazard); recording the ack here instead.
2. **[PRE-EXISTING TEST FAILURE — not mine]** `brandListState.test.ts:93` asserts `useCurrentBrand.ts` contains `"!isError && brand === null"`, but that file was refactored to `brandIsNull: brand === null` by a prior ORCH — the grep is stale and FAILS on a clean origin/main checkout. `useCurrentBrand.ts` is OUTSIDE the ORCH-1136 allowlist; I did not fix it (scope discipline). Recommend a docs-hygiene ORCH to update that stale source-grep assertion.
3. **[PRE-EXISTING LINT DEBT — not mine]** `no-unescaped-entities` errors on `Couldn't load your brands.` in `BrandSwitcherSheet.tsx` and `account.tsx` predate ORCH-1136 (verbatim on origin/main); no eslint CI gate exists, so they don't block. Left untouched (copy-escaping is out of scope).
4. **[Discovery #4/#6 from investigation, NOT fixed — out of scope per SPEC §2]** TopSheet's native `Dimensions.get('window')` mix and `useBrands`' `Date.now()`-keyed Realtime channel remain; SPEC explicitly excluded them.
