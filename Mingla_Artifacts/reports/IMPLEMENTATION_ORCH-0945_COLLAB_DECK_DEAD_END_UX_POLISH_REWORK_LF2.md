# Implementation Rework Report: ORCH-0945 LF-2 iOS System Banner Token Routing

> Date: 2026-05-24
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> Mode: Rework after tester FAIL
> QA input: `Mingla_Artifacts/reports/QA_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH_REPORT.md`
> Prior implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md`
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md`
> Status: implemented, partially verified

## 1. Rework Scope

The remaining blocker was P1 `ORCH-0945-LF-2`: iOS rendered the ORCH-0945 centered system banner and visible `Open travel picks` text, but tapping the visible token left both Ava and Marcus in chat. Android opened Marcus's read-only prefs after relaunch, so this rework stayed focused on iOS-compatible React Native touch/accessibility composition for system banner rows.

Hard guards preserved:

| Guard | Result |
|---|---|
| No broad chat rewrite | PASS - only the system-message render path changed |
| Keep user-attributed banner write path | PASS - `collabDeadEndBannerService.ts` unchanged |
| No weakening read-only prefs/link/debounce contracts | PASS - `PreferencesSheet` and debounce service unchanged |
| No schema/RLS/backend mutation | PASS - no `supabase/` files touched |

## 2. Root Cause And Fix

The parser and downstream route handler already existed, but the live iOS row composition was hostile to token taps:

1. `MessageBubble` made the whole system row one accessibility text element via `accessibilityRole="text"` plus a full-row `accessibilityLabel`, so iOS hierarchy exposed the banner as a combined row instead of a separate link element.
2. `MessageInterface` still wrapped system rows in the normal chat gesture stack (`SwipeableMessage` + `DoubleTapHeart` + outer `TouchableOpacity` for timestamp/long-press), even though system messages are supposed to have no chrome or reactions. That wrapper could win the responder/tap path before the inline token target.

The fix:

| File | Change |
|---|---|
| `app-mobile/src/components/chat/MessageBubble.tsx` | System row now renders `accessible={false}` so the child token is the iOS accessible/pressable element. Token links now expose `testID={\`collab-system-token-${token.type}\`}` and an 8pt `hitSlop` while preserving `accessibilityRole="link"` and `onSystemTokenPress?.(token)`. |
| `app-mobile/src/components/MessageInterface.tsx` | `item.message.isSystem` now returns a direct `MessageBubble` before the normal `SwipeableMessage` / `DoubleTapHeart` / outer `TouchableOpacity` wrapper path. This keeps normal chat gestures unchanged and removes responder competition from system banners. |
| `app-mobile/src/components/__tests__/orch-0945-system-token-ios-routing.test.tsx` | New repo-running regression for the LF-2 contract: system rows bypass normal gesture wrappers, the row does not collapse children into one iOS accessibility target, token links call the route callback, and `open-prefs` still routes self editable vs other read-only with section focus. |

## 3. Spec Traceability

| Criterion | Status | Evidence |
|---|---|---|
| SC-12 token renders as tappable target | PASS local | `MessageBubble` token link remains a `TouchableOpacity` with `accessibilityRole="link"` and direct `onSystemTokenPress` call |
| SC-13 malformed/unrecognized token visible | PASS local | Parser fallback untouched; existing render test still passes |
| SC-14 self vs other prefs routing | PASS local | `MessageInterface` handler unchanged and covered by new LF-2 regression |
| SC-15/SC-16 read-only prefs no-write | PASS local | `PreferencesSheet` untouched; strict-grep read-only gate still passes |
| SC-24 iOS live-fire link routing | PENDING tester | Requires exact Case-B steps 8-12 rerun on iOS |
| SC-25 Android parity | PENDING tester | Shared code path; rerun requested after iOS fix |

## 4. Verification

| Check | Result |
|---|---|
| `node app-mobile/src/components/__tests__/orch-0945-system-token-ios-routing.test.tsx` | PASS |
| `node app-mobile/src/components/__tests__/orch-0945-dead-end-render.test.tsx` | PASS |
| `node app-mobile/src/services/__tests__/collabDeadEndBannerService.test.ts` | PASS, Node typeless package warning only |
| `node app-mobile/src/services/__tests__/orch-0945-banner-adversarial.test.ts` | PASS, Node typeless package warning only |
| `node .github/scripts/strict-grep/i-proposed-orch-0945-dead-end-reason-coverage.mjs` | PASS |
| `node .github/scripts/strict-grep/i-proposed-orch-0945-prefs-sheet-read-only-no-write.mjs` | PASS |
| `node .github/scripts/strict-grep/i-proposed-orch-0945-dead-end-reason-coverage.test.mjs` | PASS |
| `node .github/scripts/strict-grep/i-proposed-orch-0945-prefs-sheet-read-only-no-write.test.mjs` | PASS |
| `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL on pre-existing repo-wide errors in `BoardDiscussion`, locked-plan/ticket/payment/package files; no `MessageInterface.tsx`, `MessageBubble.tsx`, or ORCH-0945 service/test file errors appeared in output |

## 5. Risks And Tester Gate

This is locally verified but still requires live iOS proof because the failure was runtime touch routing. Tester should rerun the exact Case-B steps 8-12 from the QA report using the existing `rerun-20260524-` evidence setup. Expected result: the same user-attributed banner rows still render as centered system/token banners, Ava tapping `Open travel picks` opens Marcus's read-only travel prefs, Marcus tapping the same token opens Marcus's editable travel prefs focused to Travel, rapid notify remains debounced, and Android parity remains PASS.

## 6. Deploy Notes

Mobile-only JS changes. No migrations, no RLS/schema mutation, no edge functions, no Supabase deploy, no Vercel deploy.
