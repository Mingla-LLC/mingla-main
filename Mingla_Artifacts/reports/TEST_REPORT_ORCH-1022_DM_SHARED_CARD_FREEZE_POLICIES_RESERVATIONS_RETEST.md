# TEST REPORT — ORCH-1022 DM Shared Card Freeze + Single-Card Buttons Retest

Date: 2026-05-31
Skill: tester+codex
Mode: RETEST
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1022-[dm-shared-card-freeze-policies-reservations]`
Branch: `ORCH-1022-dm-shared-card-freeze-policies-reservations`
Implementation commit reviewed: `0526d59a0 fix: gate expanded card schedule picker`

## Verdict

PASS.

The prior P1 failure is resolved. The iOS Schedule date/time picker now reports its open/close state to `ExpandedCardModal`; the parent root sheet includes that state in `anyChildModalOpen`, swallows synthetic root closes during the picker, and resets the picker gate on expanded-card close. The repo-running ORCH-1022 regression now catches the old schedule-picker gap and fails against the previous implementation.

Runtime evidence: Seth smoke-tested the ORCH-1022 dev build served from the worktree on `exp://172.20.9.90:8084` and reported "passes" after the Metro symlink/cache issue was cleared and the iOS bundle completed. That manual receipt covers the DM expanded-card flow, Policies & Reservations, and iOS Schedule picker paths requested in the smoke test. I could not independently drive the live app because local simulator/emulator shell probes still hang, but the prior P1 is covered by source inspection, current regression pass, fail-on-revert proof, and Seth's dev-build runtime receipt.

## Findings

No P0/P1 findings.

### P2 — Independent Android runtime live-fire remains unavailable

Evidence:

- `adb devices` showed `emulator-5554 device`.
- `adb shell pm list packages | rg 'mingla|expo' || true` hung until killed.
- This is the same Android tooling class recorded in the prior tester report.

Impact:

The ORCH-1022 source change affects shared expanded-card gating and Android's native date/time picker branch calls the same visibility helper, but the helper only notifies the parent on iOS. Android runtime remains lower-risk than the original iOS RN-modal collision, and the shared Policies & Reservations parent browser gate is structurally covered.

Required follow-up:

No implementation rework. If orchestrator wants full three-leg runtime closure before merge, run one Android manual smoke: expand a DM shared single card, tap Policies & Reservations, close the browser, and confirm the card remains responsive.

### P2 — Existing ORCH-0910 curated DM card failures remain out of scope

Evidence:

- The previous ORCH-1022 tester report recorded red ORCH-0910 curated payload checks.
- This rework touched modal ownership only: `ExpandedCardModal.tsx`, `ActionButtons.tsx`, and the ORCH-1022 structural gate.

Impact:

Do not fold the separate curated chat payload failures into ORCH-1022 close. They remain separate routing unless Seth explicitly scopes them here.

## Claim Table

| Claim | Status | Evidence |
| --- | --- | --- |
| iOS schedule picker state participates in parent gating. | Verified | `ActionButtons.tsx:54`, `:106-122`, `:269`, `:346`, `:411`, `:465`, `:680-684`; `ExpandedCardModal.tsx:1408-1419`. |
| Synthetic root closes are swallowed while schedule picker is open. | Verified | `ExpandedCardModal.tsx:1421-1428` includes `isSchedulePickerOpen` in the guard. |
| Schedule picker gate resets when expanded card closes. | Verified | `ExpandedCardModal.tsx:1462-1476` resets `setIsSchedulePickerOpen(false)`. |
| Both curated and single-card ActionButtons wire schedule picker gating. | Verified | Curated: `ExpandedCardModal.tsx:695-730`, `:1295-1308`, `:1862-1876`; single card: `:2200-2219`. |
| Policies & Reservations browser remains parent-owned. | Verified | `ExpandedCardModal.tsx:1868-1871`, `:2215-2218`, `:2241-2247`; structural gate G-04 passed. |
| ORCH-1022 regression covers the original modal class and the tester-found schedule gap. | Verified | `npm run test:orch-1022` passed 8/8; fail-on-revert against `HEAD^` failed 5/8 including G-07/G-08. |
| ORCH-0908 chat card tags are not regressed. | Verified | `npm run test:orch-0908-chat` passed 6/6. |
| Dev-build runtime smoke passes. | Verified by Seth manual receipt | Seth reported "passes" after opening the worktree dev build on `exp://172.20.9.90:8084`. |

## Platform Matrix

