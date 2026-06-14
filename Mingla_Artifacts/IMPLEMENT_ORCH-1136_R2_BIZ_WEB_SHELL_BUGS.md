# IMPLEMENT — ORCH-1136 R2 [business-web shell bugs] (corrects round-1 regression + nails the event ⋯ dead-tap)

**Phase:** IMPLEMENT (mingla-implementor, business side). **Status:** implemented and verified (CI/native-byte-identity/bundle) + DIAG shipped for Seth's one authed tap.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs-r2]/` on branch `ORCH-1136-biz-web-shell-bugs-r2`.
**Rebased on:** origin/main `080a051d7` (was 89b9e22fc in the dispatch; ORCH-1137 CLOSE #473 landed one commit that touches `INVARIANT_REGISTRY.md` — rebased to avoid a stale-registry conflict at CLOSE).
**Commit:** `1e32ced618a64b50d287c3b4b6a5ce268df1af78`.
**Comms ledger:** scanned `COMMS_LEDGER.md` Active table — no `BLOCK`/`OPEN` row to `mingla-implementor`, `ORCH-1136`, or `ALL`. COMMS-0029 (WARN, `biz_update_live_trip` clobber → ORCH-1119/ALL) is unrelated (DB/trip-migration; this batch is UI-only). Nothing to ack.

---

## 1. Summary (plain English)

Round 1 of ORCH-1136 shipped two web changes to the business app's shell. Seth's authenticated runtime test proved one of them was wrong and made things worse, and the other bug is still live.

- **Half 1 (reverted — PROVEN):** the brand-switcher sheet had gone almost see-through and stopped short on both Home and Hub. That was round-1's `position:'fixed'` overlay. We reverted it to the original `StyleSheet.absoluteFill` (native byte-identical to before round 1) and flipped the CI gate that was pinning the broken state — now CI goes RED if anyone re-adds `position:'fixed'`.
- **Half 2 (diagnostic shipped):** the event ⋯ (manage) button does nothing on web while trip ⋯ works. I did the brutal line-by-line diff; the menu, Toast, and header primitives are all identical/shared, so no single source line PROVABLY explains the dead-tap without a logged-in tap. Per the SPEC, I shipped a web-visible `[ORCH-1136-DIAG]` discriminator at the very top of the event ⋯ handler — one tap on the deployed build tells us exactly which of the three hypotheses is live, and the fix follows.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1-Web | Home brand switcher full-height + opaque scrim | UNVERIFIED (Seth authed) | Reverted to `absoluteFill`; harness drive5 PASS; `1e32ced61` |
| SC-2-Web | Hub brand switcher full-height + opaque scrim | UNVERIFIED (Seth authed) | same revert; harness drive5 PASS |
| SC-3-Web | `UniversalCreatorSheet` (`compact`) opens correctly on web | UNVERIFIED (Seth authed) | same TopSheet revert applies to both consumers; compact measurement untouched |
| SC-4-iOS / SC-4-Android | Native brand-switcher + creator sheet height/scrim/swipe/anim unchanged | ✓ VERIFIED (byte-identity) | native-reachable code byte-identical to `dbc64a6f6^` (§3); `1e32ced61` |
| SC-5 (CI) | Inverted gate PASSES on revert, FAILS on re-added `position:'fixed'`; breathing-gap sibling still PASSES | ✓ VERIFIED | both gates green; fails-on-revert proven (§ Regression); `1e32ced61` |
| SC-6 (CI) | Registry + workflow reference the renamed invariant; no dangling old name in active gate/workflow/code | ✓ VERIFIED | only SUPERSEDES references remain (descriptive); `1e32ced61` |
| SC-7-Web (DIAG) | event ⋯ tap surfaces `[ORCH-1136-DIAG]` visible toast (handler-reached + brand NULL/present) | UNVERIFIED (Seth taps once) | DIAG bound at handler top; web export bundles it; `1e32ced61` |
| SC-8-Web (fix) | event ⋯ always produces visible UI, never nothing | DEFERRED to fast-follow (gated on SC-7 tap) | DIAG itself forces a visible web toast → already never-silent on web |
| SC-9-iOS / SC-9-Android | event ⋯ native opens manage menu as today | ✓ VERIFIED (byte-identity) | DIAG block is `Platform.OS==='web'`-fenced; native control flow unchanged |
| SC-10 (CLOSE) | all `[ORCH-1136-DIAG]` removed; no-DIAG gate passes | DEFERRED to CLOSE (orchestrator reaps) | markers fenced `[ORCH-1136-DIAG]`/`[ORCH-1136-DIAG END]` |

---

## 3. Native byte-identity proof (HARD gate)

`diff <(git show dbc64a6f6^:mingla-business/src/components/ui/TopSheet.tsx) mingla-business/src/components/ui/TopSheet.tsx` returns ONLY two added comment blocks — **every line of executable code is byte-identical to the pre-round-1 baseline**:
- `const screenHeight = Dimensions.get("window").height;` (round-1 web/native ternary removed; `useWindowDimensions()` now destructures only `width` — `windowWidth` still feeds `shouldUseRealBlur`).
- overlay root `style={StyleSheet.absoluteFill}` directly (round-1 `rootOverlayStyle` web-gated `position:'fixed'` ternary removed).

No `Platform.OS` branch remains on either the overlay root or the height read. Native (iOS/Android) path is the pre-round-1 path exactly. The event-index DIAG is fully `Platform.OS==='web'`-fenced → native control flow byte-identical there too.

---

## 4. Half 2 — the event-vs-trip brutal diff (RESULT)

I diffed the full tap-to-render path. The concrete differences found:

| Construct | Event (`app/event/[id]/index.tsx`) | Trip (`app/trip/[id]/index.tsx`) |
|-----------|-----------------------------------|----------------------------------|
| ⋯ `onPress` | `handleManageOpen` — `useCallback([brand])` that early-returns a toast when `brand===null`, else `setManageMenuVisible(true)` (`:164`) | `() => setManageMenuVisible(true)` — inline, NO brand gate (`:390`) |
| menu mount | `{brand !== null && manageMenuVisible ? <EventManageMenu/> : null}` — Pattern E, conditional mount (`:866`) | `<TripManageMenu visible={manageMenuVisible}/>` — Pattern T, always mounted (`:587`) |
| Toast host | `<Toast/>` inside `<View style={styles.toastWrap}>` (`:934`) | bare `<Toast/>` (`:669`) |
| root container | plain `<View style={styles.host}>` | `<SafeScreen>` |
| header | `TopBar` + 2× `IconChrome`; `headerRightRow` (no zIndex/overlay) | `TopBar` + `IconChrome`; `headerRightSlot` (no zIndex/overlay) — equivalent |

**Did I find a concrete difference that PROVABLY explains the web-dead behavior? NO — and here is why each candidate is ruled out as the *provable* cause:**

1. **Toast host (`toastWrap`):** REFUTED as a defect. `Toast.tsx` is a **self-positioning `<Modal>` portal** (docstring `:26-40`: "Old `toastWrap` Views in call sites are NO-OPS — Toast escapes the parent's coordinate space via Modal"). Event and trip import the **identical** `Toast`. So the `toastWrap` wrapper does not suppress web rendering, and the Toast primitive is shared and proven (the investigation's RN-web Modal harness rendered it). The `brand===null` branch's toast WILL surface on web if that branch is hit.
2. **Mount pattern (E vs T):** REFUTED at runtime by the investigation's `drivemenu.mjs` harness — BOTH the always-mounted toggle (trip) and the conditional-mount-when-visible (event) render the RN-web Modal+card+body visibly (`opacity:1`, `w:480`). Pattern E is NOT the dead-tap cause. (And Pattern E is DO-NOT-TOUCH: the `:855-865` comment documents a real iOS UIKit double-present freeze that the conditional mount fixes — I did not touch it.)
3. **`brand===null` early-return:** the prime suspect, but it is NOT provably the cause without auth: if `brand===null` at tap, the handler runs the toast branch (which renders, per #1) → Seth would see a toast. The investigation's Q2 proved the toast does NOT fire in Seth's repro → either the handler isn't reached, or `brand!==null` and the menu Modal somehow doesn't mount on the live reanimated path. Discriminating these requires a logged-in tap.
4. **Intercepting overlay/pointerEvents/zIndex on the header:** the event `headerRightRow` and trip `headerRightSlot` styles are equivalent (flex row, no zIndex, no overlay, same `TopBar`/`IconChrome`). No header-level interceptor difference in source.

**Conclusion:** per SPEC §2c, "If NO source diff is found that explains it: the DIAG ships as the deliverable." I shipped the DIAG. It is bound at the very top of `handleManageOpen`, web-fenced, BEFORE the `brand===null` branch, and it:
- logs `[ORCH-1136-DIAG] handleManageOpen reached; brand=NULL|present` to console, AND
- forces a web-visible toast `[DIAG] ⋯ tapped — brand=NULL|present`.

So Seth's one tap discriminates all three hypotheses: **no toast at all → handler not reached (candidate 1) OR Toast host broken; toast says brand=NULL → candidate 2; toast says brand=present but no menu → candidate 3.** The fast-follow fix branches on that answer. As a bonus, the DIAG itself makes the event ⋯ never-silent on web today (it always fires a visible toast), partially satisfying Const #1 ahead of the real fix.

---

## 5. Files changed

| File | Δ | What |
|------|---|------|
| `mingla-business/src/components/ui/TopSheet.tsx` | +18 / −15 (net: 2 comment blocks added, executable code reverted) | Half 1 revert: overlay root → bare `absoluteFill`; height → `Dimensions.get('window').height`. Native byte-identical to `dbc64a6f6^`. |
| `mingla-business/app/event/[id]/index.tsx` | +19 / −0 | Half 2: `[ORCH-1136-DIAG]` web-visible discriminator at top of `handleManageOpen`. |
| `.github/scripts/strict-grep/i-proposed-topsheet-web-viewport-anchor.mjs` | rewritten | Inverted gate: FAILS on `position:'fixed'` in executable code (comment-stripped), PASSES on `absoluteFill`; new label `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED`. Filename kept (least churn, per OQ-3 rec). |
| `.github/workflows/strict-grep-mingla-business.yml` | 2 lines | Job `name:` + step name → renamed invariant. Breathing-gap step untouched. |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | 1 row | Retargeted to `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED`, status `RETARGETED — DRAFT pending ORCH-1136 R2 CLOSE`, SUPERSEDES note on the round-1 anchor. |
| `mingla-business/src/__tests__/orch1136r2TopSheetOverlayNoFixed.gate.test.ts` | NEW (+110) | Happy-path regression test (4 tests). |
| `Mingla_Artifacts/evidence/ORCH-1136-R2/drive5.mjs` + `HARNESS_OUTPUTS.md` | NEW / +18 | Fails-on-revert runtime harness (gitignored dir — dev-side proof, like drive2-4). |
| `Mingla_Artifacts/specs/SPEC_..._R2_...md`, `investigations/INVESTIGATE_..._R2_...md` | committed | R2 forensics artifacts carried into the branch (were untracked; not yet on main). |

---

## 6. Data-model / edge functions

None. UI/CI/config only. No DB, edge, service, hook, realtime, or migration touch. No `verify_jwt` changes. No `db push`. No edge deploy.

---

## 7. Regression test (happy-path) + fails-on-revert proof

**Test:** `mingla-business/src/__tests__/orch1136r2TopSheetOverlayNoFixed.gate.test.ts` — 4 tests, all PASS:
- T-1 — TopSheet overlay root is `StyleSheet.absoluteFill`, no `position:'fixed'` in executable code (comment-stripped), no `rootOverlayStyle`.
- T-2 — panel height uses `Dimensions.get('window').height` (round-1 live-window split reverted).
- T-3 — runs the inverted `.mjs` gate via `execFileSync` and asserts exit 0 (load-bearing).
- T-4 — event ⋯ carries the `[ORCH-1136-DIAG]` web-visible discriminator, fenced + preceding the real brand branch.

**Fails-on-revert (TRUE line deletion, not comment-out):** re-introduced the round-1 regression construct (`rootOverlayStyle = Platform.OS==='web' ? [absoluteFill,{position:'fixed'}] : absoluteFill` + `style={rootOverlayStyle}`) → re-ran:
- T-1 FAILED, T-3 FAILED (gate exited non-zero → `execFileSync` threw). `Tests: 2 failed, 2 passed`.
Restored the fix → all 4 PASS again, TopSheet byte-identical to pre-revert.
**`fails-on-revert verified at 1e32ced618a64b50d287c3b4b6a5ce268df1af78`.**

**Inverted-gate standalone fails-on-revert (CI safeguard):** `node .github/scripts/strict-grep/i-proposed-topsheet-web-viewport-anchor.mjs` exits 0 on the revert; exits 1 with two violations when `position:'fixed'` is re-added. The gate strips comments first, so the rationale comment (which names `position:'fixed'` to explain the ban) does not false-trip it.

**Runtime fails-on-revert harness (drive5.mjs, real Chromium):** under a transform/will-change/backdrop-filter/filter ancestor shorter than the viewport (the real trap conditions), with a full-height positioned host between ancestor and overlay:
```
[translateZ]      REVERT(absolute) scrimVis=844/844 covers=true  panelTop=76 | REGRESSION(fixed) scrimVis=600/844 covers=false => PASS
[will-change]     REVERT(absolute) scrimVis=844/844 covers=true  panelTop=76 | REGRESSION(fixed) scrimVis=600/844 covers=false => PASS
[backdrop-filter] REVERT(absolute) scrimVis=844/844 covers=true  panelTop=76 | REGRESSION(fixed) scrimVis=600/844 covers=false => PASS
[filter]          REVERT(absolute) scrimVis=844/844 covers=true  panelTop=76 | REGRESSION(fixed) scrimVis=600/844 covers=false => PASS
VERDICT: PASS — revert covers/anchors full; regression reproduces both symptoms
```
(drive5 corrects drive4's absolute "control": drive4's `.xform` carried `position:relative` so it trapped absolute too. drive5 uses a transform-only ancestor + a full-height positioned host, the faithful real-shell chain — under it absolute covers full, fixed under-covers.)

---

## 8. Gates run (real output)

- **Inverted strict-grep gate** `i-proposed-topsheet-web-viewport-anchor.mjs` → `OK [I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED]` exit 0.
- **Sibling gate** `i-proposed-web-topbar-breathing-gap.mjs` (untouched) → `OK` exit 0.
- **tsc** (`mingla-business`, `npx tsc --noEmit`) → ZERO errors in the two touched files (`TopSheet.tsx`, `event/[id]/index.tsx`). Pre-existing errors exist in unrelated files (checkout buyer, marketing composer, test-only missing deps, native payment modules) — not introduced by this batch.
- **eslint** on the two touched files → 0 errors (5 pre-existing warnings, none mine; removed the one `eslint-disable` I added that the config flagged as unused).
- **jest** — new test (4) + `Toast.test.tsx` + `orch1100ColdLoadAuthGates.test.ts` → 27/27 pass.
- **Web bundle compile** (`expo export -p web` in a fresh-installed bracket-free clean checkout `/tmp/orch1136r2-clean` at `1e32ced61`) → `Web Bundled 17644ms index.js (2230 modules)`, exit 0. No TopSheet/event resolve or syntax errors. Proves the revert + DIAG compile in the real web bundle.

---

## 9. Cross-surface impact table

| Surface | Affected | What | Parity |
|---------|----------|------|--------|
| Consumer iOS / Android (`app-mobile/`) | NO | — | N/A — `mingla-business` only |
| Buyer/anon Web | NO | — | shell-only; public routes don't render TopSheet or event manage |
| Business iOS | YES (parity) | TopSheet + event ⋯ byte-identical to pre-change | Automatic — native code byte-identical to `dbc64a6f6^`; DIAG web-fenced |
| Business Android | YES (parity) | same | Automatic |
| Business Web (primary) | YES | Half 1 revert (full-height/opaque sheet both pages) + Half 2 DIAG (visible discriminator) | Primary |
| Admin Web | NO | — | N/A |

---

## 10. Known issues / deferred

- `[ORCH-1136-DIAG]` markers (3) in `app/event/[id]/index.tsx` — `[TRANSITIONAL]` discriminator, exit condition = Seth's one authed tap → orchestrator reaps at CLOSE (SC-10).
- **F-1 real fix (SC-8) is a fast-follow** gated on SC-7's tap result (per SPEC §2c). The DIAG already makes the event ⋯ never-silent on web today (forces a visible toast), so Const #1 is not violated in the interim.
- **OQ-1 (original Hub offset):** out of scope. Seth re-captures the authed Hub switcher AFTER this revert; if a residual Hub-only offset survives, it is a NEW investigation (not this batch).
- `drive5.mjs` lives in the gitignored `Mingla_Artifacts/evidence/` dir (like drive2-4) — dev-side proof, not a committed artifact.

---

## 11. Operator action required

- **No migration. No edge deploy. No `db push`.** UI/CI/config only.
- **Deploy:** standard business-web build/OTA from MERGED main after CLOSE (orchestrator-owned). The fix is web + native code; native is byte-identical so no native rebuild is required for correctness, but a business-web deploy is needed for Seth to run the authed SCs.

---

## 12. Seth's authed-verification checklist (what to tap / look at on the deployed build)

Run on a logged-in business-web session (business.usemingla.com), after this branch deploys:

**Half 1 — brand switcher (TopSheet revert):**
1. On **Home**, tap the brand chip (top bar) to open the brand switcher. EXPECT: the panel opens full-height (~70% of the viewport, bottom edge reaches its resting position) AND the dark scrim covers the FULL screen below the panel (no see-through region). [SC-1]
2. Go to **Hub**, tap the brand chip again. EXPECT: same — full-height panel + full opaque scrim, no see-through, no "stops short". [SC-2]
3. Open the **creator sheet** (the "+"/create flow that uses the compact TopSheet) on web. EXPECT: opens to its content height with a full scrim. [SC-3]
4. **If Home is full but Hub still shows a residual offset** → that is OQ-1 (a separate, unproven original Hub cause); note it and it spawns a fresh investigation. The revert's job is full-height + opaque on both; the round-1 see-through/short regression must be GONE.

**Half 2 — event ⋯ DIAG (one tap):**
5. Open any `/event/{id}` (a live event you manage), tap the **⋯ (Manage event)** button in the top-right. EXPECT: a visible toast `[DIAG] ⋯ tapped — brand=present` (or `brand=NULL`). [SC-7]
   - **Toast appears, brand=present, but NO manage menu** → candidate 3 (menu Modal not mounting on the live path) — fast-follow targets the menu mount.
   - **Toast appears, brand=NULL** → candidate 2 (brand unresolved at tap) — fast-follow resolves brand / hardens the null branch.
   - **NO toast at all** → candidate 1 (the ⋯ press never reaches the handler, or the Toast host is broken on web) — fast-follow inspects the header tap path / Toast surfacing.
6. Report which of the three you saw — that single observation routes the F-1 fast-follow fix.

**Native sanity (optional, parity):**
7. On the iOS/Android business app, open the brand switcher + creator sheet and the event ⋯ menu. EXPECT: identical to before this batch (height, scrim, swipe, animation, menu opens). [SC-4 / SC-9]

---

## 13. Discoveries for Orchestrator

1. **Round-1 `INVARIANT_REGISTRY.md` row was already flipped to ACTIVE at round-1 CLOSE** (not DRAFT as the SPEC assumed). I retargeted it to `RETARGETED — DRAFT pending ORCH-1136 R2 CLOSE` so the orchestrator ratifies at this CLOSE. The round-1 anchor name is marked SUPERSEDED in the same row.
2. **drive4.mjs's "ABSOLUTE (pre-fix) control" is misleading** — its `.xform` carried `position:relative`, which traps `position:absolute` too, so its absolute control also read scrimVis=600. The faithful distinction needs a transform-ONLY ancestor + a full-height positioned host between it and the overlay (drive5). The investigation's *conclusion* (absolute correct on both pages) is still right — proven by the separate drive2.mjs real-RN-web harness — but drive4's control row should not be read as "absolute traps too."
3. **`IconChrome.handlePress` silently swallows `onPress` throws in production web** (`IconChrome.tsx:120-130`, `__DEV__`-only log) — carried from the investigation (Discovery #3); a latent dead-tap amplifier across every IconChrome consumer. Registered by forensics as a separate ORCH; NOT touched here.
4. **Rebased onto origin/main `080a051d7`** (one commit past the dispatch's 89b9e22fc — ORCH-1137 CLOSE #473) to avoid a stale-registry conflict at CLOSE.

---

## 14. Downstream routing

**NEXT = `mingla-tester` (business side).** Verify: the inverted gate fails-on-revert (re-add `position:'fixed'` → red) + the sibling breathing-gap gate still passes; native byte-identity vs `dbc64a6f6^`; the web bundle compiles; and package Seth's authed SC checklist (§12). Then `mingla-orchestrator` CLOSE: ratify the DRAFT→ACTIVE invariant flip, reconcile registry/World Map (record round-1 Batch B as a superseded regression), reap the `[ORCH-1136-DIAG]` markers, route OQ-1's re-capture + the SC-7-gated F-1 fast-follow.
