# IMPLEMENTATION — ORCH-0885-A [Desktop Tier 1 — Container + Side Rail] · on-the-fly TopBar iteration

**Dispatched by:** operator (Seth) direct, no spec — "we will be making some changes on the fly".
**Branch:** `Seth` · **Working tree:** `/Users/sethogieva/Desktop/mingla-main`
**Surfaces touched:** business-web-preview (primary visual + interaction change at viewport ≥1024px). business-iOS + business-Android + narrow-web: byte-identical (every change gated by `useResponsiveLayout().isWideDesktop`).
**Status:** `implemented and verified` (automated checks). Manual smoke-test queued for operator.

---

## Goal

Two surgical UI changes on the desktop top bar (web ≥1024px only):

1. **Move Account from the rail to the top bar** — Account icon appears in the TopBar's right cluster after the bell icon. Rail loses its bottom-pinned Account tab.
2. **Move the "+" button to the centre of the top bar** — the existing `extraRightSlot` consumer-prop (which is where pages like `home.tsx` pass their primary CTA "+") renders horizontally centred in the bar via an absolutely-positioned centre slot. Mobile + narrow-web: byte-identical to today (extraRightSlot stays in the right cluster).

---

## Files changed (Old → New receipts)

### `mingla-business/src/components/ui/TopBar.tsx`

**What it did before:** rendered a 2-slot row `[leftSlot: brand|back|none] [rightSlot: default [search, bell] cluster + extraRightSlot, OR full replacement via rightSlot prop]`. No desktop awareness.

**What it does now:** still renders the same 2-slot row on mobile / narrow-web / any `rightSlot=` consumer (byte-identical). Additionally, when `useResponsiveLayout().isWideDesktop === true` AND consumer leaves `rightSlot` undefined (the default-cluster path covering all `leftKind="brand"` consumers per I-37): (a) mounts an absolutely-positioned centre slot spanning the full bar width with `pointerEvents="box-none"` that renders `extraRightSlot` centred horizontally; (b) the right cluster renders `[search, bell, Account-IconChrome]` instead of `[search, bell, extraRightSlot]`. The Account icon (`IconChrome icon="user"`) navigates to `/(tabs)/account` via `useRouter().push`.

**Why:** operator on-the-fly UI iteration on top of ORCH-0885-A [Desktop Tier 1 — Container + Side Rail] desktop redesign — Account belongs in the persistent identity slot (top-right, next to notifications) and the primary CTA belongs in the visual centre of the bar on a wide canvas.

**Lines changed:** ~25 added (imports + hook calls + centre-slot conditional + Account IconChrome + centerSlot style). Zero lines removed from the existing mobile branch.

### `mingla-business/src/components/ui/BottomNav.web.tsx`

**What it did before:** `DesktopRail` rendered primary tabs (Home / Hub / Ari / Blast) at the top of the rail and `accountTab` pinned to the bottom of the rail via a flex spacer.

**What it does now:** `DesktopRail` renders only the primary tabs (Home / Hub / Ari / Blast); the `accountTab` lookup and bottom-pinned render block are removed. The flex spacer is retained so primary tabs stay top-anchored (rail aesthetic preserved). The capsule branch upstream (narrow web + native) still renders ALL 5 tabs including Account — this change is rail-only.

**Why:** Account moved to TopBar (above), so duplicating it in the rail would be visual noise + redundant nav target.

**Lines changed:** ~5 deleted (accountTab lookup + render block), ~7 added (replacement comment block explaining the move). Net: roughly neutral.

---

## Cross-surface impact (Step 3.5 mandatory)

| Surface | Affected? | What changes | Files touched | Parity |
|---|---|---|---|---|
| Consumer iOS | NO | App is `app-mobile/`, not touched | — | — |
| Consumer Android | NO | Same | — | — |
| Buyer-anonymous Web | NO | Routes live outside `(tabs)/`, do not mount BottomNav or TopBar | — | — |
| Business iOS | NO | `isWideDesktop` is always false (requires `Platform.OS === 'web'`) | — | Automatic (shared file, branch never fires) |
| Business Android | NO | Same | — | Automatic |
| Admin Web | NO | `mingla-admin/` is a separate React+Vite app | — | — |
| Business Web preview | **YES** | Wide-desktop layout shows centre-+ and right-Account; rail loses Account | TopBar.tsx, BottomNav.web.tsx | Automatic (both files gate on isWideDesktop) |

---

## Invariants honoured

- **I-DESKTOP-GATE-VIA-HOOK** (NEW per ORCH-0885-A) — TopBar's desktop branch gates exclusively via `useResponsiveLayout()`. No inlined `Platform.OS === 'web' && width >= 1024`. Strict-grep gate verified PASS.
- **I-NO-BOTTOMNAV-OUTSIDE-LAYOUT** (NEW per ORCH-0885-A) — `BottomNav` import unchanged; allow-list intact. Strict-grep gate verified PASS.
- **I-RN-COLOR-FORMATS** — no new colours added in either file; existing tokens reused (the IconChrome handles its own colours via the existing design system).
- **I-37 (TopBar brand consumer no-rightSlot)** — preserved. My new desktop branch fires only when `rightSlot === undefined`. Consumers passing `rightSlot=` (back-routes per the doc) get exactly today's behaviour — I do NOT add an Account icon to those.
- **I-SUB-SHEET-INSIDE-PARENT** — N/A; no sheets touched.
- **I-KEYBOARD-NEVER-BLOCKS-INPUT** — N/A; no inputs touched.
- **I-CROSS-SURFACE-IMPACT** — declared above.

