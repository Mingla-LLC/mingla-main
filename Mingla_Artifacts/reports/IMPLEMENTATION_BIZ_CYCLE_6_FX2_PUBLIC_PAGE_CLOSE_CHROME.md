# Implementation — ORCH-BIZ-CYCLE-6-FX2 — Founder-aware close chrome on PublicEventPage

**Status:** implemented, partially verified
**Verification:** tsc PASS · runtime UNVERIFIED (awaits user smoke)
**Scope:** 1 file, ~50 LOC delta (lift + add)
**Spec:** [prompts/IMPL_BIZ_CYCLE_6_FX2_PUBLIC_PAGE_CLOSE_CHROME.md](Mingla_Artifacts/prompts/IMPL_BIZ_CYCLE_6_FX2_PUBLIC_PAGE_CLOSE_CHROME.md)

---

## 1 — Mission

After publish, the founder lands on `/e/{brandSlug}/{eventSlug}` with no UI affordance to leave. Add a founder-aware close (X) IconChrome that routes to `/(tabs)/events`, visible only when the visitor is a member of the brand that published this event. Buyers / unauthenticated / cross-brand visitors see clean Share-only chrome.

## 2 — Spec deviation (called out before implementing)

The spec assumed the floating chrome was rendered at page-level above all variants ("single change covers all 7 states"). In practice, the chrome lived inside `PublishedBody` only, leaving `CancelledVariant` and `PasswordGateVariant` with no chrome at all. The spec's INTENT was clearly page-level (its own words). Per Prime Directive #2 (spec law) — flagged in chat before coding, then implemented the spec INTENT (lift to page-level) rather than the literal misread.

This means `onShare` prop dropped from `PublishedBody` (consequential cleanup, scope-justified by the lift).

## 3 — Old → New Receipts

### `mingla-business/src/components/event/PublicEventPage.tsx`

**What it did before:**
- Floating chrome (Share IconChrome only) lived inside `PublishedBody` sub-component (lines 382-394). It was rendered for `published` / `past` / `pre-sale` / `sold-out` variants only.
- `CancelledVariant` and `PasswordGateVariant` had no chrome (no Share, no Close).
- Founder publishing landed on the public URL with no way to dismiss / return to organiser dashboard. iOS swipe-back / browser back went to "before wizard" because publish uses `router.replace`.

**What it does now:**
- Floating chrome lifted to page-level (top-level `PublicEventPage`), rendered after the variant ternary so it floats over ALL 7 variants (including cancelled + password-gate) via `position: absolute` + `zIndex: 3`.
- Chrome contains: conditional close (X) on left when `ownsThisEvent` is true; always-visible Share on right.
- `ownsThisEvent` computed via `useAuth()` (signed-in check) + `useBrandList()` (brand membership): `user !== null && userBrands.some(b => b.id === event.brandId)`. Forward-compat with B-cycle backend: today `useBrandList()` returns all stub brands so the check effectively means "isSignedIn"; when real auth ships and brand list filters to user-owned brands, the check becomes precise.
- Close routes to `/(tabs)/events` via `router.replace()` — works identically on iOS, Android, Web.
- `onShare` prop removed from `PublishedBody` (consequence of the lift — page-level handles share now).

**Why:**
Cycle 6 spec scoped `PublicEventPage` as buyer-only and missed that mingla-business is the organiser app. The same surface serves buyers (web shared URLs) AND founders (post-publish + later visits). Brand-membership is the precise discriminator; gates the close affordance correctly across all 4 visitor types.

**Lines changed:** ~50 net (added ~25 LOC for hooks + chrome JSX + comments; removed ~13 LOC of in-PublishedBody chrome + onShare props/args; ~12 LOC docstring + comment updates).

## 4 — Spec Traceability

| Spec criterion | Implementation | Status |
|----------------|----------------|--------|
| Add `useRouter` import | Added at line 49 (sibling to existing `Head` import) | PASS |
| Add `useAuth` import | Added at line 60 (under designSystem block, sibling to currentBrandStore) | PASS |
| Add `useBrandList` import (with `Brand` type) | Combined with existing `Brand` type import at line 61 (`useBrandList, type Brand`) | PASS |
| Use hooks in component body (`useRouter`, `useAuth`, `useBrandList`) | Added at lines 171-173 | PASS |
| Compute `ownsThisEvent` via `useMemo` | Added with proper deps `[user, userBrands, event.brandId]` | PASS |
| Add `handleClose` calling `router.replace("/(tabs)/events")` | Added with `useCallback` and `[router]` deps | PASS |
| Replace empty `<View />` placeholder with conditional close + share | Implemented at page-level chrome (NOT inside PublishedBody — see §2 spec deviation) | PASS — lift broader than spec text |
| Use `close` icon (NOT `chevL`) | Confirmed — `icon="close"` | PASS |
| Use `accessibilityLabel="Close"` | Confirmed | PASS |
| Update line 382 comment | Replaced both inside-PublishedBody (now stub pointer) AND added page-level comment | PASS |
| Add "Platform notes" docstring section | Extended existing FX1-added Platform notes block with founder-aware close paragraph | PASS |
| Do NOT use Platform.OS as gate | Confirmed — `ownsThisEvent` is the gate; works uniformly across platforms | PASS |
| Do NOT change wizard publish flow | edit.tsx untouched | PASS |
| Do NOT use `chevL` / `router.back()` / `router.push` | Confirmed | PASS |
| Do NOT add chrome to variants separately | Page-level lift is the cleaner inverse — single chrome covers all 7 variants | PASS — better than spec |

## 5 — Verification

