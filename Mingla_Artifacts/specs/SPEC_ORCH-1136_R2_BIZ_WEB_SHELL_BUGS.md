# SPEC — ORCH-1136 ROUND 2 [business-web shell bugs] (corrects a shipped round-1 fix that regressed)

**Phase:** SPEC (forensics). **Contract only — NO product code in this file.**
**Surface:** `mingla-business` React-Native-Web build (business.usemingla.com), desktop + narrow web. SHARED RN code → native iOS/Android parity is a hard gate on every web change.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs-r2]/` on branch `ORCH-1136-biz-web-shell-bugs-r2` (rebased on origin/main HEAD `89b9e22fc`; round-1 merge `dbc64a6f6` present).
**Drives off:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1136_R2_BIZ_WEB_SHELL_BUGS.md` (F-1 SUSPECTED; F-2/F-3 CONFIRMED ROOT CAUSE, mechanism class runtime-proven) + harness evidence in `Mingla_Artifacts/evidence/ORCH-1136-R2/`.
**Comms ledger:** scanned `COMMS_LEDGER.md` Active table — no `BLOCK`/`OPEN` row to `mingla-forensics`, `ORCH-1136`, or `ALL`. Nothing to ack.

> **Honesty banner (carry into IMPLEMENT and CLOSE).** Round-1 Batch B was a **net regression**: its `position:'fixed'` fix targeted a problem that is **physically impossible** under the expo-router web reset (`body{overflow:hidden}` ⇒ the document/route host never document-scrolls), and it introduced a fixed-containing-block trap. Round-1 F-3's "scrolled Hub host offsets the anchor" root cause was **FALSE**. This SPEC therefore **reverts to pre-round-1 behavior** for the TopSheet overlay. Whether the **original** Hub-only offset (Symptom 3) is even real is **UNPROVEN** — round 1 never had auth. We do **NOT** spec a new Hub-offset fix on an unproven cause; Half-1 restores the known-correct pre-round-1 state and Seth's authed re-capture decides whether Symptom 3 survives.

---

## 1. Executive summary

Round 1 of ORCH-1136 shipped two web changes to the business app's shell. Seth's authenticated runtime test (which round 1 could not perform) proved one change is **wrong and regressed two screens**, and the other bug is **still live**:

