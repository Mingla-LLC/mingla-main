# TEST — ORCH-1136 [business-web shell bugs]

**Phase:** TEST (mingla-tester). **Brutal gatekeeper — every claim independently re-proven.**
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs]/` on branch `ORCH-1136-biz-web-shell-bugs`.
**HEAD under test:** `94e67163c` (impl report) + `e4e37c774` (tester adversarial test, this run).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1136_BIZ_WEB_SHELL_BUGS.md`. **IMPL:** `Mingla_Artifacts/IMPLEMENT_ORCH-1136_BIZ_WEB_SHELL_BUGS.md`.
**Commits verified:** Batch A `d1a1378bf` · Batch B `ee4c539cf` · Batch C + gates `dc81a6c39`.
**Comms ledger:** scanned on entry. **COMMS-0034 (WARN, OPEN, → ORCH-1136):** read + honored — verified neither `metro.config.js` nor `src/shims/lucideReactNativeWebStub.js` is in the ORCH-1136 diff (web-icon blank-out is ORCH-1137's scope). Ack recorded here (anchor `COMMS_LEDGER.md` is dirty from a parallel session → did NOT entangle a direct-to-main ack-append per the fragile-dirty-anchor hazard; same path the implementor took).

---

## 1. VERDICT

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2.

Zero defects. All deterministic logic is `proven`; the Batch B web layout mechanism is independently `proven` at the CSS-geometry level via my own Chromium harness (a layout-physics fact, not auth-gated). The remaining SCs are **gated solely on a human authed-web session + native-device run** (no credentials/device available to me) — they are NOT failures, they are pending human confirmation. The conditions below are NOT defects; they are the exact runtime evidence the SPEC itself routed to a human (SPEC §5 per-surface SCs, §10 open question on Batch B authed measurement).

**This is CONDITIONAL because the source-only/web-mechanism evidence cannot reach `proven` on the authed-web and native-device SCs without Seth.** All code-level, logic-level, and web-layout-mechanism verification PASSED.

---

## 2. SC-by-SC matrix

| SC | Verdict | Evidence |
|----|---------|----------|
| **SC-A1** (predicate: fetched+refetching→ready/empty; first-load/auth/disabled/signed-out preserved) | **PASS (proven)** | I independently ran `brandListState.test.ts` + my own adversarial test. `{isFetching:true,isFetched:true,itemCount:3}→"ready"`, `itemCount:0→"empty"`, `isFetched:false→"query_loading"`, `authStatus:"bootstrapping"→"auth_loading"`, `hasUser:false→"query_disabled"`, `signed_out→"signed_out"` all confirmed. Guard order in source (lines 27–42) preserved. |
| **SC-A2-Web** (switcher shows cached rows while refetching) | **PENDING-HUMAN (authed web)** | A.1 predicate + A.2 consumer reorder verified in source: precedence is error-AND-empty → empty-AND-loading → list. Cannot exercise the authed switcher without login. |
| **SC-A3-Web** (Account shows cached rows after idle refetch) | **PENDING-HUMAN (authed web)** | A.3 leading condition `status==="ready" \|\| brands.length>0` verified in source; `"empty"` literal preserved. Authed runtime needs login. |
| **SC-A4-Web** (event `⋯`: opens w/ brand, toast when null, never dead tap) | **PENDING-HUMAN (authed web)** | A.4 verified in source: `handleManageOpen` shows `setToast({visible:true,message:"Loading brand… tap again in a moment."})` and `return`s when `brand===null`; line-841 mount gate `{brand !== null && manageMenuVisible ? …}` UNCHANGED (0 diff hits); `setToast`/`<Toast>` confirmed in-scope (lines 140/935). Authed runtime needs login. |
| **SC-A5-iOS / SC-A6-Android** (native parity) | **PENDING-HUMAN (native device)** | Pure-TS predicate runs identically on native; web-gated B/C untouched on native. Improves native by construction (no regression). Device run required. |
| **SC-B1-Web** (Hub switcher anchored ~76px == Home, scroll-independent) | **PASS at MECHANISM level (proven by tester harness) · full authed measurement PENDING-HUMAN** | My OWN Chromium harness (different angle — 4 scroll offsets 0/300/600/1200, scroll-invariance assertion) reproduced the bug (bare `absolute`: 76 / −224 / −524 / −1124px) and proved the fix (`position:fixed`: **76px at ALL four offsets**). The CSS-geometry fact is decisive. The authed Hub `getBoundingClientRect().top` end-to-end measurement still needs login. |
| **SC-B2-Web** (both TopSheet consumers from scrolled+unscrolled) | **PASS at MECHANISM level · per-consumer authed PENDING-HUMAN** | Fix is in the shared `TopSheet` root → both consumers (`fixed-70` BrandSwitcher + `compact` UniversalCreator) inherit the viewport anchor. Mechanism proven; per-consumer authed runtime needs login. |
| **SC-B3-iOS / SC-B4-Android** (native byte-identical, rotation height) | **PENDING-HUMAN (native device)** | Native branch verified in source: `rootOverlayStyle`→`StyleSheet.absoluteFill` (line 330), `screenHeight`→`Dimensions.get('window').height` (line 144). Both `Platform.OS==='web'`-gated → native unchanged by construction. Rotation behavior preserved (native still snapshot). Device run required. |
| **SC-C1-Web** (event/trip/exp top bars 8px below viewport top, equal) | **PASS at SOURCE level (suspected→additive proven safe) · visual PENDING-HUMAN** | All three `headerWrap` carry web-gated `spacing.sm` (event ×2 sites, trip/exp ×1 each as additive `{paddingTop:spacing.sm}` over the `paddingHorizontal`-only style → confirmed no pre-existing paddingTop, so purely additive). Visual equality is a human eyeball. |
| **SC-C2-Web** (Home/Hub same web gap) | **PASS at SOURCE level · visual PENDING-HUMAN** | Home (line 421) + Hub (line 198) hosts add `insets.top + (Platform.OS==="web" ? spacing.sm : 0)`. `Platform` import added to both. |
| **SC-C3-iOS / SC-C4-Android** (native insets byte-identical, +0) | **PASS (proven by construction)** | Every Batch C site resolves to `+ 0` (event/home/hub) or `: null` (trip/exp) on native → native top inset === `insets.top` exactly as pre-fix. No SafeScreen edit; no double-inset. |

---

## 3. Findings

**No P0/P1/P2/P3.** Two informational notes:

### P4-1 (NOTE) — implementor modified an existing test file, but SPEC-directed and zero-deletion
`mingla-business/src/hooks/__tests__/brandListState.test.ts` is `M` (modified), not append-only. This is acceptable: SPEC §8 step 2 explicitly directed "update the existing `brandListState.test.ts`," and `git diff origin/main...HEAD` on that file shows **zero `-` lines** (purely a `+33` additive test block; the 3 kept-guard tests still pass when I ran them). The tester append-only rule binds MY tests (I added a NEW file). No weakening of any existing assertion. Informational only.

### P4-2 (NOTE / praise) — clean, surgical, gate-backed implementation
Batches are minimal, every web/native split is a single `Platform.OS==='web'` ternary, DO-NOT-TOUCH list fully respected, ORCH-0862 mount gate preserved verbatim, two well-constructed fails-on-revert strict-grep gates registered in CI. Good work.

### Discovery for orchestrator (NOT fixed here — pre-existing, outside allowlist)
`brandListState.test.ts:93` asserts `useCurrentBrand.ts` contains `"!isError && brand === null"`, but that file was refactored to `brandIsNull: brand === null` by a prior ORCH. **I independently confirmed this failure is identical on `origin/main`** (`git show origin/main:…useCurrentBrand.ts` → `brandIsNull: brand === null`; the test string is stale). It is OUTSIDE the ORCH-1136 allowlist and pre-dates this work. Recommend a docs-hygiene ORCH to update the stale grep. Does NOT block ORCH-1136.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

I checked out the predicate at HEAD, line-reverted `src/utils/brandListState.ts:41` from `if (isLoading || !isFetched) return "query_loading"` back to `if (isLoading || isFetching || !isFetched) return "query_loading"` (true `perl` line-replacement), and ran the implementor's new test:

- **REVERTED:** `test("does not downgrade a fetched non-empty list during a background refetch")` **FAILED** at `brandListState.test.ts:63` — `expect(received).toBe(expected) // Expected: "ready", Received: "query_loading"`.
- **RESTORED:** test **PASSES**.
- Verified against the working tree that is commit **`d1a1378bf`**.

I also independently re-proved BOTH strict-grep gates:
- **Batch B gate** (`i-proposed-topsheet-web-viewport-anchor.mjs`): removed the web `position:'fixed'` ternary → gate **FAILED** `exit=1` ("expected a `rootOverlayStyle` web-gated style variable carrying the position:'fixed' anchor"); restored → `OK exit=0`. Verified at **`ee4c539cf`**.
- **Batch C gate** (`i-proposed-web-topbar-breathing-gap.mjs`): reverted the Hub host to bare `insets.top` → gate **FAILED** `exit=1` ("expected >= 1 … found 0"); restored → `OK exit=0`. Verified at **`dc81a6c39`**.

All three fails-on-revert gates independently re-confirmed.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/src/utils/__tests__/brandListState.orch1136.tester_adversarial.test.ts` (NEW, append-only).
- **Commit:** `e4e37c774` — on-branch, present in `git diff origin/main...HEAD --name-only`.
- **Angle (DIFFERENT from implementor):** implementor proves the *refetch→ready* direction; I prove the **cold-boot & guard-precedence BOUNDARY** — that the fix did NOT over-reach:
  1. genuine first load (`!isFetched`) STILL `query_loading` even with a stale `itemCount>0` (cold boot can never flash a populated-then-empty list) — the precise risk of letting `itemCount` decide too early;
  2. auth/signout/disabled/error guards STILL outrank the new itemCount tail across every noisy fetch-flag combination;
  3. the exact fix boundary — `isFetching` honored before the first fetch, ignored after.
- **fails-on-revert verified at `94e67163c`/`e4e37c774`:** with `|| isFetching` restored, assertion (3b) `{isFetched:true,isFetching:true,itemCount:2}→"ready"` **FAILS** (`Received: "query_loading"`) while the cold-boot invariants (1) and guard-precedence (2) stay GREEN — proving correctness in BOTH directions. Restored → all 3 PASS.
- Both the implementor happy-path test AND this adversarial test appear in the closing diff.

---

## 6. Batch B independent web-layout result (the load-bearing claim)

I wrote my OWN Playwright/Chromium harness (real Chromium, not the implementor's harness) reproducing the actual RNW DOM: a `position:relative` route host that document-scrolls (Hub), an `absoluteFill` overlay root, and the panel anchor at `top: insets.top + 76`. Driven across **four** scroll offsets (0, 300, 600, 1200 — including past the panel), asserting scroll-INVARIANCE:

```
BEFORE (bare absoluteFill — anchors to scrollable host)
  scrollTop=0    panel.top=76px
  scrollTop=300  panel.top=-224px
  scrollTop=600  panel.top=-524px      ← matches implementor's −524px figure exactly
  scrollTop=1200 panel.top=-1124px
AFTER (position:fixed — anchors to viewport)
  scrollTop=0    panel.top=76px
  scrollTop=300  panel.top=76px
  scrollTop=600  panel.top=76px
  scrollTop=1200 panel.top=76px
VERDICT: PASS — position:fixed pins the panel scroll-invariantly.
```

`position:'fixed'` pins the panel at exactly 76px regardless of host scroll. **The mechanism is confirmed; Batch B is NOT routed back for a SPEC amendment.** The source emits the web-gated `position:'fixed'` in `rootOverlayStyle` (TopSheet.tsx:327–330) and the implementor confirmed the served web bundle carries `position:"fixed"`. The only thing left is the authed end-to-end Hub measurement (SPEC §10) — a human confirmation, not a mechanism doubt.

---

## 7. Parity verdict (cross-platform)

**PASS — no native regression on any path.**

- **Batch A (pure TS):** the predicate + the `setToast` toast affordance run identically on web/iOS/Android. STRICTLY IMPROVES native (cached brands now render mid-refetch on device too). No native-only branch.
- **Batch B (web-gated):** native resolves to `StyleSheet.absoluteFill` + `Dimensions.get('window').height` — byte-identical to pre-fix. `position:'fixed'`/live-height never reach native.
- **Batch C (web-gated):** every native branch is `+ 0` or `: null` → native top inset = `insets.top` unchanged. SafeScreen NOT edited; trip/exp `headerWrap` padding is additive (confirmed no pre-existing paddingTop). No double-inset.
- **TypeScript:** all 10 ORCH-1136 source files are tsc-clean. The 230 project-wide tsc errors are pre-existing (e.g. `buyer.tsx:509` byte-identical on origin/main) and untouched by this ORCH.

---

## 8. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | event `⋯` null-brand now shows a toast + returns; no silent no-op (A.4). |
| 2 | One owner per truth | **PASS** | brand list stays owned by React Query; no second writer added. |
| 3 | No silent failures | **PASS** | the previously-silent dead tap now surfaces explicit feedback. |
| 4 | One query key per entity | **N/A** | no query-key change (useBrands untouched). |
| 5 | Server state stays server-side | **PASS** | no `setBrands`/Zustand write introduced (diff grep empty); shim read-only. |
| 6 | Logout clears everything | **N/A** | no auth/logout path touched. |
| 7 | Label `[TRANSITIONAL]` | **N/A** | no transitional code. |
| 8 | Subtract before adding | **PASS** | predicate simplified (removed `|| isFetching`); reorders, not new state. |
| 9 | No fabricated data | **PASS** | toast copy is a loading hint, not fake brand data; missing brand stays hidden. |
| 10 | Currency-aware | **N/A** | no money path. |
| 11 | One auth instance | **N/A** | no new auth instance. |
| 12 | Validate at the right time | **N/A** | no datetime logic. |
| 13 | Exclusion consistency | **N/A** | no exclusion filter. |
| 14 | Persisted-state startup gate | **PASS** | cold-boot first-load still `query_loading` (adversarial test (1) proves no empty-flash). |

DRAFT invariants enforced: **I-PROPOSED-BRANDLIST-CACHED-OVER-REFETCH** (unit fails-on-revert ✓), **I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR** (B gate fails-on-revert ✓), **I-PROPOSED-WEB-TOPBAR-BREATHING-GAP** (C gate fails-on-revert ✓). All three registered in `.github/workflows/strict-grep-mingla-business.yml`.

---

## 9. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Consumer iOS / Android (`app-mobile/`) | **N/A** | different app; not touched. |
| Buyer/anonymous Web | **N/A** | authed business shell screens; not touched. |
| Business iOS | **PENDING-HUMAN** | SC-A5/B3/C3 — native device run required (no device to me). Native unchanged by construction (verified in source). |
| Business Android | **PENDING-HUMAN** | SC-A6/B4/C4 — native device run required. |
| Admin Web (`mingla-admin/`) | **N/A** | untouched. |
| Business Web preview (PRIMARY) | **MECHANISM-PROVEN + PENDING-HUMAN authed** | Batch B layout mechanism PROVEN by my Chromium harness; SC-A2/A3/A4 + SC-B1/B2 + SC-C1/C2 full end-to-end need a logged-in session. |

**Physical iPhone (HITL):** not run — no device/creds available to me. Surfaced as the explicit operator-unblock list below (not a silent skip).

---

## 10. Accepted conditions (the precise human-run list — gates the verdict to CONDITIONAL)

These are NOT defects. They are the runtime SCs the SPEC itself routes to a human. PASS is reachable once Seth runs them:

**Authed web (login on the business web build, then):**
1. **SC-A2/A3** — navigate to a detail route and back, and open Account after 30s idle → cached brand rows render immediately; "Loading your brands…" must NOT flash while brands are known; repeated nav never wedges on "Loading…".
2. **SC-A4** — tap event `⋯` on a resolvable-brand event (menu opens) and on a momentarily-null-brand event (toast "Loading brand… tap again in a moment.", never a dead tap); trip/experience `⋯` unchanged.
3. **SC-B1/B2** — scroll Hub down, open the brand switcher; measure panel `getBoundingClientRect().top` (expect ≈76, == Home, independent of host `scrollTop`); repeat for the UniversalCreatorSheet (`compact`).
4. **SC-C1/C2** — eyeball: event/trip/experience/Home/Hub top bars sit 8px below the viewport top, all equal, un-glued.

**Native device (business iOS + Android):**
5. **SC-A5/A6** — Account/switcher show cached brands on re-entry/after-background (no "Loading…" flash); cold-boot still shows "Loading…" until data (no empty flash); signed-out never shows empty "no brands"; event `⋯` opens once brand resolves or shows the toast; ORCH-0862 no double-present freeze preserved.
6. **SC-B3/B4** — both sheets open from Home AND Hub with byte-identical anchor/animation/height; rotate device → panel height tracks correctly.
7. **SC-C3/C4** — top insets byte-identical to pre-fix (no layout shift). *(Proven by construction in source; device confirm is belt-and-suspenders.)*

---

## 11. Routing

CONDITIONAL PASS with the conditions in §10 being human-runtime SCs the SPEC pre-designated (not unaccepted defects). Per the brutal-gatekeeper rule, because these are runtime confirmations rather than accepted-defects, this report **STOPS and surfaces to Seth** for the authed-web + native-device runs. Once Seth completes §10, the verdict converts to PASS → orchestrator CLOSE (flip the 3 DRAFT invariants ACTIVE; reconcile registration against the original 4-symptom request; no scope bleed). If any §10 run fails, route back to implementor with the SC-ID.

**Working tree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs]/` on branch `ORCH-1136-biz-web-shell-bugs`.