| Check | Method | Result |
|-------|--------|--------|
| tsc strict | `cd mingla-business && npx tsc --noEmit` | EXIT=0 |
| Page-level chrome covers all 7 variants | Code inspection — chrome is sibling to variant ternary inside `<View style={styles.host}>`, with `position: absolute` + `zIndex: 3` floating above all variant content | PASS by construction |
| `PublishedBody` no longer references `onShare` | grep `onShare` in file → only top-level `handleShare` + page-level chrome use it | PASS by construction |
| Web SEO `<Head>` block preserved | Code inspection — Head block at lines 259-285 untouched (FX1 gate intact) | PASS by construction |
| iOS founder publish → close routes to Events tab | Awaits user smoke | UNVERIFIED |
| Web founder URL → close routes to /(tabs)/events | Awaits user smoke | UNVERIFIED |
| Web buyer (signed out) → no close button | Awaits user smoke | UNVERIFIED |
| Cross-brand auth → no close button | Awaits user smoke (manual setup needed) | UNVERIFIED |

## 6 — Invariant Verification

| Invariant | Preserved? |
|-----------|-----------|
| I-11 format-agnostic ID resolver | Y (untouched) |
| I-12 host-bg cascade | Y (untouched) |
| I-13 overlay-portal contract | Y (untouched) |
| I-14 date-display single source | Y (untouched) |
| I-15 ticket-display single source | Y (untouched) |
| I-16 live-event ownership separation | Y (untouched) |

No invariants govern chrome ownership. Lifting chrome to page-level matches cleaner separation-of-concerns but doesn't violate or strengthen any registered invariant.

## 7 — Parity Check

N/A — single-platform organiser app. Founder behavior is unified across iOS / Android / Web via the `ownsThisEvent` gate (which is platform-agnostic).

## 8 — Cache Safety

N/A — no React Query / Zustand state shape changes. `useAuth` and `useBrandList` are read-only consumers of existing state.

## 9 — Regression Surface

Adjacent features most likely to break:

1. **Share button behavior across all variants** — `handleShare` now wired at page-level (was inside PublishedBody). Verify Share works identically on published / past / pre-sale / sold-out (was already wired) AND newly on cancelled / password-gate (gained Share for the first time as part of the lift).
2. **Cancelled variant layout** — gained chrome floating above its content. The cancelled body has `paddingTop: insetsTop + spacing.lg` so content starts well below the chrome's `top: insets.top + spacing.sm`. Should not collide.
3. **Password-gate variant layout** — same as cancelled; gained chrome. Verify no overlap with the gate card which uses `paddingTop: insetsTop + spacing.lg`.
4. **`ownsThisEvent` flicker on cold start** — during the brief moment auth is loading, `user` is null → close button hidden by default. Once auth hydrates (~100ms), button appears. Spec accepts this pop-in flicker.
5. **Toast positioning** — toast wrap was at page-level already; chrome is also page-level now. Verify toast still appears above chrome (toastWrap should have higher zIndex or render after chrome — already the case via existing styles).

## 10 — Constitutional Compliance

| Principle | Affected? | Status |
|-----------|-----------|--------|
| #1 No dead taps | Marginal — added a new tap (close) that has clear behavior | OK |
| #2 One owner per truth | YES, strengthened — chrome ownership lifted to single page-level owner instead of variant-scoped | OK |
| #3 No silent failures | No | — |
| #6 Logout clears | Indirect — when user signs out, `useAuth` returns `user: null` → close button disappears → buyer view. Correct behavior. | OK |
| #7 Label temporary fixes | Inherited — FX1 TRANSITIONAL marker still present; no new TRANSITIONALs added | OK |
| #8 Subtract before adding | YES — removed in-PublishedBody chrome BEFORE adding page-level chrome (no double-render) + dropped unused `onShare` prop | OK |
| Others (4, 5, 9, 10, 11, 12, 13, 14) | No | — |

## 11 — Transition Items

No new TRANSITIONAL markers added by this fix. The pre-existing `TRANS-CYCLE6-FX1-1` (iOS native skips Head metadata) is unchanged.

The forward-compat of `ownsThisEvent` resolving to "isSignedIn" today (because `useBrandList` returns all stub brands) is documented in inline comments + docstring. It will become precise automatically when B-cycle wires real auth — no code change needed in this file.

## 12 — Discoveries for Orchestrator

**D-IMPL-CYCLE6-FX2-1 (Note severity)** — Cancelled and PasswordGate variants previously had NO chrome at all (no Share, no Close). The page-level lift gives them BOTH affordances for the first time. This is a UX upgrade beyond the FX2 spec's strict scope, but it's the natural consequence of the lift. Worth confirming on smoke — if either variant looks visually wrong with chrome floating over its content, may need per-variant chrome suppression as a follow-up.

**D-IMPL-CYCLE6-FX2-2 (Note severity)** — `ownsThisEvent` includes auth load flicker on cold start. During the ~100ms while auth hydrates from AsyncStorage, founder sees buyer view briefly, then close button pops in. Acceptable pre-MVP. If smoke reports the flicker as jarring, alternative: render skeleton chrome (greyed-out close icon) while loading instead of nothing. Not implemented in this pass per spec ("safe default + acceptable pop-in").

**D-IMPL-CYCLE6-FX2-3 (Low severity)** — Architectural forward-look already noted in spec: when consumer Mingla integrates `/e/{slug}/{slug}` for swipeable deck / discover screen, the page-level chrome will need a `chromeMode` prop or full extraction for caller-controlled chrome. Not needed now; flagged for the integration cycle.

**No other side issues.**

## 13 — Rework

N/A — first-pass implementation.

## 14 — Files Touched

| File | Type | LOC delta |
|------|------|-----------|
| `mingla-business/src/components/event/PublicEventPage.tsx` | MOD | ~+50 / -13 |

## 15 — TypeScript Strict

```
$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

Clean.
