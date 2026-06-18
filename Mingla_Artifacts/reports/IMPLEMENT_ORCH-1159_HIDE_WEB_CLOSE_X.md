# IMPLEMENT — ORCH-1159 [hide public-page "X" close button on web]

**Status:** implemented and verified (behavioral predicate + source-contract; native unaffected by construction).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1159-[hide-web-close-x]/` · branch `ORCH-1159-hide-web-close-x` · rebased on origin/main HEAD `a58f46ffa`.

---

## 1. Summary

On the public event, trip, and experience pages, the floating "X" (close) button is now HIDDEN on web and KEPT on native (iOS/Android). The Share button and all other chrome render on every surface, web included. Native behavior is byte-identical to before.

**Key finding — the dispatch's render-site map was STALE.** The dispatch named three independent render sites (an `IconChrome icon="close" testID="orch-0961-public-event-close"` in `mingla-business/src/components/event/PublicEventPage.tsx` ~464-482, a close `ChromeButton` in `OfferingChrome.tsx`, and an `IconChrome` in `app/exp/.../[experienceSlug].tsx` ~247-257). Two of those no longer exist: the event page and experience route were refactored (ORCH-1138 + ORCH-1117 era) to delegate `onClose`/`onShare` down to shared FOUNDATION renderers. The close button on **all** public event (ticketed + RSVP), trip, and experience pages is now rendered by exactly **one** owner — `packages/offering-rendering/OfferingChrome.tsx` (lines ~154-162), reached via `packages/offering-rendering/ParallaxCoverShell.tsx`.

**Approach (scoped opt-in, per the dispatch's "scope the gate so only the public-offering use is affected" guard).** A NOT-named fourth consumer — the public BRAND page (`packages/brand-rendering/PublicBrandPage.tsx`) — also renders its X through the same `OfferingChrome`. An unconditional gate in `OfferingChrome` would have hidden the brand-page X on web too (out of ORCH-1159 scope). So instead of an unconditional gate, I added an opt-in prop `hideCloseOnWeb` threaded `OfferingChrome ← ParallaxCoverShell ← {the 4 public-offering FOUNDATION render components}`. The brand page does NOT opt in → keeps its X on web (current behavior). The decision is a single-owner pure predicate `shouldRenderCloseButton(hideCloseOnWeb, Platform.OS)`.

---

## 2. SPEC success-criteria coverage

The dispatch carried the contract inline (no separate SPEC file). Mapped to its stated requirements:

| SC | Requirement | Status | Commit |
|----|-------------|--------|--------|
| SC-1-Web | Public EVENT page X hidden on web | ✓ | (see §commit) — `hideCloseOnWeb` on `FoundationEventPreview` + `RsvpPublicBody` → `OfferingChrome` predicate |
| SC-1-Native | Public EVENT page X kept on iOS/Android | ✓ | predicate returns `true` for non-web |
| SC-2-Web | Public TRIP page X hidden on web | ✓ | `hideCloseOnWeb` on `TripPreview` (FoundationTripPreview) |
| SC-2-Native | Public TRIP page X kept on native | ✓ | predicate |
| SC-3-Web | Public EXPERIENCE page X hidden on web | ✓ | `hideCloseOnWeb` on `ExperiencePreview` (FoundationExperiencePreview) |
| SC-3-Native | Public EXPERIENCE page X kept on native | ✓ | predicate |
| SC-4 | Share button stays on ALL surfaces incl. web | ✓ | Share/Mute never gated; only the close slot is conditional |
| SC-5 | Close handler logic UNCHANGED | ✓ | no `onClose`/handler edits |
| SC-6 | No new web-detection helper invented | ✓ | uses the package's existing `Platform.OS === "web"` idiom |
| SC-7 | Non-public-page consumer (brand page) not regressed | ✓ | brand page does not opt in; test asserts it |

---

## 3. Files changed

| File | Δ |
|------|---|
| `packages/offering-rendering/closeButtonVisibility.ts` | **NEW** (+~30 lines) — RN-free single-owner predicate |
| `packages/offering-rendering/OfferingChrome.tsx` | +~20 / -1 — `hideCloseOnWeb` prop, `showClose` guard around the close button + right-pin placeholder, import predicate |
| `packages/offering-rendering/ParallaxCoverShell.tsx` | +~10 — `hideCloseOnWeb` prop + forward to OfferingChrome |
| `packages/offering-rendering/index.ts` | +3 — export `shouldRenderCloseButton` + `PlatformOSValue` |
| `mingla-business/src/components/event/FoundationEventPreview.tsx` | +4 — `hideCloseOnWeb` on ParallaxCoverShell |
| `mingla-business/src/components/event/RsvpPublicBody.tsx` | +3 — `hideCloseOnWeb` |
| `mingla-business/src/components/trip/TripPreview.tsx` | +3 — `hideCloseOnWeb` (FoundationTripPreview) |
| `mingla-business/src/components/experience/ExperiencePreview.tsx` | +3 — `hideCloseOnWeb` (FoundationExperiencePreview) |
| `packages/offering-rendering/__tests__/orch_1159_hide_web_close_x.test.ts` | **NEW** — regression test (8 cases) |

**Web-detection idiom used:** `Platform.OS === "web"` (from `react-native`) — the exact idiom already used inside `OfferingChrome.tsx` (`Platform.select` for the Android glass fallback) and `ParallaxCoverShell.tsx`, and surfaced via `useResponsiveLayout().isWeb` (`Platform.OS === "web"`). No new helper invented; the predicate just wraps the existing idiom for single-owner testability.

---

## 4. Data-model changes applied

None. Pure client-side render gating. No migrations, no RLS, no schema.

## 5. Edge functions touched

None.

---

## 6. Regression tests added

**Path:** `packages/offering-rendering/__tests__/orch_1159_hide_web_close_x.test.ts` (Deno test — the established convention for this package; siblings `orch_1157_*.test.ts` use the same `https://deno.land/std` import + readTextFile source-contract style).

