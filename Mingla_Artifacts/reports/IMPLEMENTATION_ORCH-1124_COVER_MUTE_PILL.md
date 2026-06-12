# IMPLEMENTATION — ORCH-1124 [cover-video Sound/Mute pill unreachable under floating chrome]

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1124-[cover-mute-pill]/` on branch `ORCH-1124-cover-mute-pill`
**Base:** rebased on `origin/main` (up to date; includes ORCH-1117 floating Buy bar)
**Status:** implemented and verified (web/source + jest; fails-on-revert proven by true line deletion)
**Commits:** `fd1de15b4` (fix), `7befb09f0` (test reconcile + regression, carries `[TEST-MOD-APPROVED ORCH-1124]`)

---

## 1. Summary

The cover-video Sound/Mute pill on the public event page (buyer/anon web `/e/...` + business app) was
unreachable: the shared `PublicEventPage` overrode `EventCoverMedia`'s audio-pill position to
`"topRight"`, planting the pill directly under the top-right floating close+share chrome — a dead tap.
The fix drops that one override so the pill inherits `EventCoverMedia`'s `"bottomRight"` default (the
same position the consumer app already uses). No new layout, no Buy-bar change, no consumer-app touch.

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| SC-1 | Drop the `"topRight"` override; pill inherits `bottomRight` default | ✓ | `fd1de15b4` |
| SC-2 | `bottomRight` is confirmed the `EventCoverMedia` default, styled `right:14/bottom:14` within the cover | ✓ (verified line 386 + style block 606-609) | n/a (no change needed) |
| SC-3 | Short-page collision check vs ORCH-1117 floating Buy bar = **NO collide** | ✓ | (analysis below) |
| SC-4 | Stale `topLeft`/`audioControlTopOffset` test assertions reconciled to reality | ✓ | `7befb09f0` |
| SC-5 | Buyer/anon web + business app (shared package); consumer app NOT touched | ✓ | `fd1de15b4` |
| SC-6 | Happy-path regression test asserting `bottomRight` (fails-on-revert) | ✓ | `7befb09f0` |

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `packages/event-rendering/PublicEventPage.tsx` | −1 prop / +6 comment lines | Removed `audioControlPosition="topRight"` override (line 592); replaced with an explanatory comment |
| `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` | −7 / +43 | Reconciled 5 stale `publicPageSource` audio assertions (+ removed the now-unused `publicPageSource` binding in that one test) to target the shared package and assert NO top override; added an ORCH-1124 `describe` block with 2 passing regression tests |

## 4. Data-model changes applied

None. Pure UI / shared-component prop change. No migration, no RLS, no edge function.

## 5. Edge functions touched

None.

## 6. Regression tests added

**Path:** `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
**New describe block:** `ORCH-1124 cover-video audio pill clears top-right floating chrome` (2 tests, both pass).
- `public event page does not pin the cover audio pill to a top position` — asserts the shared
  `PublicEventPage.tsx` contains `showAudioControl` but NOT `audioControlPosition="topRight"` / `"topLeft"`.
- `EventCoverMedia defaults the audio pill to bottomRight, styled within the cover` — asserts the
  default `audioControlPosition = "bottomRight"` + the `audioControlBottomRight` style (`right: 14` / `bottom: 14`).

Also reconciled (not new): `event cover videos use inline browser-safe playback props` — was FAILING on
origin/main (asserted strings against the wrong file); now passes against the shared package and asserts
the no-top-override reality.

**fails-on-revert verified at `4ffc47731`** (pre-commit working state) via TRUE LINE DELETION of the
fix (re-added `audioControlPosition="topRight"` to `packages/event-rendering/PublicEventPage.tsx`):
the `public event page does not pin the cover audio pill to a top position` test FAILED
(`Expected substring: not "audioControlPosition=\"topRight\""`). Restored the fix → both ORCH-1124
tests PASS again. Confirmed post-commit at HEAD `7befb09f0` (closing diff `git diff origin/main...HEAD --name-only`
shows both the fix and the test file).

## 7. Old → New receipts

### packages/event-rendering/PublicEventPage.tsx
**Before:** `<EventCoverMedia ... showAudioControl={...} audioControlPosition="topRight" />` — the
Sound/Mute pill rendered at `top:14/right:14` inside the cover, directly beneath the top-right floating
close+share chrome (`floatingChrome` at `top: insets.top + spacing.md`), an unreachable dead tap.
**After:** the `audioControlPosition` prop is removed; `EventCoverMedia` applies its own
`"bottomRight"` default (`right:14/bottom:14` within the cover), clearing the chrome.
**Why:** SC-1 / root cause. **Lines:** −1 prop, +6 comment.

### mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts
**Before:** `event cover videos use inline browser-safe playback props` asserted `showAudioControl`,
`audioControlLabel="event cover video"`, `audioControlPosition="topLeft"`,
`audioControlTopOffset={insets.top + 60}`, `isLegacyUnsafeEventCoverVideoUrl` against
`src/components/event/PublicEventPage.tsx` — strings that no longer exist there (that file is a thin
adapter delegating to the shared package), so the test was failing on origin/main.
**After:** those assertions target `packages/event-rendering/PublicEventPage.tsx` and assert the
current reality (`showAudioControl` present; no `topRight`/`topLeft` override). New ORCH-1124 regression
block added.
**Why:** SC-4 / SC-6 (stale-test reconcile + fails-on-revert guard). **Lines:** −7, +43.

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS | No | Already `bottomRight` via `app-mobile/src/components/expandedCard/ImageGallery.tsx:134`; untouched |
| Consumer Android | No | Same shared consumer path; untouched |
| Buyer/anonymous Web (`/e/...`) | **Yes** | Mute pill moves top-right → bottom-right; now tappable. Shared package — parity automatic |
| Business iOS | **Yes** | Same shared `PublicEventPage`; automatic |
| Business Android | **Yes** | Same shared `PublicEventPage`; automatic |
| Admin Web (adjacent) | No | Does not render `PublicEventPage` |
| Business Web preview (adjacent) | **Yes** | Same shared component; automatic |

Parity is **automatic** across all affected surfaces (single shared `packages/event-rendering` change).

## 9. Short-page collision check (SC-3) — result: NO collide

- **ORCH-1117 floating Buy bar** (`FloatingOfferingBar`) is **host-mounted** as a sibling overlay
  AFTER `<SharedPublicEventPage>` in `mingla-business/src/components/event/PublicEventPage.tsx`
  (lines 457-462), pinned at the **page base** (host overlay; `contentBottomInset={96 + insets.bottom}`
  reserves scroll clearance). It is NOT inside the cover and NOT inside the scroll content.
- **The mute pill** is `position:absolute` at `bottom:14 / right:14` **inside the heroBox** (the cover
  container), which is the FIRST element inside the scroll content (`packages/event-rendering/PublicEventPage.tsx`
  hero block, lines 578-610). At scroll-top the heroBox occupies the TOP of the viewport, so the pill
  sits in the upper region of the screen.
- On a SHORT page (whole page fits without scrolling), the hero is still at the TOP and the Buy bar at
  the BOTTOM of the viewport — different vertical zones. The pill is bounded by the cover's own bottom
  edge, never the page base where the bar lives.
- **Conclusion:** they do not overlap. The pill remains tappable and unobstructed. No new layout invented.

## 10. Verification matrix / gates

- **jest** `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`: target test
  (`inline browser-safe playback props`) now PASS; both ORCH-1124 regression tests PASS. Suite totals
  15 passed / 5 failed — the 5 failures are **pre-existing** (origin/main has 6; I fixed 1, introduced 0).
  The 5 are out of contract scope: 4 assert against `src/components/event/CreatorStep4Cover.tsx`
  (upload-copy/picker-flow drift), 1 (`gated by active surface intent`) asserts moved strings against the
  adapter — same staleness family but a DIFFERENT test outside the named SC-4 lines. Verified by running
  the origin/main test file in this worktree: 6 fail on origin/main vs 5 on this branch.
- **tests-append-only gate** (`node .github/scripts/test-append-only-check.js`): PASS — `6 deleted lines;
  override token [TEST-MOD-APPROVED ORCH-####] present in commit body`.
- **tsc:** the `EventCoverMedia.tsx` "cannot find module 'react'" + implicit-any errors are pre-existing
  cross-package tsconfig artifacts (27 identical errors on origin/main), NOT introduced here. The fix
  removes an OPTIONAL prop (`audioControlPosition?:`) — type-neutral by construction; zero new errors
  reference `PublicEventPage.tsx` or `audioControlPosition`.

## 11. Operator action required

- None for DB/edge (no migration, no edge function).
- Route back to orchestrator for REVIEW → tester dispatch. No deploy/merge/OTA performed.
- This is a pure-JS shared-package change → ships via `eas update` (per-platform) at close per
  `project_ota_deferred_until_new_build` (no native rebuild needed). Web/buyer surface deploys with the
  normal web pipeline.

## 12. Discoveries for Orchestrator

- **Pre-existing test rot in `eventCoverMedia.test.ts` (5 still-failing tests, NOT in this ORCH's scope).**
  Four assert against `src/components/event/CreatorStep4Cover.tsx` strings that drifted
  (`EVENT_COVER_UPLOAD_LIMIT_COPY`, `mediaTypes: ["images"]`, `mediaDisplayError`, etc.); one
  (`event cover video playback is gated by active surface intent`) asserts `usePathname` /
  `mediaPlaybackActive` / `router.replace("/(tabs)/hub/events"` against the thin adapter — those moved to
  the shared package, same staleness pattern I fixed for the sibling test. These fail on origin/main today.
  Recommend a small follow-up ORCH to reconcile the remaining 5 (each a `[TEST-MOD-APPROVED]` reconcile).
- **`isLegacyUnsafeEventCoverVideoUrl` and `audioControlLabel="event cover video"`** no longer exist
  anywhere in `packages/event-rendering/` — the legacy-unsafe-URL helper was removed in a prior refactor
  and the audio label default is now `"cover video audio"`. Confirms the deleted assertions were dead.
