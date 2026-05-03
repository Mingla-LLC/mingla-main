# Implementation — ORCH-BIZ-CYCLE-6-FX1 — Gate `<Head>` to web only

**Status:** implemented, partially verified
**Verification:** tsc PASS · runtime UNVERIFIED (awaits user smoke)
**Scope:** 1 file, ~12 LOC delta
**Spec:** [prompts/IMPL_BIZ_CYCLE_6_FX1_HEAD_WEB_ONLY.md](Mingla_Artifacts/prompts/IMPL_BIZ_CYCLE_6_FX1_HEAD_WEB_ONLY.md)

---

## 1 — Mission

iOS native render of `PublicEventPage` crashed on every publish from the wizard because `expo-router/head`'s `HeadNative` requires an `origin` URL in the `expo-router` plugin config — not set up because no production URL exists yet (DEC-071). Fix: gate the `<Head>` JSX to `Platform.OS === "web"`. Web SEO preserved; iOS native renders without meta tags (acceptable — buyers always arrive via web URL).

## 2 — Old → New Receipts

### `mingla-business/src/components/event/PublicEventPage.tsx`

**What it did before:**
Rendered `<Head>` from `expo-router/head` unconditionally on every platform. On iOS native, `HeadNative` invoked `getHeadOriginFromConstants` which threw because `app.json` has `"plugins": ["expo-router"]` without the required `origin` option. Crash on first render of the page.

**What it does now:**
Renders `<Head>` only when `Platform.OS === "web"`. iOS / Android native paths skip Head entirely. Same SEO meta tags (title / description / og:* / twitter:* / canonical) emitted on web.

**Why:**
Unblocks Cycle 6 smoke priority #1 (Cycle 5 regression test — publish → public URL renders). Aligns with DEC-071 (frontend-first, no real domain yet); a TRANSITIONAL marker captures the exit condition (B-cycle backend + production URL → register origin in app.json + rebuild → re-enable iOS Head).

**Lines changed:** ~12 (8 lines wrapping the JSX block + 4 lines TRANSITIONAL comment + 7 lines docstring "Platform notes" section).

## 3 — Spec Traceability

| Spec criterion | Implementation | Status |
|----------------|----------------|--------|
| Add `Platform` import | Already present at line 31 (no-op confirmed) | PASS |
| Wrap `<Head>` block in `Platform.OS === "web"` ternary | Done at lines 247–278 | PASS |
| Add docstring "Platform notes" | Added under existing buyer-flow stubs section | PASS |
| Add `[TRANSITIONAL]` marker | Added inside the wrapped JSX block | PASS |
| Do NOT modify app.json | Confirmed unchanged | PASS |
| Do NOT remove `<Head>` import | Still imported at line 41 (used on web branch) | PASS |
| Do NOT introduce Platform.select | Used ternary as specified | PASS |

## 4 — Verification

| Check | Method | Result |
|-------|--------|--------|
| tsc strict | `npx tsc --noEmit` from `mingla-business/` | EXIT=0 |
| Web SEO preserved | Code inspection — all 13 meta tags + canonical link still emitted under web branch | PASS by construction |
| iOS native unblocked | Code inspection — `<Head>` no longer rendered on native; no other `expo-router/head` consumer in mingla-business (grep confirms `PublicEventPage.tsx` is the only file importing it) | PASS by construction |
| Runtime smoke (publish → public URL renders on iOS) | Awaits user | UNVERIFIED |
| Web View Source check (OG/Twitter Card meta tags present) | Awaits user post-deploy | UNVERIFIED (D-IMPL-CYCLE6-3 from original cycle still applies) |

## 5 — Invariant Verification

| Invariant | Preserved? |
|-----------|-----------|
| I-11 format-agnostic ID resolver | Y (untouched) |
| I-12 host-bg cascade | Y (untouched) |
| I-13 overlay-portal contract | Y (untouched) |
| I-14 date-display single source | Y (untouched) |
| I-15 ticket-display single source | Y (untouched) |
| I-16 live-event ownership separation | Y (untouched) |