- **Half 1 (PROVEN — revert):** the brand-switcher sheet is now **too transparent** (almost see-through) AND **stops short** ("doesn't open all the way down") on **both** Home and Hub. This is a regression introduced by round-1 Batch B (`TopSheet` web `position:'fixed'`). Reverting to the original `StyleSheet.absoluteFill` restores full-height panel + opaque scrim on both pages. The now-wrong strict-grep gate and invariant that **pin** the regression must be retargeted so CI stops enforcing the broken state.
- **Half 2 (SUSPECTED — discriminate, then fix):** the event ⋯ (manage) button does **absolutely nothing** on web — no toast, no menu — while the trip ⋯ works. The primitives are proven identical, so we ship a **diagnostic discriminator** as the first implement step + a brutal line-by-line diff against the working trip path; the corrected handler must **never** be a silent no-op (Const #1).

One batch, two disjoint file sets, per-half verification gates. Native (iOS/Android) stays byte-identical on every web-gated change.

---

## 2. Scope & non-goals

### In scope
- **Half 1:** revert `mingla-business/src/components/ui/TopSheet.tsx`'s web overlay root from `position:'fixed'` (+ the live-window-height change) to the original `StyleSheet.absoluteFill` approach; retarget the strict-grep gate `i-proposed-topsheet-web-viewport-anchor.mjs` + the invariant `I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR` so they no longer pin the regression.
- **Half 2:** a DIAG-instrumented discriminator at the event ⋯ tap path (reaped at close) + a line-by-line source diff vs the working trip path; if a concrete source difference is found that explains the web-dead behavior, mirror trip's working path; ensure the event ⋯ can never be a silent no-op.

### Non-goals (explicitly OUT)
- **A new Hub-offset fix.** Round-1's Hub-offset root cause is disproven; the original Symptom-3 cause is unproven. Do NOT spec or implement a Hub-specific offset correction. Half 1 restores pre-round-1 behavior only; Symptom 3 is re-confirmed by Seth's authed re-capture (Open Question OQ-1) before any new ORCH addresses it.
- **A menu-primitive rewrite for the event ⋯.** The investigation REFUTED the "web-incompatible primitive" theory at runtime (event and trip both → `IconChrome moreH` → `Sheet` → `Sheet.web.tsx` → RN-web `<Modal>`). Do NOT re-architect `EventManageMenu` / `Sheet` / `Sheet.web.tsx`.
- **A portal rewrite of TopSheet.** The investigation offered "portal-to-document-root" as an *alternative* to `absoluteFill`. Because Half 1 is a **revert to a known-correct state** (harness-proven correct on both pages under the real reset), the spec mandates the **pure revert**, NOT a portal. A portal would be NEW architecture on an unproven need (containing-block-immune, but Symptom 3 isn't even confirmed). If Seth's authed re-capture later proves a real positioned/transformed ancestor offsets the sheet, that is a fresh ORCH with its own investigation — not this batch.
- **`IconChrome.handlePress` production error-swallowing hardening** (Discovery #3) — registered as a separate ORCH; out of this batch.
- Consumer app, Admin, Buyer-web. Untouched.

### Assumptions
- The pre-round-1 TopSheet overlay (`StyleSheet.absoluteFill` + `Dimensions.get('window').height`) is the correct baseline. Harness-proven: `absoluteFill` anchors correctly on both Home and Hub under the real expo-router `body{overflow:hidden}` reset.
- Seth runs all authed verification (no login credentials available to the pipeline). Source-only IMPLEMENT/TEST verdicts on the authed surfaces cap at "suspected"; Seth's tap lifts them.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | — | none | N/A — `mingla-business` only |
| 2 | Consumer Android (`app-mobile/`) | NO | — | none | N/A |
| 3 | Buyer/anon Web (`mingla-business` public routes) | NO | — | none | Shell-only changes; public buyer routes don't render TopSheet or event/trip manage |
| 4 | **Business iOS** | **YES (parity gate)** | TopSheet (brand switcher + creator sheet) opens **byte-identical** to pre-change: same height, scrim, swipe, animation. Event ⋯ opens the manage menu exactly as today. | `TopSheet.tsx`, `app/event/[id]/index.tsx` are shared RN — verify NO native behavior change | **Automatic (shared code), web-gated** — every web edit is `Platform.OS==='web'`-fenced; native path reverts to its original branch |
| 5 | **Business Android** | **YES (parity gate)** | Same as iOS. | same shared files | **Automatic, web-gated** |
| 6 | **Business Web (primary target)** | **YES** | Half 1: brand switcher opens full-height with an opaque scrim on **both** Home and Hub. Half 2: event ⋯ always produces visible UI (menu or visible web toast/loading), never a silent no-op. | `TopSheet.tsx` (web branch), `app/event/[id]/index.tsx` (+ possibly `Toast`/`Sheet.web` IF the diff proves it), gate `.mjs`, invariant registry, workflow yml | Primary |
| 7 | Admin Web (`mingla-admin/`) | NO | — | none | N/A |

**Not-covered reasons:** surfaces 1/2/3/7 don't render the business shell TopSheet or the event/trip manage menu. Surfaces 4/5 are blast-flagged (shared RN) and carry explicit native-unchanged parity criteria.

---

## 4. Layered specification

UI-only change. No DB / edge / service / hook / realtime layers. Component layer only, split into the two halves.

### HALF 1 — `TopSheet.tsx` web overlay regression revert (PROVEN)

**File:** `mingla-business/src/components/ui/TopSheet.tsx`

**1a. Revert the root overlay style to bare `StyleSheet.absoluteFill` on all platforms.**
- The `rootOverlayStyle` web/native ternary (`TopSheet.tsx:320-330`, the `Platform.OS === 'web' ? [StyleSheet.absoluteFill, { position: 'fixed' }] : StyleSheet.absoluteFill` block, plus the `// ORCH-1136 F-3:` comment that justifies it) MUST be removed. The root `<View>` (`:333-336`) MUST go back to `style={StyleSheet.absoluteFill}` directly (the pre-round-1 form), or an equivalent that contains **no** `position:'fixed'` and **no** web/native branch on the overlay root.
- Rationale (embed as a code comment): `position:'fixed'` is captured by ANY ancestor with `transform`/`filter`/`backdrop-filter`/`will-change`/`contain`/`perspective` (proven `drive4.mjs`: scrim shrinks to the ancestor box → see-through; panel `top:76` re-anchors inside it → stops short). `position:absolute` (`absoluteFill`) is immune to those ancestors and was harness-proven correct on Home AND Hub under the real `body{overflow:hidden}` reset (`drive2.mjs`). The original problem `position:'fixed'` claimed to fix is impossible under `overflow:hidden`.

**1b. Revert the live-window-height change for the panel.**
- The `screenHeight` web/native split (`TopSheet.tsx:138-144`, the `// ORCH-1136 F-3:` comment + `Platform.OS === 'web' ? windowHeight : Dimensions.get('window').height`) MUST be reverted so the panel height uses the original `Dimensions.get('window').height` on **all** platforms (the pre-round-1 form). `useWindowDimensions()` is still imported and `windowWidth` is still consumed by `shouldUseRealBlur(windowWidth)` (ORCH-1100 blur-kill — DO NOT remove that); only the **height** read reverts. If lint flags an unused `windowHeight` destructure after the revert, drop `height` from the `useWindowDimensions()` destructure (keep `width`).
- Rationale: the live-window-height read was a round-1 secondary short-panel contributor on mobile web (URL-bar height shrink). It rides on the same false F-3 premise; revert to the snapshot for native byte-identity and to remove the compounding short-panel effect.

**1c. Native byte-identity (HARD).**
- After 1a+1b, the **native** code path of `TopSheet.tsx` MUST be byte-identical to its pre-round-1 state: root overlay `StyleSheet.absoluteFill`, panel height `Dimensions.get('window').height * 0.7`. No `Platform.OS` branch may remain on either the overlay root or the height read. Confirm by diffing native-reachable lines against `git show dbc64a6f6^:mingla-business/src/components/ui/TopSheet.tsx` (the pre-round-1-merge file) for those two constructs.

**1d. Scrim, panel, blur, gesture, compact mode — UNTOUCHED.**
- Do NOT touch the scrim color/opacity animation (`:284-286`, `:338-344`), the glass L1–L4 stack, `heightMode="compact"` measurement logic, the pan gesture, Escape/back handlers, or the lazy-mount timer. The regression is exclusively the overlay-root `position` and the height-source; everything else stays.

### HALF 1 — CI / invariant retarget (config layer — name every consumer)

The round-1 gate and invariant currently **REQUIRE** `position:'fixed'` — i.e. they FAIL on the correct (reverted) code. They must be changed so CI enforces the corrected state, not the regression.

**Consumer 1 — `mingla-business/.github/scripts/strict-grep/i-proposed-topsheet-web-viewport-anchor.mjs`** *(repo-root path: `.github/scripts/strict-grep/i-proposed-topsheet-web-viewport-anchor.mjs`)*
- **Action: INVERT and RENAME-IN-PLACE-PURPOSE** (keep the filename to avoid touching the workflow more than necessary — see Consumer 2 note; OR rename — implementor's choice, but if renamed, update Consumer 2 + 3 in the same commit). The gate MUST now assert the **absence** of the regression and the **presence** of the correct revert, on `mingla-business/src/components/ui/TopSheet.tsx`:
  1. **FAIL if `position:'fixed'` (or `position: "fixed"`) appears anywhere in `TopSheet.tsx`** — the regression marker. This is the load-bearing assertion: it FAILS-ON-REVERT-TO-REGRESSION (i.e., if someone re-introduces the `position:'fixed'` overlay, CI goes red).
  2. **PASS requires `StyleSheet.absoluteFill` present** (the overlay root path).
  3. **FAIL if a `Platform.OS === 'web'` gate is co-located within ~400 chars of a `rootOverlayStyle` definition that yields `position:'fixed'`** — i.e., remove the old "must co-locate web gate with fixed" logic entirely; it now asserts the opposite (no web-gated fixed overlay root).
- Rewrite the file's header doc comment to describe the CORRECT contract: "TopSheet's web overlay MUST be a containing-block-immune `position:absolute` (`StyleSheet.absoluteFill`); `position:'fixed'` is BANNED on this overlay because it is captured by transform/filter/backdrop-filter ancestors in the real Home/Hub shell, collapsing the scrim (see-through) and short-anchoring the panel (ORCH-1136 R2 F-2, harness-proven `drive4.mjs`)." Cite the R2 investigation path.
- The gate name string printed (`[I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR]`) MUST change to reflect the inverted meaning — rename the invariant to **`I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED`** (see Consumer 3). Update all `console.log/console.error` labels in the script to the new name.

**Consumer 2 — `.github/workflows/strict-grep-mingla-business.yml`** (job `orch-1136-biz-web-shell-bugs`, lines ~2321-2332)
- The job `name:` string references `I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR`. Update it to the renamed invariant `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED`.
- The step `run: node .github/scripts/strict-grep/i-proposed-topsheet-web-viewport-anchor.mjs` — if the implementor renames the `.mjs` (their choice), update this path; if they keep the filename, leave the path. Either way the job must still execute the (now-inverted) gate.
- **DO NOT touch** the sibling step `i-proposed-web-topbar-breathing-gap.mjs` in the same job — that is a separate round-1 invariant (web top-bar breathing gap) that is NOT a regression and stays in force.

**Consumer 3 — `Mingla_Artifacts/INVARIANT_REGISTRY.md`**
- The registry holds `I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR` (DRAFT, round 1). Retarget its row: rename to `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED`, rewrite the statement to "TopSheet's web overlay root is `position:absolute` (`StyleSheet.absoluteFill`), NEVER `position:'fixed'` (containing-block trap — ORCH-1136 R2)", keep it `DRAFT` (the orchestrator flips DRAFT→ACTIVE at CLOSE — forensics does not flip). Note in the row that it SUPERSEDES the round-1 anchor invariant.
- **NOTE:** the registry edit is a global-index write. Per worktree discipline, forensics normally leaves indexes read-mostly — but this retarget is the deliverable's substance, so it IS in the implementor's allowlist for THIS spec (the orchestrator reconciles the registry at CLOSE). Keep the edit surgical (one row); do not restructure the registry.

> The R2 investigation flagged that `Mingla_Artifacts/WORLD_MAP.md`, `Mingla_Artifacts/TEST_ORCH-1136_BIZ_WEB_SHELL_BUGS.md`, and `Mingla_Artifacts/specs/SPEC_ORCH-1136_BIZ_WEB_SHELL_BUGS.md` also mention the old invariant name. Those are round-1 historical artifacts — **DO NOT** edit them in IMPLEMENT (they record what round 1 did). The orchestrator reconciles the World Map at CLOSE.

### HALF 2 — Event ⋯ web dead-tap discriminator + fix (SUSPECTED)

**Primary file:** `mingla-business/app/event/[id]/index.tsx`. **Reference (read-only) file:** `mingla-business/app/trip/[id]/index.tsx`.

**2a. FIRST IMPLEMENT STEP — bind a DIAG discriminator (marked `[ORCH-1136-DIAG]`, MUST be reaped at close).**
The discriminator is an **unconditional, web-visible** signal at the **very top** of the event ⋯ `onPress`, BEFORE any `brand` check, that discriminates the three live hypotheses. It must surface ALL of:
1. **Did the press reach the handler at all?** — at the first line of `handleManageOpen` (`app/event/[id]/index.tsx:164`, before the `if (brand === null)` at `:170`), emit an UNCONDITIONAL web-visible signal (a forced toast `setToast({visible:true, message:"[DIAG] ⋯ tapped"})` AND a `console.log("[ORCH-1136-DIAG] handleManageOpen reached")`). "Web-visible" is mandatory because Seth runs this on the deployed build and reads the screen, not a console he can't open easily — but ALSO log to console for the inspector path.
2. **Is `brand` null at tap time?** — include the resolved value in the signal: `[ORCH-1136-DIAG] brand=${brand === null ? 'NULL' : 'present'}` (both in the visible toast message and the console log).
3. **Does the Toast actually render on web?** — because the DIAG forces `toast.visible=true` unconditionally, if Seth taps and sees NO toast, that simultaneously proves the round-1 Toast does not surface on web (candidate 2's sub-hypothesis). If he sees the toast, the Toast host works and the cause is upstream (handler not reached → candidate 1) or downstream (brand present, menu didn't mount → candidate 3).
- The DIAG must be a clearly-fenced block (e.g. `// [ORCH-1136-DIAG] reap at CLOSE` … `// [ORCH-1136-DIAG END]`) so the reaper (and the strict-grep no-DIAG gate at close) can find and remove it. It must NOT alter the production control flow beyond surfacing the signal (it precedes, does not replace, the real `if (brand === null)` branch).

**2b. SECOND STEP — brutal line-by-line diff: event ⋯ wiring vs trip ⋯ wiring.**
The implementor MUST diff the full tap-to-render path of event vs trip and look for a concrete source difference that explains web-dead behavior. Compare at minimum:
- **The `onPress` shape.** Event: `onPress={handleManageOpen}` — a `useCallback(..., [brand])` whose body early-returns a toast when `brand===null` and otherwise sets `manageMenuVisible=true` (`:164-175`). Trip: `onPress={() => setManageMenuVisible(true)}` — an inline arrow with NO brand gate (`app/trip/[id]/index.tsx:387-392`). **This is the prime suspect difference.** Determine whether the event handler's early-return (`brand===null`) is silently swallowing the tap on web (brand unresolved at tap time on web) — combined with a Toast that doesn't surface on web → exactly "nothing happens."
- **The menu MOUNT pattern.** Event: `{brand !== null && manageMenuVisible ? <EventManageMenu visible/> : null}` — Pattern E, conditionally mounted only when `brand!==null && visible` (`:866`). Trip: `<TripManageMenu visible={manageMenuVisible} .../>` — Pattern T, ALWAYS mounted, `visible` toggles (`:587-588`). The investigation harness proved BOTH patterns render the RN-web Modal visibly, so Pattern E is NOT the dead-tap cause by itself — but it DOES mean event's menu can't show while `brand===null`, compounding the brand-null path.
- **An intercepting overlay / pointerEvents / zIndex** over the event header right-slot that the trip header lacks (`elementFromPoint` at the moreH center vs trip's).
- **The Toast host.** Event renders `<Toast visible={toast.visible} .../>` inside `<View style={styles.toastWrap} pointerEvents="box-none">` (`:933-941`, `toastWrap` = `position:absolute; top:80; zIndex:100; elevation:12`). Verify the Toast actually surfaces on web at that position (the DIAG forces it visible — if it doesn't show, the Toast host is the defect).

**2c. THIRD STEP — branch the fix on the evidence.**
- **If the diff finds a concrete source difference** that explains the web-dead behavior (a missing/overridden `onPress`, an intercepting overlay/pointerEvents/zIndex, an early-return in `handleManageOpen` that strands the tap, or a web-invisible Toast host), the fix MUST **mirror the trip path's working behavior** for the equivalent construct. Specifically: the corrected event ⋯ tap MUST ALWAYS produce visible UI — either open the manage menu (when brand is resolvable) or show a **visibly-rendering** web affordance (toast/loading) when it is not. The fix may resolve `brand` robustly so the menu mounts, and/or fix the Toast surfacing on web so the `brand===null` branch is never silent, and/or align the mount pattern toward the always-mounted trip form IF the diff proves Pattern E is implicated on the real reanimated path. Do NOT re-architect the `Sheet`/`EventManageMenu` primitive (REFUTED as the cause).
- **If NO source diff is found** that explains it: the **DIAG ships as the deliverable** of this batch's Half 2. Seth taps the deployed build ONCE; the discriminator returns which of the three hypotheses is live; the real fix lands in a **fast-follow** (a SPEC amendment or a thin follow-up implement step in the same ORCH, per the orchestrator). The batch is NOT blocked on the unknown cause — the DIAG + Half 1 ship; the F-1 fix is gated on Seth's one tap.

**2d. Const #1 — no silent no-op (HARD, applies to whatever the final state is).**
Whatever the cause, the corrected event ⋯ handler MUST, on EVERY web tap, produce visible UI: open the menu, OR show a visible web toast/loading state. After the DIAG is reaped, the production handler must still satisfy this: the `brand===null` branch's toast MUST be proven to render on web (if the DIAG showed it doesn't, fixing the Toast surfacing is in scope for the fast-follow), and the `brand!==null` branch must mount the menu. There must be NO path where a tap yields nothing.

---

## 5. Success criteria (numbered, observable, per-surface where parity is manual)

**Half 1 — TopSheet revert**
- **SC-1-Web:** On an authed business web session, open the brand switcher on **Home** → the panel opens full-height (≈70% of viewport, bottom edge reaches its intended position) AND the scrim is opaque/dark across the FULL viewport (no see-through region below the panel). [Seth-verified authed.]
- **SC-2-Web:** Same on **Hub** → full-height panel + full opaque scrim. [Seth-verified authed.]
- **SC-3-Web:** `UniversalCreatorSheet` (TopSheet's other consumer, `heightMode="compact"`) opens correctly on web (content-measured height, full scrim) — DEC-080/DEC-NEW-A: BOTH TopSheet consumers verified on web. [Seth-verified authed.]
- **SC-4-iOS / SC-4-Android:** The brand switcher AND creator sheet open on native with **unchanged** height, scrim, swipe-to-dismiss, and animation vs pre-change (byte-identical native path). [native parity gate]
- **SC-5 (CI):** The retargeted gate `i-proposed-topsheet-web-overlay-no-fixed` (or kept filename) PASSES on the reverted `TopSheet.tsx` and FAILS if `position:'fixed'` is re-introduced on the overlay root. The `i-proposed-web-topbar-breathing-gap.mjs` sibling gate still PASSES (untouched).
- **SC-6 (CI):** `INVARIANT_REGISTRY.md` carries the renamed `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED` (DRAFT); the workflow job name + step reference the new invariant; no dangling reference to the old name in ACTIVE-code/gate/workflow paths (round-1 historical artifacts excepted).

**Half 2 — Event ⋯**
- **SC-7-Web (DIAG, interim):** On an authed web session, tapping event ⋯ produces the `[ORCH-1136-DIAG]` visible toast stating whether the handler was reached and whether `brand` is NULL or present. [Seth taps once.]
- **SC-8-Web (fix):** After the fix (this batch if a diff was found; fast-follow otherwise), tapping event ⋯ on web ALWAYS produces visible UI — the manage menu opens, OR a visibly-rendering toast/loading affordance shows. NEVER nothing. [Seth-verified authed.]
- **SC-9-iOS / SC-9-Android:** Event ⋯ on native opens the manage menu exactly as today (no regression from the DIAG or the fix). [native parity gate]
- **SC-10 (CLOSE):** All `[ORCH-1136-DIAG]` markers are removed; the no-DIAG strict-grep (if one is added per §9) PASSES.

---

## 6. Invariants

| ID | Type | How preserved / established | Verifying test |
|----|------|------------------------------|----------------|
| **I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED** | RETARGETED (was `…WEB-VIEWPORT-ANCHOR`, round 1) — DRAFT | TopSheet web overlay is `position:absolute` (`StyleSheet.absoluteFill`); `position:'fixed'` is BANNED on the overlay root. | Inverted gate `i-proposed-topsheet-web-overlay-no-fixed.mjs`: FAIL on `position:'fixed'` in `TopSheet.tsx`, PASS on `absoluteFill` |
| **DEC-080 / DEC-NEW-A** | PRESERVED | TopSheet's TWO approved consumers (`BrandSwitcherSheet` `fixed-70`, `UniversalCreatorSheet` `compact`) BOTH verified open-correctly on web (full height + scrim) AND native (height/swipe/anim unchanged). | SC-3, SC-4 (manual authed + native) |
| **Const #1 (no dead taps)** | RESTORED on event ⋯ | Corrected event ⋯ always produces visible UI on every web tap. | SC-8 (manual authed) + §9 no-DIAG + the Const-1 path proof |
| **Const #5 (brand list in React Query)** | PRESERVED | No change to brand-list state ownership; the F-1 fix touches event-index handler / Toast surfacing only, never moves brand state to Zustand. | code review: no new Zustand brand store |
| Native byte-identity (web-gate discipline) | PRESERVED | Every TopSheet web change is reverted such that NO `Platform.OS` branch remains on the overlay root / height; event-index DIAG + fix do not change native control flow. | SC-4, SC-9 + diff vs `dbc64a6f6^` |

The round-1 `I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR` is **retired/superseded**; the orchestrator records the supersession at CLOSE.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy, web) | Open brand switcher on Home, authed web | tap brand chip | full-height panel + full opaque scrim | UI/web (Seth authed) |
| T2 (happy, web) | Open brand switcher on Hub, authed web | tap brand chip | full-height panel + full opaque scrim (no see-through) | UI/web (Seth authed) |
| T3 (regression, web) | Re-introduce `position:'fixed'` on overlay root | revert the fix | gate FAILS red (fails-on-revert-to-regression) | CI |
| T4 (parity, native) | Open brand switcher + creator sheet on iOS & Android | tap | height/scrim/swipe/anim identical to pre-change | native |
| T5 (edge, web) | Creator sheet (`compact`) on web | open | content-measured height + full scrim | UI/web (Seth authed) |
| T6 (CI) | Run gate on corrected code | node gate | PASS; sibling breathing-gap gate PASS | CI |
| T7 (CI) | Registry/workflow reference | grep | no dangling old-invariant name in gate/workflow/active-code | CI/manual |
| T8 (DIAG, web) | Tap event ⋯ on authed web with DIAG | tap | visible `[ORCH-1136-DIAG]` toast: handler-reached? brand NULL/present? | UI/web (Seth authed) |
| T9 (fix, web) | Tap event ⋯ post-fix on authed web | tap | menu opens OR visible toast/loading — never nothing | UI/web (Seth authed) |
| T10 (error, web) | Tap event ⋯ when brand unresolved | tap before brand loads | a VISIBLE web affordance (toast/loading), never silent | UI/web (Seth authed) |
| T11 (parity, native) | Tap event ⋯ on iOS & Android | tap | manage menu opens as today | native |
| T12 (CLOSE) | grep for DIAG markers | grep `[ORCH-1136-DIAG]` | zero hits | CI/CLOSE |

---

## 8. Implementation order

1. **DIAG FIRST (Half 2).** Bind the `[ORCH-1136-DIAG]` discriminator in `app/event/[id]/index.tsx` per §2a. (First so Seth can tap the deployed build the moment it lands.)
2. **Half 1 revert.** `TopSheet.tsx`: remove the `position:'fixed'` overlay branch (§1a) + revert the height source to `Dimensions.get('window').height` (§1b); confirm native byte-identity vs `dbc64a6f6^` (§1c).
3. **Half 1 gate invert.** Rewrite `i-proposed-topsheet-web-viewport-anchor.mjs` to the inverted contract (§Half-1 CI Consumer 1).
4. **Half 1 workflow + registry.** Update `strict-grep-mingla-business.yml` job name/step (Consumer 2) + `INVARIANT_REGISTRY.md` row (Consumer 3) to the renamed invariant.
5. **Half 2 diff.** Brutal line-by-line event-vs-trip diff (§2b); if a source difference is found, apply the mirror-trip fix (§2c) ensuring Const #1 (§2d).
6. **Run gates** (`node` the inverted gate + sibling breathing-gap gate) + build the web bundle in the bracket-free detached checkout (`/tmp/orch1136r2-clean`) to confirm no compile break.
7. **Prove fails-on-revert** for both the TopSheet revert (re-add `position:'fixed'` → gate red) and (if a Half-2 source fix landed) its regression test.
8. **Report** for `mingla-tester`; Seth runs the authed SCs.

> If §5 (diff) finds NO explanatory source difference, steps 5/7's Half-2 source fix is deferred to a fast-follow; the DIAG (step 1) + Half 1 (steps 2-4) ship, and Seth's one DIAG tap (SC-7) routes the fast-follow.

---

## 9. Regression prevention (fails-on-revert contract)

- **Half 1 structural safeguard:** the **inverted** strict-grep gate. It MUST FAIL when `position:'fixed'` is present on `TopSheet.tsx`'s overlay (i.e., FAIL when the regression is reverted-back-in) and PASS when the overlay is `StyleSheet.absoluteFill`. This is the inverse of the round-1 gate and is the load-bearing fails-on-revert mechanism. Protective comment in the gate header explains WHY `position:'fixed'` is banned (containing-block trap, harness `drive4.mjs`).
- **Half 1 runtime safeguard (verification gate — fails-on-revert):** a Chromium harness (extend `drive4.mjs` in `Mingla_Artifacts/evidence/ORCH-1136-R2/`) asserting, under a transform/filter ancestor SHORTER than the viewport (the trap conditions): with `position:absolute` (reverted) → scrim covers the full viewport AND the panel anchors at its full height; with `position:'fixed'` (regression) → scrim under-covers + panel short. The harness PASSES on the revert and FAILS on the regression. This is a dev-side proof harness (not CI-blocking), referenced by the tester.
- **Half 2 structural safeguard:** an optional `no-orch-1136-diag.mjs` strict-grep added at CLOSE asserting zero `[ORCH-1136-DIAG]` markers remain in `app/`. If a real source fix lands, its own fails-on-revert test (e.g., the corrected `onPress`/Toast path) is added by the implementor and named in the implement report.
- **Native byte-identity guard:** the diff-vs-`dbc64a6f6^` check on `TopSheet.tsx` native-reachable constructs (overlay root + height) is the safeguard that the revert didn't drift native.

---

## 10. Open questions

- **OQ-1 (Symptom 3 — original Hub offset).** Is the original Hub-only switcher offset (reported pre-round-1) even real? Round-1's cause is disproven; this SPEC does NOT fix it. **Seth must re-capture the authed Hub switcher AFTER the Half-1 revert.** If the panel is full-height + opaque on both Home and Hub, Symptom 3 is RESOLVED by the revert (it was the round-1 regression masquerading) and we close. If a residual Hub-only offset survives the revert, that is a NEW investigation (likely a `position:relative`/transformed Hub-only wrapper between route host and sheet) — a fresh ORCH, NOT this batch.
- **OQ-2 (F-1 cause).** Which of the three hypotheses (handler not reached / brand-null + Toast-invisible-on-web / menu-Modal not rendering) is live? Resolved by Seth's one DIAG tap (SC-7). The fast-follow fix branches on the answer.
- **OQ-3 (gate filename).** Keep `i-proposed-topsheet-web-viewport-anchor.mjs` (minimal workflow churn) or rename to `…-no-fixed.mjs` (clarity)? Implementor's choice; if renamed, update the workflow step path in the same commit. (Recommendation: keep filename, invert contents + labels — least churn.)

---

## 11. Downstream routing

**Next = `mingla-implementor` (business side).** Then `mingla-tester` for the CI/native/source proofs + to package Seth's authed SCs. Then `mingla-orchestrator` CLOSE (flip the DRAFT invariant, reconcile registry/World Map, reap the DIAG, record round-1 Batch B as a superseded regression, route OQ-1's re-capture + OQ-2's fast-follow).

**NEXT HANDOFF — paste into `mingla-implementor` (business side):** Execute `Mingla_Artifacts/specs/SPEC_ORCH-1136_R2_BIZ_WEB_SHELL_BUGS.md` in worktree `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs-r2]/` on branch `ORCH-1136-biz-web-shell-bugs-r2` (rebased on origin/main `89b9e22fc`). Goal: (Half 1) revert `mingla-business/src/components/ui/TopSheet.tsx`'s web overlay from `position:'fixed'`+live-height back to `StyleSheet.absoluteFill`+`Dimensions.get('window').height` (native byte-identical vs `dbc64a6f6^`), and INVERT the strict-grep gate `.github/scripts/strict-grep/i-proposed-topsheet-web-viewport-anchor.mjs` + rename the invariant to `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED` in `INVARIANT_REGISTRY.md` + the workflow job (`strict-grep-mingla-business.yml`); (Half 2) bind the `[ORCH-1136-DIAG]` event-⋯ discriminator FIRST, then brutal line-by-line diff event-vs-trip wiring and apply a mirror-trip fix IF a source difference is found, else ship the DIAG and route the fast-follow on Seth's one tap. Hard constraints: native byte-identical (web-gated), brand list stays React Query (Const #5), event ⋯ never a silent no-op (Const #1), DO-NOT-TOUCH the menu primitive / portal rewrite / a new Hub-offset fix / round-1 historical artifacts. Use the bracket-free detached checkout `/tmp/orch1136r2-clean` for any web bundling (bracket path breaks expo-router require.context). Prove fails-on-revert on the inverted gate. Output: implementation report under `Mingla_Artifacts/` + Seth's authed-verification SC checklist. Downstream: `mingla-tester`, then orchestrator CLOSE.

---

## Scoped allowlist (implementor MAY change ONLY these)

- `mingla-business/src/components/ui/TopSheet.tsx` (Half 1 revert — web overlay root + height source only)
- `mingla-business/app/event/[id]/index.tsx` (Half 2 — DIAG + the mirror-trip fix if a diff is found)
- `.github/scripts/strict-grep/i-proposed-topsheet-web-viewport-anchor.mjs` (Half 1 — invert; may rename)
- `.github/workflows/strict-grep-mingla-business.yml` (Half 1 — job name + step reference for the retargeted invariant ONLY; do NOT touch other jobs/steps)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (Half 1 — the ONE retargeted invariant row only)
- `Mingla_Artifacts/evidence/ORCH-1136-R2/` (extend `drive4.mjs` harness for the fails-on-revert runtime proof)
- `.github/scripts/strict-grep/no-orch-1136-diag.mjs` (NEW, optional at CLOSE — the no-DIAG gate)

## DO-NOT-TOUCH (stop-and-amend before any edit here)

- `mingla-business/src/components/event/EventManageMenu.tsx`, `src/components/trip/TripManageMenu.tsx`, `src/components/ui/Sheet.tsx`, `src/components/ui/Sheet.web.tsx` — menu primitive (REFUTED as the F-1 cause; no rewrite). `Toast.tsx` is touchable ONLY if the DIAG/diff proves the Toast host is the defect — and then via stop-and-amend, not silently.
- `mingla-business/app/trip/[id]/index.tsx` — reference only (read for the diff); NO edits.
- TopSheet scrim/glass/compact/gesture/Escape/back/lazy-mount logic — untouched (only overlay root + height revert).
- `app/_layout.tsx`, `coldLoadAuthGates.ts`, BottomNav, GlassChrome, DesktopCanvas — NOT the fix surface.
- `.github/scripts/strict-grep/i-proposed-web-topbar-breathing-gap.mjs` and every OTHER strict-grep gate/job — untouched.
- Round-1 historical artifacts: `Mingla_Artifacts/specs/SPEC_ORCH-1136_BIZ_WEB_SHELL_BUGS.md`, `Mingla_Artifacts/TEST_ORCH-1136_BIZ_WEB_SHELL_BUGS.md`, `WORLD_MAP.md` — orchestrator reconciles at CLOSE, NOT the implementor.
- Consumer app, Admin, Buyer-web, any DB/edge/service/hook — out of scope.

A SPEC amendment (in-file append or `SPEC_AMENDMENT_ORCH-1136_R2_*.md`) is REQUIRED before touching anything outside the allowlist.
