# TEST — ORCH-1101 · Ari Chat Interface + Composer Overhaul

**Skill:** mingla-tester (Claude) · **Date:** 2026-06-07
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1101-[ari-chat-design-overhaul]/` · branch `ORCH-1101-ari-chat-design-overhaul`
**Surface:** Mingla Business app only (`mingla-business`) — iOS / Android / desktop web. Phone web `/ari` route-blocked (ORCH-1095) → out of scope.
**Mode:** TARGETED · **Verdict:** **PASS** (1 P2 found + fixed in-branch; 0 open P0/P1)

---

## 0. Comms ledger

Read `COMMS_LEDGER.md` on entry. No `BLOCK`/`WARN` row targets `tester`, `ORCH-1101`, or `ALL`. The one OPEN row (COMMS-0001) is scoped to ORCH-0955. No new cross-ORCH discovery; nothing written.

---

## 1. Verdict summary

| | |
|---|---|
| **Verdict** | **PASS** |
| P0 | 0 |
| P1 | 0 |
| P2 | 1 — append-only CI gate failed because the `[TEST-MOD-APPROVED ORCH-1101]` token was buried below HEAD by two later doc commits. **Fixed in-branch** by the tester commit (token now in HEAD body; gate green). |
| P3 | 0 |
| P4 | 2 — measured contrast 4.99:1 (spec conservatively said 4.6); pre-existing unrelated `tsc` errors elsewhere in mingla-business (not introduced here). |
| Sim evidence | Web leg **proven** (react-native-web + react-dom/server DOM render captured §4). iOS/Android legs **probable** (native bug-fix branches byte-identical to origin/main; operator Fast-Refreshed the live worktree on his physical iPhone via Metro 8129; no iOS sim could be booted without contending for that live session). |
| Regression tests | implementor `orch_1101_ari_chat_composer_overhaul.test.ts` (14/14, fails-on-revert independently re-verified: 10/14 red @ `129df41e1`) · tester adversarial `orch_1101_ari_composer_overhaul.adversarial.test.ts` (10/10, 9/10 fail-on-revert). Both in `git diff origin/main...HEAD`. |

---

## 2. Scope guard (HARD CHECK) — PASS

`git diff origin/main...HEAD --name-only` = 17 files: the 14 §7 handoff files + 2 ORCH-1057 test mods + 1 new implementor test (the tester adversarial test is the 18th, added this turn). **No edits leaked** into `useAgentChat`, `agentChatService`, `useConfirmPendingAction`, any `supabase/functions/*`, any agent prompt, `AiDisclosureModal`, or `ConversationDrawer`. The lone grep hit (`MultiSelectPrompt.tsx`) is a NEW §5 presentational component, not a leaked edit.

---

## 3. Bug A + Bug B — independent verification

### Bug B (send "blob" on web) — FIXED, proven

`InputBar.tsx` send button:
- `react-native-svg` import **DELETED** — the only `react-native-svg` string in the file is a docblock comment (no import, no JSX element). The original origin/main `InputBar.tsx` had 4 SVG references; HEAD has 0 active ones.
- The send disc is a single `Animated.View` (`styles.sendBtn`) with **exactly one JSX child** — a lucide `<ArrowUp size={18} color="#ffffff" strokeWidth={2.75} />` (tester ADV-2 asserts child-count === 1 structurally).
- `sendBtn` fill = `ariPalette.userBubble` (#a85a44, opaque), `borderRadius: 17`, `overflow:'hidden'` on the Android/web branch.
- **iOS ember shadow-glow preserved** (`Platform.select.ios`: shadowColor ember / opacity 0.4 / radius 7), the scale + glow-pulse send micro-interaction preserved, `useReducedMotion()` gate preserved.

### Bug A (composer bottom gap on web) — FIXED, proven

- Input one-line tokens: `fontSize 14 / lineHeight 19 / paddingVertical 6 / minHeight 30 / maxHeight 120`.
- Host `minHeight 48` (was 52); web `paddingVertical` → 6.
- Web `<textarea>` gets `rows={1}` + `{height:'auto', resize:'none', overflowY:'auto'}` via the `Platform.OS==='web'` `WEB_INPUT_PROPS` spread.
- `AriChatScreen.tsx` inputWrap `paddingBottom`: the web branch (`spacing.sm`) short-circuits FIRST, ahead of the native keyboard/`BOTTOM_NAV_CLEARANCE_PX` math — web can never reach the phantom 80px (tester ADV-3 asserts ordering). The **native branch is byte-identical to origin/main** (`keyboardHeight + spacing.sm` up / `Math.max(insets.bottom, spacing.md) + BOTTOM_NAV_CLEARANCE_PX` down).

---

## 4. Web leg — PROVEN (react-native-web render)

The mingla-business jest harness is `ts-jest` / `testEnvironment:node` (no jsdom / no RN render preset / no `@types/react-dom`), so a jsdom render test could not run in-harness. Instead the tester rendered the EXACT web composition through `react-native-web` + `react-dom/server.renderToStaticMarkup` in node. Captured DOM:

```
SEND DISC:
<div style="width:34px;height:34px;border-top-left-radius:17px;...;
  background-color:rgba(168,90,68,1.00);overflow-x:hidden;overflow-y:hidden;
  align-items:center;justify-content:center">
    <div style="width:18px;height:18px"></div>   ← glyph slot; NO <svg>, NO gradient
</div>

COMPOSER:
<textarea rows="1" ... style="height:auto;resize:none;overflow-y:auto;
  min-height:30px;line-height:19px;padding-top:6px;padding-bottom:6px"></textarea>
```

This is dispositive for both web bugs:
- **Bug B** — the send disc is a flat round `<div>` with an opaque `rgba(168,90,68,1.00)` fill and `overflow:hidden`; its only child is a plain element. There is no `<svg>` / `<radialGradient>` / `<circle>` for react-native-web to mis-composite → **cannot blob**.
- **Bug A** — the composer is a single-row `<textarea rows="1">` with `height:auto` + `resize:none`; the browser-default multi-row intrinsic height that opened the gap is gone, and the screen-side web `paddingBottom` is `spacing.sm` (no 80px).

---

## 5. §5 presentational response components — render-state + crash audit

`QuickReplyChips` (CHOICE mode), `ClarifyingCard`, `MultiSelectPrompt`, `ResponseCard`:
- Each handles all named states via explicit `state ===` branches (default / typed-selected / loading / disabled / submitted; ResponseCard adds error) — no state path falls through to `undefined`.
- a11y: `accessibilityRole` (radio/radiogroup/checkbox/button/summary/text), `accessibilityState` (selected/checked/disabled), and `accessibilityLabel` on every interactive node.
- `GlassChrome` containers (carry their own Android opaque ≥0.92 fallback); `ActivityIndicator` for loading; lucide single-path glyphs; `ResponseCard` shimmer skeleton gated behind `useReducedMotion()`.
- All four primaries use `ariPalette.userBubble` (no white-on-flame regression).
- `tsc --noEmit` clean on all four files → they compile and cannot crash on a type/undefined-prop path. (They are presentational shells with no live consumer yet — the downstream smart-Ari ORCH wires data/callbacks.)

---

## 6. HARD CHECKS

| Check | Result |
|---|---|
| No leaked edits (useAgentChat / agentChatService / useConfirmPendingAction / edge fns / prompts / AiDisclosureModal / ConversationDrawer) | **PASS** (§2) |
| All existing `accessibilityLabel`s preserved | **PASS** — "Ask Ari", "Send message to Ari", "Show example prompts", ToolEditForm field labels verbatim; new nodes add role+label+state |
| ANDROID_GLASS_USES_OPAQUE_FALLBACK on every new fill | **PASS** — opaque #16181b / #a85a44 / GlassChrome ≥0.92, `overflow:'hidden'`, shadow/elevation iOS-only via `Platform.select`; zero new translucent rgba/hsla fills in the diff |
| Reduced-motion gates intact | **PASS** — send micro-interaction `useReducedMotion()` verbatim; ResponseCard shimmer gated |
| Existing ari suite green | **PASS** — 54/54 across 5 suites (44 prior + 10 new adversarial) |
| `tsc --noEmit` on touched files | **PASS** — zero errors in any ORCH-1101-touched file incl the new test |
| Contrast white-on-#a85a44 ≥ 4.5:1 (AA) | **PASS** — computed 4.99:1 (spec said 4.6, conservative) |

---

## 7. P2 finding (fixed in-branch) — append-only CI gate was red

**What:** `.github/scripts/test-append-only-check.js` reads the override token ONLY from the **HEAD commit body** (`git log -1`). The implementor placed `[TEST-MOD-APPROVED ORCH-1101]` in commits `ab51cf104` + `b86a20290`, then committed the implementation report + design spec on top (`84f3ebe78`, `ddfd741a0`), pushing the token below HEAD. The gate therefore FAILED ("None found") on the two legitimate ORCH-1057 test deletions — which would block the required CI check at merge.

**Why the ORCH-1057 deletions are legitimate (not weakening):** §4.2 deletes the react-native-svg radial-gradient send circle, so the old assertions that asserted opaque SVG `<Stop>` opacities and a `<Circle>` fill are now *factually wrong*. The replacements assert a flat opaque `ariPalette.userBubble` disc + a no-SVG-composition ban (the opaque-fill invariant is preserved, restated) and deepen the glyph to 18/2.75. No assertion was softened.

**Fix (in-branch this turn):** the tester's adversarial-test commit (`9815c5ec6`) carries `[TEST-MOD-APPROVED ORCH-1101]` in its body. Re-run → `Append-only check: 4 passed, 0 failed`. No source change; the deletions were always correct, only the token's commit position was wrong.

---

## 8. Adversarial regression test (tester deliverable)

**Path:** `mingla-business/src/components/ari/__tests__/orch_1101_ari_composer_overhaul.adversarial.test.ts`
**Run:** `npx jest orch_1101_ari_composer_overhaul.adversarial --runInBand` → **10 passed, 10 total**.
**Different angle than the implementor's happy-path (string presence/absence on a fixed tag list):**
- ADV-1 — bans ANY two-layer composition (`<Path>`/`<G>`/`<LinearGradient>`/`<Image>`/`<ImageBackground>`/backgroundImage), not just the 4 named SVG tags the happy-path checks.
- ADV-2 — boundary: the send disc must contain EXACTLY ONE JSX child element (the blob root cause was glyph + sibling fill).
- ADV-3 — ORDERING: the web `paddingBottom` branch must precede the native 80px math (string presence can't catch a reordered ternary).
- ADV-4 — long-multiline height invariant: a finite `maxHeight` cap + web `resize:none` so a pasted paragraph can't reopen the dead space.
- ADV-5 — no send/primary fill may be translucent rgba/hsla/opacity (broader than the one block the happy-path checks).
- ADV-6 — COMPUTED WCAG AA: parses `hsl(10,55%,42%)` → sRGB and asserts contrast(white, fill) ≥ 4.5:1 (catches a silent lightness tweak; not a string match).
- ADV-7 — sibling-leak guard: no non-orb ari component may compose a `<RadialGradient>`/`url(#ari-send-fill)` fill.

**Fails-on-revert:** against origin/main source, **9 of 10 fail** (only ADV-4's maxHeight survives — origin already capped height). Restored → 10/10 green.

---

## 9. Completion condition (`/goal`) — machine-verified

1. Every independent test green — ari suite **54/54**; adversarial **10/10**; implementor **14/14** (re-verified). ✓
2. `tsc --noEmit` clean on every touched file (incl new test). ✓ (pre-existing unrelated repo errors flagged P4, not in scope)
3. Both regression tests in `git diff origin/main...HEAD --name-only`; adversarial attacks a different angle; implementor fails-on-revert re-verified (10/14 red @ `129df41e1`). ✓
4. UI/runtime legs: web **proven** (DOM render §4); iOS/Android **probable** — native bug-fix branches byte-identical to origin/main + operator physical-iPhone Fast-Refresh; no iOS sim bootable without contending for the live Metro 8129 session. ✓ (documented deferral)
5. Zero open P0, zero open P1 (the P2 gate failure was fixed in-branch). ✓

---

## 10. Discoveries for orchestrator

- **Append-only token placement is positionally fragile** (gate reads HEAD-only). Any ORCH that modifies a prior test should put the `[TEST-MOD-APPROVED ORCH-####]` token in the FINAL commit on the branch, or accept that a later docs/report commit will bury it. Consider hardening the gate to scan the full `base...HEAD` range for the token. Fixed for ORCH-1101 in-branch.
- **Pre-existing mingla-business `tsc` errors** (checkout buyer.tsx, marketing/ComposerV2, payments/*.native, DraftEvent fixtures) predate ORCH-1101 and are unrelated — candidate for a typecheck-cleanup ORCH.
- The four §5 components are presentational shells with no consumer — they dead-code-eliminate until the downstream smart-Ari ORCH wires them into `MessageList` item kinds (owns data/callbacks + single-live-at-tail lifecycle).

---

## 11. Routing

Back to **orchestrator REVIEW gate**. Do NOT deploy / OTA / merge (per dispatch). One thing for Seth to eyeball before merge: a desktop-web build to confirm the two web fixes feel right (the RNW DOM render proves the mechanism; an operator eyeball confirms the pixels).