No invariants in the registry govern Head/SEO behavior — this is a platform-gate concern outside the existing invariant scope.

## 6 — Parity Check

N/A — this fix is platform-gating logic; no solo/collab parity dimension. iOS + Android native both fall through the same `null` branch.

## 7 — Cache Safety

N/A — no React Query / Zustand state touched. No persisted data shape changed.

## 8 — Regression Surface

Adjacent features most likely to break:

1. **Web SEO emission on Expo Web** — confirm `<Head>` still produces correct DOM `<head>` tags via View Source (was already UNVERIFIED before this fix; remains so).
2. **PublicEventPage layout on iOS** — removing `<Head>` from native render shouldn't affect visual layout (it's invisible UI), but worth eyeballing the published event page on first iOS smoke.
3. **No other `expo-router/head` consumers** — grep confirmed `PublicEventPage.tsx` is the only file importing from `expo-router/head` in mingla-business; no parity sweep needed.

## 9 — Constitutional Compliance

| Principle | Affected? | Status |
|-----------|-----------|--------|
| #1 No dead taps | No | — |
| #2 One owner per truth | No | — |
| #3 No silent failures | Marginal — iOS native silently skips meta tags. Acceptable: buyers can't read meta tags on a native app surface anyway. | OK |
| #6 Logout clears | No | — |
| #7 Label temporary fixes | YES | TRANSITIONAL marker added with exit condition (B-cycle origin + rebuild) |
| #8 Subtract before adding | YES | Did NOT layer code on top of broken Head — gated the existing block |
| Others (4, 5, 9, 10, 11, 12, 13, 14) | No | — |

## 10 — Transition Items

**TRANS-CYCLE6-FX1-1** — iOS native Head metadata
- **What's temporary:** Skipping Apple Spotlight handoff metadata on iOS / Android native renders
- **Why:** No production URL registered in `app.json` `expo-router` plugin's `origin` option; would require a native rebuild
- **Exit condition:** B-cycle backend ships → real production URL is committed → `app.json` plugin entry becomes `["expo-router", { "origin": "<URL>" }]` → native rebuild lands → wrapper ternary can be removed (or expanded to all platforms)

## 11 — Discoveries for Orchestrator

**D-IMPL-CYCLE6-FX1-1 (Note severity)** — `D-IMPL-CYCLE6-3` from the original Cycle 6 implementation report ("Vercel/Expo Web SSR check on `<Head>` tags") is now MORE important: with the Platform gate in place, ALL Head metadata behavior is web-exclusive. Validating that Expo Web actually emits the `<head>` tags into SSR'd HTML (not just into the React Native runtime DOM) is the only way to confirm OG/Twitter Card share previews work end-to-end. Recommend running Twitter Card Validator + Facebook Sharing Debugger against a deployed `/e/{slug}/{slug}` URL before declaring Cycle 6 SEO fully verified.

**D-IMPL-CYCLE6-FX1-2 (Note severity)** — The original Cycle 6 implementor report flagged `<Head>` as the single runtime path NOT verified live. The fact that an obvious crash slipped past tsc + code-trace verification reinforces that "compiles clean" is insufficient signal for runtime config-dependent native modules. Worth registering a watch-point: any future use of `expo-router/head`, `expo-notifications`, `expo-device`, etc. — modules that read native `Constants` at first render — needs a mandatory iOS-Simulator boot smoke before declaring "implemented."

**No other side issues.**

## 12 — Rework

N/A — first-pass implementation.

## 13 — Files Touched

| File | Type | LOC delta |
|------|------|-----------|
| `mingla-business/src/components/event/PublicEventPage.tsx` | MOD | ~+12 / ~-1 |

## 14 — TypeScript Strict

```
$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

Clean.

## 15 — Cycle 6 Smoke Resume

After this fix lands, the user should:
1. Switch to Sunday Languor brand (already `stripeStatus: "active"` per pre-seed)
2. Open an existing draft (or build a new one with paid tickets)
3. Publish → wizard routes to `/e/sundaylanguor/{eventSlug}` → public page should render without crash
4. Resume the 5 priorities listed in the original Cycle 6 implementation report