---

## Verification matrix

| Check | Result | Evidence |
|---|---|---|
| tsc `noEmit` | PASS (0 new errors) | Pre-edit baseline: 87 errors. Post-edit: 87 errors. `git stash` + re-tsc returns same 87. The 87 are pre-existing `app/checkout/` + `app/checkout-trip/` + `phone-input` issues unrelated to this work. |
| Strict-grep gate `orch-0885-a-no-bottomnav-on-wide-desktop` | PASS | `cd mingla-business && npm run test:orch-0885-a` → "ORCH-0885-A gate passed — BottomNav allow-list intact + desktop gate hook-only" |
| Jest `useResponsiveLayout.test.ts` | PASS 7/7 | All existing tests still green (this change uses the same hook). |
| Lint | unchanged | (not re-run; no new lint-relevant patterns introduced — both edits use existing import + JSX patterns from the file) |
| Manual smoke on Chrome ≥1440 | DEFERRED | Operator verifies (see smoke-test below) |
| Manual smoke on iOS Sim | DEFERRED | Operator verifies (parity check — should be byte-identical to today) |
| Manual smoke on narrow web (resize <1024) | DEFERRED | Operator verifies (rail collapses to capsule, all 5 tabs return including Account) |

---

## Regression test status

**Deferred to stabilization** — Seth explicitly framed this work as "on the fly … making some changes" which signals iterative UI tweaks. Writing a full provider-mounted TopBar regression test now would be wasteful if the next iteration mutates the same surface. The existing `useResponsiveLayout.test.ts` (7/7 PASS) already exercises the gate boolean that drives this branch.

**Before any PR that closes ORCH-0885-A (or a new sub-ORCH that bundles these tweaks),** a TopBar regression test must land. It should assert: (a) at width 1440 with `extraRightSlot=<TestNode/>` and `leftKind="brand"`, the rendered tree contains the test node inside a centre wrapper AND an "Account" accessibilityLabel IconChrome in the right cluster; (b) at width 800 with same props, the centre wrapper is absent and the test node renders in the right cluster (today's behaviour, no Account icon). This is operator/orchestrator decision territory — flagging here, not authored here.

---

## Discoveries for orchestrator

- **None** — code change was clean and limited to the two declared files.
- Heads-up (pre-existing dirty state in working tree, not from this work): `mingla-business/src/components/experience/MenuSnapInput.tsx` is modified with an `expo-file-system/legacy` → `readAsBase64` refactor that pre-dates this dispatch.

---

## Outstanding open question (operator decision)

Where does this work commit / ship?

- **Option A** — bundle into the ORCH-0885-A PR. Tier 1 already touches `BottomNav.web.tsx` + the desktop shell; this is an iteration on that surface. Acceptable per "narrow exception (operator pre-approved bundles)" rule. Risk: muddies the 0885-A scope vs the original SPEC §11 manifest (which named exactly 6 new + 4 edited files).
- **Option B** — new sub-ORCH (e.g., ORCH-0885-A-2 or ORCH-0887) that closes via its own PR per the one-PR-per-CLOSE rule. Cleaner provenance, slower. Recommended if more iterations follow.

Awaiting operator direction. Working tree is dirty and uncommitted; nothing locked in yet.

---

## Manual smoke-test for operator (replaces no-build verification)

Run these on the same Chrome window already open at `localhost:8081`:

1. **Hard reload** at width ≥1440px (cmd-shift-R).
2. **Confirm centre +**: the "+" button is now horizontally centred in the top bar (between the brand chip on the left and the search/bell/account cluster on the right).
3. **Confirm Account icon in top bar**: a user-icon button (`Account` accessibilityLabel) appears in the top-right cluster immediately after the bell icon. Click it → should navigate to `/account`.
4. **Confirm Account removed from rail**: the left rail now shows only 4 icons (Home / Hub / Ari / Blast) with nothing pinned at the bottom of the rail.
5. **Resize Chrome to <1024px**: rail disappears, bottom-tab capsule re-appears at viewport bottom showing ALL 5 tabs including Account (mobile parity intact). The top bar reverts to today's layout — search/bell/+ on the right, no Account icon, no centre slot.
6. **iOS Simulator (or Android emulator) cold-launch**: home screen should be bit-identical to today — bottom-tab capsule with 5 tabs, search/bell/+ on right, no Account icon in top bar. If anything differs vs main, that's a regression — flag it.

If steps 2 + 3 + 4 pass on web AND step 6 passes on iOS/Android, this iteration is good to commit.

---

*End of report.*