- **(1) BEHAVIORAL** — executes the real `shouldRenderCloseButton` predicate: web+opt-in → hidden; iOS/Android+opt-in → shown; not-opted-in (brand page) → shown on all surfaces.
- **(2) SOURCE-CONTRACT** — OfferingChrome gates ONLY the close button (Share/Mute never platform-gated); ParallaxCoverShell forwards the prop; the 4 public pages opt in (and keep `onShare`); the brand page does NOT opt in.

**Run output (8/8 pass):**
```
ok | 8 passed | 0 failed (18ms)
```

**fails-on-revert verified at commit `a58f46ffa` (worktree base)** via TRUE LINE DELETION (not comment-out): I replaced the predicate body `!(hideCloseOnWeb && platformOS === "web")` with `true` in `closeButtonVisibility.ts`, re-ran → `FAILED | 7 passed | 1 failed` (the "HIDES the close button on web" behavioral assert failed at test:39). Restored → `8 passed | 0 failed`. (The fix lines are part of this ORCH's commit; the deletion proof was performed in the working tree against base `a58f46ffa`.)

Append-only: this is a NEW test file; no existing test modified or deleted.

---

## 7. Old → New receipts

### packages/offering-rendering/OfferingChrome.tsx
- **Before:** always rendered the close `ChromeButton` (CloseGlyph) as the first row child on every platform.
- **Now:** renders the close button only when `shouldRenderCloseButton(hideCloseOnWeb, Platform.OS)` is true; otherwise an empty placeholder keeps the space-between row pinning Share/Mute to the right. Share + Mute unchanged.
- **Why:** SC-1..SC-4 — hide the X on web for opted-in public pages without touching Share or native.

### packages/offering-rendering/ParallaxCoverShell.tsx
- **Before:** built `chrome = <OfferingChrome ... />` with no web-close control.
- **Now:** accepts `hideCloseOnWeb` (default false) and forwards it verbatim to OfferingChrome.
- **Why:** the shell is the single mount point for chrome; the opt-in must pass through it.

### closeButtonVisibility.ts (NEW)
- **Now:** RN-free pure predicate `shouldRenderCloseButton(hideCloseOnWeb, platformOS)`. Single owner of the decision; enables a true behavioral Deno test without mounting RN.

### FoundationEventPreview.tsx / RsvpPublicBody.tsx / TripPreview.tsx / ExperiencePreview.tsx
- **Before:** mounted ParallaxCoverShell with the default (X shown on web).
- **Now:** pass `hideCloseOnWeb` → X hidden on web for these public pages only.
- **Why:** SC-1/2/3 per page; scopes the gate to event/trip/experience and leaves the brand page (SC-7) untouched.

---

## 8. Cross-surface impact

| Surface | Affected? | What changes / why not |
|---------|-----------|------------------------|
| Consumer iOS | No | Consumer app renders its own detail screens, not these business-app public pages. |
| Consumer Android | No | Same. |
| Buyer/anonymous Web | **YES** | The floating X disappears on public event/trip/experience pages; Share stays. |
| Business iOS | No (byte-identical) | Native predicate returns true → X still renders. |
| Business Android | No (byte-identical) | Same. |
| Admin Web (adjacent) | No | Does not render these pages. |
| Business Web preview (adjacent) | **YES** | Same web build as buyer web — X hidden there too (intended). |

Parity is **automatic** (shared `OfferingChrome` + the predicate). The only manual element is the per-page opt-in (4 call sites), all in this commit.

---

## 9. Smoke result

- Behavioral predicate executed across web/iOS/android × opt-in/opt-out (8/8 Deno tests pass).
- `deno check closeButtonVisibility.ts` → exit 0.
- `tsc --noEmit` on the predicate module → exit 0.
- Full `mingla-business` jest suite run BEFORE and AFTER my changes is byte-identical (98 failed / 409 passed suites, 172 failed / 3928 passed tests) — my change introduces **zero new jest failures** (the pre-existing failures are worktree-state drift, see §12).
- No device/simulator render performed (pure conditional render of an existing button; native path provably unchanged because the predicate returns true for non-web). Recommend the tester eyeball web (X gone, Share present) + native (X present) on all three page types.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` markers introduced.
- The legacy event variant (`packages/event-rendering/PublicEventPage.tsx`, used only for cancelled / password-gate events) renders its OWN inline close button (role-gated to the organizer), NOT via OfferingChrome. It was NOT in the dispatch's three sites and is out of scope; its X is not affected. Flagged for awareness only.

---

## 11. Operator action required

- No migration, no edge-function deploy.
- Web ships via Vercel from MERGED main (buyer web cannot be OTA'd — deploys only from main). Business-app native change is a pure-JS conditional → OTA-able once merged, but native behavior is unchanged so an OTA is optional.
- Route to orchestrator REVIEW → tester.

---

## 12. Discoveries for Orchestrator

1. **The ORCH-1159 dispatch's render-site map was STALE** (two of three named sites no longer exist; all three collapse to the shared `OfferingChrome`). Implemented against the real render tree. No scope change — same three public pages, plus the explicit decision to LEAVE the brand-page X on web (out of scope).

2. **Pre-existing broad jest failure baseline in this worktree:** the full `mingla-business` jest suite reports **172 failed / 3928 passed (98 suites failed)** on CLEAN origin/main HEAD `a58f46ffa` — identical before and after my change. These appear to be worktree-state drift (e.g. `PublicBrandPage.ve4.test.ts` asserting `isVerifiedVenue ? <VerifiedBadge />` source that isn't present in this checkout's package state). Unrelated to ORCH-1159; flagging for a worktree-freshness / source-reconciliation check.

3. **Stale isolation gate:** `mingla-business/src/components/trip/__tests__/offeringRenderingIsolation.orch1138.test.ts` (test 71, "depends only on @mingla/event-rendering + RN + svg") walks `packages/offering-rendering/__tests__/` and FAILS on clean HEAD because the existing ORCH-1157 Deno tests import `https://deno.land/std...` (not in its allow-list). My new Deno test follows the same established convention. The gate should exclude `__tests__/` (test files legitimately import Deno std). Pre-existing; not modified (append-only). Recommend a follow-up to exclude `__tests__/` from that walk.

4. **Acked COMMS-0025 (WARN, OPEN):** ORCH-1117 ask #6 folds the Sound/Mute pill move into the SAME shared chrome region (`PublicEventPage.tsx` close+share row). No file collision — ORCH-1117 edits the `EventCoverMedia` audio-control position and the legacy `packages/event-rendering/PublicEventPage.tsx`; ORCH-1159 edits the shared `OfferingChrome` close button + the FOUNDATION page opt-ins. Disjoint files. Factored in; appended ack.
