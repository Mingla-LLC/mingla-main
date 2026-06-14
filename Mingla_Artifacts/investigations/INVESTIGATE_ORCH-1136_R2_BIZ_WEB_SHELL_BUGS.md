# INVESTIGATE — ORCH-1136 ROUND 2 [business-web shell bugs] (Seth's authed runtime overrides round 1)

**Phase:** INVESTIGATE (forensics). **No fix proposed — direction + regression contract only.**
**Surface:** mingla-business React-Native-Web build (business.usemingla.com), desktop + narrow web.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs-r2]/` on branch `ORCH-1136-biz-web-shell-bugs-r2` (rebased on origin/main HEAD `89b9e22fc`; round-1 merge `dbc64a6f6` present).
**Round-1 status:** merged to main (Batch A `d1a1378bf`, Batch B `ee4c539cf`, Batch C `dc81a6c39`, CLOSE `0c77763d2`). Round 1 was **source-only / no-auth** and explicitly capped its conclusions at "probable". Seth's authenticated runtime test (which round 1 could not perform) proved two conclusions WRONG and one a REGRESSION. **This R2 ground truth OVERRIDES round 1.**

## Comms ledger
Scanned `COMMS_LEDGER.md` active table. No `BLOCK`/`OPEN` row addressed to `mingla-forensics`, `ORCH-1136`, or `ALL`. COMMS-0029 (WARN, `biz_update_live_trip` clobber → ORCH-1119/ALL) and COMMS-0034 (FYI, ORCH-1137 web-icon shim, already honored by round 1) are out of this scope. Nothing to ack.

## Runtime env this pass
Bracket-free detached worktree (`/tmp/orch1136r2-clean`, off worktree HEAD `89b9e22fc`) for any web bundling — the literal `[brackets]` in the worktree path break expo-router's `require.context` glob (round-1 hazard, reused). Authenticated brand-switcher / event-detail screens were **NOT reachable (no login credentials — a genuine STOP-and-ask blocker per PD-9)**. Therefore:
- **Findings 2+3 (TopSheet):** proven via **faithful real-`react-native-web` Chromium harnesses** that reproduce the EXACT post-Batch-B DOM/CSS, including the expo-router web style reset. Mechanism CLASS proven at runtime.
- **Finding 1 (event ⋯):** proven what is NOT the cause (real RN-web Modal harness), narrowed the live cause to two candidates; the exact discriminator needs one authed tap. Capped at **suspected** per PD-7.

Harnesses + bundles live in `/tmp/orch1136r2-harness/` (esbuild + the app's real `react-native-web@0.21.2`): `topsheet.mjs`/`entry*.jsx`/`drive*.mjs` (TopSheet geometry), `menu.jsx`/`drivemenu.mjs` (event-vs-trip menu mount), `drive4.mjs` (fixed-containing-block trap proof). Verbatim outputs transcribed below.

---

## Q-scorecard

- **Q1 — Why does the event ⋯ do ABSOLUTELY NOTHING on web (no toast, no menu) while trip ⋯ works?**
  **Verdict: round-1 theory REFUTED; live cause SUSPECTED (two candidates, authed-tap discriminator named).**
  Proven negative: the event-vs-trip menu primitives are IDENTICAL on web (both `IconChrome icon="moreH"` → both `Sheet` → both `Sheet.web.tsx` → `DesktopCenteredCard` RN-web `<Modal>`). Proven negative: the conditional-mount-when-visible pattern (event's line-866 gate) renders the Modal+card+body just as visibly as trip's always-mounted toggle (harness, both `opacity:1`, `w=480`). Proven by logic: when `handleManageOpen` runs, EVERY value of `brand` yields EITHER a toast (`brand===null`) OR a mounted+rendering menu (`brand!==null`) — there is no branch that yields neither. Since Seth sees NEITHER, **`handleManageOpen` is not running on the event page** (the moreH `onPress` is not reaching the handler), OR the round-1 toast is itself not rendering. Capped at suspected — the exact interceptor cannot be named from source because the primitives are shared with the WORKING trip ⋯ and share button.

- **Q2 — Is the round-1 "Loading brand… tap again" toast (Batch A.4) reachable?**
  **Verdict: PROVEN it does not fire in Seth's repro → the `brand===null` branch is not being hit at tap time** (else the toast Modal would show). This is consistent with Q1's "handler not running" candidate, OR with `brand!==null` (handler runs, toast skipped, menu should mount).

- **Q3 — Did Batch B's `position:'fixed'` + live-window-height fix the Hub offset, or regress Home + Hub?**
  **Verdict: REGRESSION PROVEN (mechanism class). Round-1 F-3 root-cause was FALSE.** The expo-router web reset is `body{overflow:hidden}` — the document/route-host CANNOT scroll. Round 1's entire F-3 theory ("a scrolled Hub host offsets the `absoluteFill` anchor") is therefore physically impossible, and the faithful harness confirms pre-fix `absolute` already anchored correctly on BOTH Home and Hub. Batch B changed `absoluteFill` → `[absoluteFill,{position:'fixed'}]`; `position:fixed` is captured by ANY ancestor with `transform`/`filter`/`backdrop-filter`/`will-change`/`contain`/`perspective`, of which the real Home/Hub shell has at least one (proven class, exact ancestor unnamed). A trapping ancestor shorter than the viewport collapses the scrim to that box (→ "too transparent / see-through") and re-anchors the panel `top:76` within it (→ "stops short / doesn't open all the way down"), on BOTH pages — exactly Seth's report.

- **Q4 — What is the correct fix for the ORIGINAL Hub offset that does NOT regress Home and restores height + opacity on both?**
  **Verdict: revert `position:fixed` (it fixed a non-existent problem) and address the REAL original Hub offset, which is NOT document-scroll.** Direction in §Fix-direction. The original Hub offset must be re-derived from an authed Hub capture — round 1 never proved it (no auth), and its scroll-anchor theory is now disproven.

---

## Findings

### F-1 — Event ⋯ web no-op: round-1 mount/brand-null theory REFUTED; cause narrowed to "handler not reached" (SUSPECTED)

- **Symptom (Seth, authed):** tapping ⋯ on `/event/{id}` on web produces NOTHING — no toast, no flash, no menu. Trip ⋯ works on web.
- **Layer:** code + runtime (auth-blocked).
- **Probe / Evidence:**
  - **Primitives are identical (source):** event ⋯ = `IconChrome icon="moreH" onPress={handleManageOpen}` (`app/event/[id]/index.tsx:651-656`); trip ⋯ = `IconChrome icon="moreH" onPress={() => setManageMenuVisible(true)}` (`app/trip/[id]/index.tsx:387-390`). Both menus render `<Sheet …>` (`EventManageMenu.tsx:325`, `TripManageMenu.tsx:84`) imported from the SAME `"../ui/Sheet"`. On web Metro resolves that to `Sheet.web.tsx`, which at desktop width renders `DesktopCenteredCard` (RN-web `<Modal>`, `Sheet.web.tsx:105-111,206`) and at narrow web renders `MobileSheet`. **No `ActionSheetIOS`, no `@react-native-menu`, no native-only context menu, no platform `.web` divergence between the two menus.** The dispatch's "web-incompatible primitive" hypothesis is REFUTED.
  - **Conditional-mount pattern renders fine on web (harness, real RN-web Modal):** `menu.jsx`/`drivemenu.mjs` rendered both Pattern T (trip: `<Menu>` always mounted, `visible` toggles false→true) and Pattern E (event: `{visible ? <Menu visible/> : null}` — the exact line-866 gate, mounted only when already `visible===true`). VERBATIM output:
    `TRIP OPEN … card {w:480,opacity:"1",visibility:"visible"} body "TRIP menu open"`
    `EVENT OPEN … card {w:480,opacity:"1",visibility:"visible"} body "EVENT menu open"`
    `VERDICT trip card visible: true` / `VERDICT event card visible: true`. **Both patterns render the Modal+card+content visibly.** Round 1's (and my initial) "conditional-mount-when-visible fails to animate in on web" hypothesis is REFUTED — RN-web `ModalAnimation` with `animationType="none"` (`node_modules/react-native-web/.../Modal/ModalAnimation.js:56-70`) resolves `isRendering→true` on the mount effect and shows the content.
  - **Logic proof the handler is not running:** `handleManageOpen` (`app/event/[id]/index.tsx:164-175`): `if (brand === null) { setToast(…); return; } setManageMenuVisible(true);`. The mount gate (`:866`): `{brand !== null && manageMenuVisible ? <EventManageMenu visible/> : null}`. Both read the SAME `brand`. If the handler runs: `brand===null` → toast Modal shows; `brand!==null` → `manageMenuVisible=true` → gate true → menu mounts → (harness-proven) renders. **There is no value of `brand` that yields neither a toast nor a menu.** Seth sees neither ⇒ the handler is not executing (the moreH `onPress` is not reaching it), OR a deeper render-state issue prevents both UI surfaces.
  - **`brand` source (source):** `brand = routeEvent.brand` (`:114`), from `useManagedEventRoute` (`useManagedEventRoute.ts:57-63`): `serverDetail?.brand` if defined, else `brands.find(localEvent.brandId)`, else `null`. For a normal server-backed event, `serverDetail?.brand` is defined and non-null → `brand!==null` → handler (if run) mounts the menu.
  - **IconChrome `onPress` swallows errors silently in production (`IconChrome.tsx:120-130`):** `handlePress` is `async`, `await onPress()` inside a `try/catch` that only logs when `__DEV__`. In a production web build (`__DEV__` false) a throw in `onPress` is swallowed with zero UI — a *latent* dead-tap amplifier, though `handleManageOpen` has no obvious throw.
- **Mechanism (suspected, two candidates):**
  1. **Handler-not-reached:** the event moreH `onPress` is intercepted/never fired on web (some overlay, pointer-events, or web-specific tap path on the event header right-slot that trip's identical button escapes). The proven "neither toast nor menu" state is fully consistent with this.
  2. **Brand-null + toast-not-rendering:** `brand===null` at tap (server returns `brand:null`, or local/trip-fallback event + F-4-wedged brand list), the handler runs the toast branch, but the round-1 Toast (`app/event/[id]/index.tsx:933-940`, self-positioning `<Modal>`) does not surface on web. Less likely (Toast is a portal Modal that should show), but not excluded without auth.
- **Severity:** SECONDARY ROOT CAUSE (real, Seth-confirmed dead tap) — **cause SUSPECTED**, primitive-incompatibility theory RULED OUT.
- **Authed discriminator (one tap lifts to proven):** on a logged-in web session, open `/event/{id}`, attach a `console.log` breakpoint or temporary log at `handleManageOpen` entry, tap ⋯. (a) Handler does NOT log → candidate 1 (intercepted tap): inspect the moreH element's `getBoundingClientRect`, `elementFromPoint(centerX,centerY)`, and computed `pointer-events` of every ancestor/overlapping element vs the working trip ⋯. (b) Handler logs + `brand===null` → candidate 2: confirm whether the Toast Modal mounts. (c) Handler logs + `brand!==null` + no menu → re-open the Modal-render question on the REAL Sheet (reanimated path) under the live tree.

### F-2 — Batch B TopSheet `position:'fixed'` is a Home+Hub REGRESSION (CONFIRMED ROOT CAUSE — mechanism class proven)

- **Symptom (Seth, authed):** after round 1, the brand switcher is TOO TRANSPARENT (almost see-through) AND stops short ("doesn't open all the way down") on BOTH Home and Hub. Before round 1, Home was fine; only Hub was offset.
- **Layer:** code + runtime (CSS, proven in real RN-web Chromium).
- **Probe / Evidence:**
  - **The change (source):** `TopSheet.tsx:327-330` `rootOverlayStyle = Platform.OS==='web' ? [StyleSheet.absoluteFill, {position:'fixed'}] : StyleSheet.absoluteFill;` and `:143-144` `screenHeight = web ? windowHeight(live) : Dimensions.get('window').height`. The scrim is `[absoluteFill,{backgroundColor:'rgba(0,0,0,0.5)'},scrimStyle]` inside this root (`:338-344`); the panel height is `screenHeight*0.7` (`:151`).
  - **The expo-router web reset KILLS round-1's premise (source, `node_modules/expo-router/build/static/html.js`):** `#root,body,html{height:100%} body{overflow:hidden} #root{display:flex}`. **`body{overflow:hidden}` ⇒ the document/route-host never scrolls.** Hub "scrolling" happens inside an inner RN `ScrollView`, NOT the window. Round-1 F-3 ("scrolled host offsets the `absoluteFill` anchor") is therefore impossible.
  - **Faithful harness with the real reset (`entry2.jsx`/`drive2.mjs`, real `react-native-web`, inner-ScrollView scroll, viewport 390×844) — VERBATIM:**
    `prefix_home  scrimCovers=true anchorTop=76 panelH=591 panelBtmReaches=true`
    `prefix_hub   scrimCovers=true anchorTop=76 panelH=591 panelBtmReaches=true`
    `fixed_home   scrimCovers=true anchorTop=76 panelH=591 panelBtmReaches=true`
    `fixed_hub    scrimCovers=true anchorTop=76 panelH=591 panelBtmReaches=true`
    ⇒ **pre-fix `absolute` was ALREADY correct on BOTH pages** (round-1's Hub-offset diagnosis was wrong); and in a clean tree `position:fixed` is harmless. Neither symptom reproduces here — so the regression needs a trapping ancestor present only in the real shell.
  - **Fixed-containing-block trap PROVEN (mechanism class, `drive4.mjs`, real CSS, ancestor box height 600 < viewport 844) — VERBATIM:**
    `no-xform + fixed (control)        scrimVis=844/844 covers=true  panelTop=76`
    `transform:translateZ(0) + fixed   scrimVis=600/844 covers=false panelTop=84`
    `will-change:transform + fixed     scrimVis=600/844 covers=false panelTop=84`
    `backdrop-filter:blur + fixed      scrimVis=600/844 covers=false panelTop=84`
    `filter:blur + fixed               scrimVis=600/844 covers=false panelTop=84`
    ⇒ ANY `transform`/`will-change`/`filter`/`backdrop-filter` ancestor that is shorter than the viewport **captures the `position:fixed` root's containing block**: the scrim shrinks to the ancestor box (`covers=false`, ~244px of viewport left with NO scrim → "too transparent / see-through") and the panel's `top:76` anchor lands inside the shortened box ("stops short / doesn't open all the way down"). This reproduces BOTH of Seth's symptoms on BOTH pages exactly. (`position:absolute`, pre-fix, is NOT captured by transform/filter/will-change ancestors — only by `position:relative` ones, i.e. the full-height host — which is why pre-fix Home + Hub were both correct.)
  - **Trapping ancestors exist in the real Home/Hub shell (source, exact one not named without auth):** candidate fixed-containing-block establishers above the sheet at runtime — `GlassChrome`'s `BlurView` (`backdrop-filter` on web ≥768; `+html.tsx:14-19` only kills it <768), reanimated entering/layout-animation transforms on wrapping views, the `DesktopCanvas` column (≥1024), the BottomNav web capsule region. At least one is in the ancestor path on the real page; the harness proves the CLASS is sufficient.
  - **Secondary contributor (source):** `screenHeight=windowHeight` (live `useWindowDimensions`) on mobile web can shrink with the URL bar; combined with the trap it compounds the short panel, but is not the primary cause.
- **Mechanism:** Batch B swapped the sheet root from `position:absolute` (immune to transform/filter ancestors) to `position:fixed` (captured by them). The real Home/Hub tree contains ≥1 such ancestor shorter than the viewport, so the fixed root anchors to it instead of the viewport → scrim under-covers (see-through) + panel anchors short (stops short), on both pages. Round 1's clean-tree harness measured only the anchor `top` of an isolated overlay (no trapping ancestor, no scrim/height measurement), so it reported PASS and missed the regression.
- **Severity:** CONFIRMED ROOT CAUSE. Confidence: **probable** — the mechanism class is runtime-proven and matches both symptoms on both pages exactly; the SPECIFIC trapping ancestor in the live tree is unnamed (no-auth blocker). To lift to proven: on an authed web session, open the switcher and read `getComputedStyle` + `getBoundingClientRect` of the TopSheet root's offset/containing parent vs the viewport.

### F-3 — Round-1 F-3 (the original "Hub offset") root cause was FALSE; the real original cause is unproven (RULED OUT / re-open)

- **Symptom:** before round 1, Hub-only switcher offset.
- **Evidence:** `body{overflow:hidden}` (above) makes the round-1 "scrolled host" theory impossible; the faithful harness shows pre-fix `absolute` is correct on Hub. So whatever caused Seth's ORIGINAL Hub offset, it was NOT document scroll, and round 1 never proved it (no auth).
- **Mechanism:** unknown; the most likely real cause is the SAME fixed-containing-block / positioned-ancestor class (a `position:relative` or transformed Hub-only wrapper between the route host and the sheet that Home lacks), OR a Hub-specific extra-chrome height the sheet's `top:76` didn't account for.
- **Severity:** RULED OUT (round-1 scroll theory) / **re-open under auth.** The corrected fix (F-2) reverts `position:fixed`; the original Hub offset must be re-captured authed BEFORE claiming it fixed.

---

## Fix direction (NO code — contract only)

**Findings 2+3 (TopSheet) — corrected approach:**
1. **Revert the `position:'fixed'` root-overlay change** (`TopSheet.tsx:327-330`) back to bare `StyleSheet.absoluteFill` on web. The faithful harness proves `absoluteFill` is correct on both Home and Hub under the real expo-router reset; `position:fixed` fixed a non-existent problem and introduced the containing-block trap. Native is already `absoluteFill` (untouched).
2. **Re-derive and fix the ORIGINAL Hub offset from an authed capture** — it is NOT document scroll. If it is a positioned/transformed Hub-only wrapper between the route host and the sheet, the durable fix is to **render the sheet via a portal to the document root** (RN-web `Modal`/`createPortal`, the SAME pattern `Sheet.web`/Toast already use successfully) with an explicit viewport-fixed overlay container (`100dvh`, `top:0;left:0;right:0;bottom:0`) + the original scrim — escaping EVERY app-tree ancestor (transform/relative alike) on web only, native byte-identical. A portal is the robust answer; a bare `absoluteFill` revert only holds if no positioned/transformed ancestor sits between host and sheet (must be confirmed authed).
3. Optionally single-source `screenHeight` to one window-height read (the round-1 `windowHeight`/`Dimensions` split is a secondary short-panel contributor).

**Finding 1 (event ⋯) — corrected approach:**
- The fix depends on the authed discriminator. If candidate 1 (handler not reached / intercepted tap), the contract is "the event moreH onPress reaches `handleManageOpen` on web exactly as trip's does" — likely a pointer-events/overlay or web-tap correction on the event header right-slot, NOT a menu change. If candidate 2 (brand-null + toast not showing), the contract is "the `brand===null` tap produces a visible web affordance" (fix the Toast surfacing on web) AND/OR resolve `brand` robustly so the menu mounts. Do NOT re-architect the menu primitive — it is proven cross-platform-correct.

---

## Regression-safety plan (all three in ONE batch)

- **Native byte-identical:** every TopSheet web change stays `Platform.OS==='web'`-gated; native path remains `StyleSheet.absoluteFill` + `Dimensions.get('window')`. DEC-080/DEC-NEW-A: TopSheet's TWO consumers — `BrandSwitcherSheet` (`fixed-70`) and `UniversalCreatorSheet` (`compact`) — must BOTH be verified open-correctly on web (full height + full scrim) AND on native (animation/swipe/height unchanged).
- **Both Hub-offset AND no-Home-regression:** the corrected fix must show, on an authed web session: Home switcher full-height + opaque scrim (no regression), Hub switcher full-height + opaque scrim AND no original offset, at any inner-scroll position.
- **Strict-grep gate update:** round-1's `i-proposed-topsheet-web-viewport-anchor.mjs` asserts `position:'fixed'` is present — it will need to be REPLACED/retargeted to assert the corrected approach (portal/absoluteFill), else it pins the regression. Flag for the SPEC.
- **Finding 1 fix is component-local** (event header / brand resolve / Toast surfacing) and shares no file with the TopSheet fix → safe to land in the same batch; the two are independent.
- **One batch viable:** F-1 (event index + possibly Toast) and F-2/F-3 (TopSheet only) touch disjoint files. Land together, but each carries its own authed verification gate. The TopSheet fix is the higher-confidence half (mechanism class proven); F-1 should carry the one-tap authed discriminator into IMPLEMENT/TEST so the chosen branch is confirmed live.

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction vs round 1 |
|-------|-------|--------------------------|
| Docs | expo-router web reset `body{overflow:hidden}` (vendor source) | Round-1 F-3 assumed the host scrolls — FALSE |
| Schema/Query | n/a (UI only) | — |
| Code | TopSheet root `position:fixed` on web; event ⋯ gated `brand!==null && manageMenuVisible` | `position:fixed` introduced the trap; mount gate is NOT the F-1 cause (harness) |
| Runtime | real-RN-web harness: `absolute` correct both pages; `fixed` correct in clean tree but trapped by transform/filter/backdrop-filter ancestor → scrim under-covers + panel short; both menu mount patterns render | Round-1 clean-tree harness measured only anchor-top → false PASS; round-1 brand-null F-2 theory unverified by Seth's "no toast" |
| Data | n/a | — |

---

## Repro evidence summary
- **Proven at runtime (real RN-web Chromium, no auth):** expo-router reset = `body{overflow:hidden}`; pre-fix `absoluteFill` anchors correctly on Home AND Hub; `position:fixed` under a transform/filter/will-change/backdrop-filter ancestor shorter than the viewport → scrim shrinks (see-through) + panel anchors short (stops short) — BOTH F-2 symptoms; both event/trip menu mount patterns render the RN-web Modal visibly (F-1 mount theory refuted).
- **NOT reproduced (named blocker = no login):** the live event ⋯ tap and the live authed Hub/Home switcher render — caps F-1 at suspected and F-2's specific trapping-ancestor identity at probable.

## Blast radius / cross-surface
- **In-scope:** Business Web (primary). **Blast-flagged:** Business iOS/Android (TopSheet + event index are shared RN — web-gate the TopSheet fix; verify both native sheets unchanged). **Not touched:** Consumer app, Admin, Buyer-web.

## Invariant impact (flagged; not pre-decided)
- **DEC-080 / DEC-NEW-A** — TopSheet's 2 approved consumers; the fix must keep both correct on web + native.
- **I-PROPOSED (round-1) `i-proposed-topsheet-web-viewport-anchor`** — currently asserts `position:'fixed'`; it ENFORCES the regression and must be retargeted/removed by the SPEC.
- **Const #1 (no dead taps)** — F-1 is a live dead-tap; the fix must end with a visible web affordance on every ⋯ tap.

## Discoveries for orchestrator
1. **[HIGH] Round-1 Batch B was a net regression** — `position:fixed` fixed a non-existent (impossible-under-`overflow:hidden`) problem and introduced a containing-block trap. The strict-grep gate that pins it must be retargeted.
2. **[HIGH] Round-1 F-3 root cause was false** — diagnosed without auth; the original Hub offset is still unproven and must be re-captured authed before the fix claims it.
3. **[MED] `IconChrome.handlePress` silently swallows `onPress` throws in production web** (`IconChrome.tsx:120-130`, `__DEV__`-only log) — a latent dead-tap amplifier across every IconChrome consumer; worth a separate hardening ORCH.
4. **[ENV] Brackets in the worktree path break the web bundler** (expo-router require.context) — reuse the bracket-free detached checkout; carried from round 1.

## Confidence
- **F-2 (TopSheet regression):** probable — mechanism class runtime-proven, exact trapping ancestor unnamed (no auth).
- **F-1 (event ⋯):** suspected — primitive-incompatibility + mount theories REFUTED at runtime; live cause narrowed to two candidates with a one-tap authed discriminator.
- **F-3 (original Hub cause):** round-1 theory ruled out; real cause inconclusive pending auth.

## Recommended next phase
SPEC the corrected TopSheet fix (revert `position:fixed` → `absoluteFill`, OR portal-to-root; retarget the strict-grep gate) — F-2 root is proven enough to spec. For F-1, the SPEC should bind the one-tap authed discriminator as the first IMPLEMENT step and branch the fix on its result; do NOT spec a menu-primitive rewrite (refuted). One batch; per-half authed verification gates.