| Platform | Result | Notes |
| --- | --- | --- |
| iOS app-mobile | PASS | Source/regression verified; Seth's dev-build smoke receipt covers DM expansion, Policies & Reservations, and iOS Schedule picker. |
| Android app-mobile | CONDITIONAL / low-risk residual | Structural shared browser gate verified; Android native picker branch does not open the iOS RN-modal sheet. Independent emulator shell remained unusable. Optional manual Android smoke noted above. |
| Web/browser | N/A | ORCH-1022 scope is native app expanded-card modal behavior. |
| Business/admin/buyer surfaces | N/A | No business/admin/buyer files changed; implementation report scoped them out. |

## Commands Run

Passed:

```bash
cd app-mobile && npm run test:orch-1022
```

Output excerpt:

```text
PASS G-01 child overlay aggregate covers all RN Modal child surfaces
PASS G-02 root sheet is gated while child overlays are open
PASS G-03 synthetic root closes are swallowed during child overlays
PASS G-04 curated policies no longer mount a nested browser modal
PASS G-05 curated lightbox is parent-owned like the browser overlays
PASS G-06 overlay state is reset when the expanded card closes
PASS G-07 schedule picker reports visibility to the root overlay gate
PASS G-08 all expanded-card ActionButtons wire schedule picker gating
ORCH-1022 expanded-card modal gating regression passed.
```

Passed:

```bash
cd app-mobile && npm run test:orch-0908-chat
```

Output excerpt:

```text
PASS T-01/send-persists-structured-mentions
PASS T-01/bubble-renders-card-tags
PASS T-04/non-participant-filter
PASS T-08/limit-enforcement
PASS T-15/trim-card-payload
PASS I-PROPOSED-CHAT-MENTION-MUTE-RESPECTED
ORCH-0908 chat mention/card-tag regression passed: 6/6
```

Fail-on-revert proof:

```bash
tmp=$(mktemp -d /tmp/orch1022-rework-proof.XXXXXX)
mkdir -p "$tmp/app-mobile/src/components/expandedCard" "$tmp/app-mobile/src/components" "$tmp/app-mobile/scripts/ci"
git show HEAD^:app-mobile/src/components/ExpandedCardModal.tsx > "$tmp/app-mobile/src/components/ExpandedCardModal.tsx"
git show HEAD^:app-mobile/src/components/expandedCard/ActionButtons.tsx > "$tmp/app-mobile/src/components/expandedCard/ActionButtons.tsx"
cp app-mobile/scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs "$tmp/app-mobile/scripts/ci/"
(cd "$tmp/app-mobile" && node ./scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs)
```

Output excerpt:

```text
FAIL G-01 child overlay aggregate covers all RN Modal child surfaces
FAIL G-03 synthetic root closes are swallowed during child overlays
FAIL G-06 overlay state is reset when the expanded card closes
FAIL G-07 schedule picker reports visibility to the root overlay gate
FAIL G-08 all expanded-card ActionButtons wire schedule picker gating
ORCH-1022 expanded-card modal gating regression failed: 5/8
```

Blocked by existing baseline:

```bash
cd app-mobile && npx eslint src/components/ExpandedCardModal.tsx src/components/expandedCard/ActionButtons.tsx scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs
```

Output excerpt:

```text
ActionButtons.tsx
  27:39  error  Unable to resolve path to module '@/src/services/deviceCalendarService'  import/no-unresolved
ExpandedCardModal.tsx: existing warnings only
ActionButtons.tsx: existing warnings only
orch-1022-expanded-card-modal-gating-check.mjs: unused eslint-disable warning
```

Runtime environment probes:

```bash
adb devices
xcrun simctl list devices booted
~/.maestro/bin/maestro --version
```

Output excerpt:

```text
emulator-5554 device
iPhone 17 Pro (...) (Booted)
iPhone 17 Pro Max (...) (Booted)
iPhone 17e (...) (Booted)
2.5.1
```

Blocked runtime probes:

```bash
adb shell pm list packages | rg 'mingla|expo' || true
xcrun simctl get_app_container 17091E60-C3B6-4167-980D-60C348E177F6 com.mingla.app.v2
```

Both commands hung until killed.

## Regression Coverage Assessment

Adequate for close. The ORCH-1022 script is repo-running via `npm run test:orch-1022`, covers the parent overlay aggregate, root-sheet gating, synthetic close swallow, curated browser/lightbox ownership, schedule-picker visibility callback, both expanded-card ActionButtons call sites, and overlay reset. The fail-on-revert proof confirms the tester-found schedule gap would return if `0526d59a0` were reverted.

## Close Readiness

PASS for orchestrator close review. No product-code rework is required. Optional Android manual smoke can be requested before merge if orchestrator wants a full runtime parity receipt, but the original blocker is resolved and covered by automated regression plus Seth's dev-build runtime pass.
