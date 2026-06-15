# TEST — META-ORCH-1138 Leg 1 [Shared Direction-A Foundation + Public TRIP Page]

**Verdict: PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 3 · P4: 2
**Tester:** mingla-tester. **Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on `ORCH-1138-trip-page-redesign`.
**HEAD under test:** `b13e76f33` (= implementor's cited `3ec03e8e2` + the implementation-report file only; product trees byte-identical — verified `git diff 3ec03e8e2 b13e76f33` touches one doc).
**SPEC:** `SPEC_ORCH-1138_LEG1_FOUNDATION_AND_TRIP.md` (+ amendments A-1, A-2).
**Evidence:** `Mingla_Artifacts/evidence/ORCH-1138/` (screenshots), inline gate output + measured contrast below.
**Confidence:** `proven` (web/RN-web deliverable — full live-fire). Native in-app mount = BLOCKED by a pre-existing stale dev-client (a Leg-1 NON-GOAL; does not gate the verdict).
**Comms ledger:** read on entry; no BLOCK rows for this skill/ORCH. Acked WARN COMMS-0029 (biz_update_live_trip migration clobber — N/A, this leg is render-only, zero migrations) + COMMS-0030 (the iOS CocoaPods break — resolved per dispatch via ORCH-1129; separately I hit a DIFFERENT, stale-binary native blocker, reported as D-2).

---

## 1. Verdict rationale

The Leg-1 deliverable is the **public TRIP page `/t/{brandSlug}/{tripSlug}`, which is RN-web** (business-app web build), plus the shared Direction-A foundation. I exercised the REAL exported web bundle in a real chromium browser against real prod data (intercepted at the Supabase boundary with prod-shaped payloads, because the sandboxed browser has no external egress — the code under test is the genuine `expo export` artifact), flipping EVERY state. Every state rendered correctly; the desktop two-column sticky panel renders with no empty void; theming is contrast-safe; sold-out fail-open is proven; no fabricated data. All three required gates (mingla-business jest baseline parity, package-isolation strict-grep, ORCH-1083 `__common` web bundle-budget) are green. RT-1..RT-4 fails-on-revert independently re-run and confirmed. My own adversarial test (a different angle — a WCAG-AA contrast INVARIANT sweep, vs RT-1's fixed snapshots) is on-branch, passing, and fails-on-revert proven.

Zero P0, zero P1, zero P2. The three P3s are all PRE-EXISTING (in the extracted event-page engine / the route's prior loading branch / the shared date helper), not introduced by this leg, and the two P4s are praise. → routes to CLOSE.

---

## 2. SC-by-SC matrix

| SC | Status | Evidence |
|---|---|---|
| SC-1 (theming) | **PASS** | Live render: brand teal `#0f766e`→dark teal page+accent; navy/violet→light page; default→warm `#1e120d`. Override wins over brand proven live (`overrideTheme`: brand teal + trip override violet `#6d28d9` → black title text, light page). RT-1 pins crimson/teal/navy/default. |
| SC-2 (contrast / light page) | **PASS (with SPEC-example nit, see P3-1)** | Measured AA: navy light page `#f0f3f8` → primaryText `#000000` 18.88:1, white-on-accent 10.36:1, accent-on-page 9.31:1. Saffron → engine picks DARK (contrast-correct: yellow fails on white) primaryText 17.34, white-on-accent 5.04, accent 3.44. My adversarial 36-hue sweep: text-on-page ≥4.5 + white-on-accent ≥4.5 hold for ALL inputs. |
| SC-3 (palette parity — A1) | **PASS** | `createThemePalette` body byte-identical origin/main vs `themePalette.ts` (`diff` empty). `PublicEventPage.tsx` diff = import add + verbatim decl deletion, ZERO render-body change. Event-page test suite identical pass/fail vs baseline (see §5). RT-1 green + fails-on-revert. |
| SC-4 (per-day itinerary, real fields) | **PASS** | Live: Day 1 (0 media → no gallery), Day 2 (narrative + media slider), Day 3 (0 media). NO timed stops despite `stops:[]` in data. RT-4 + my runtime both confirm. |
| SC-5 (chips) | **PASS** | Live: "What's included: Lodging, Food" (✓) + "What's not included: Flight tickets, Alcohol" (✗). Empty list → no section (free state showed inclusions; a no-inclusion mock omits the section). |
| SC-6-Web (parallax + chrome) | **PASS** | Live: cover is genuinely `position:fixed` (window-scroll does not move it); X (Close=1) + Share (Share=1) fixed top corners on every loaded state, 0 on error/not-found. Share opens `ShareModal` (no bare `Share.share` — grep clean). |
| SC-7-Web (desktop two-column) | **PASS** | Live @1280px: centered ≤1200 shell, contained 21:9 cover, LEFT scroll content + RIGHT sticky panel (accent bar + brand chip + HOW YOU PAY toggle + Charged today €500). NO empty void, NO hidden panel — the `.desk-only` cascade trap did NOT regress. Floating bar hidden on desktop. Screenshot `loaded-1280.png`. |
| SC-8-native (immersive single col) | **BLOCKED (non-goal; pre-existing stale dev-client)** | Worktree Metro built the JS bundle clean on the iOS 17 Pro sim (4767 modules incl. `@mingla/offering-rendering`) — native build is NOT blocked at the JS layer. But the installed dev-client binary (built Jun 9) lacks the `expo-image-manipulator ~14.0.8` native module → app crashes at boot before any route (`Cannot find native module 'ExpoImageManipulator'`, origin `TripCreatorStep2Itinerary`/`uploadTripDayMedia` — UNRELATED to the trip page). Native in-app mount is an explicit Leg-1 NON-GOAL (SPEC §2.2). D-2. Source-reviewed: native branch is single-column immersive + `safeAreaTop` chrome, no two-column. |
| SC-9 (ORCH-1130 wrap additive) | **PASS** | Diff: `palette?` optional on both components; `paletteOverrides(undefined)` early-returns `{}`; every override applied as `isFull ? ov.x : null` → collapses to pre-1138 style array. Protected callers `checkout-trip/[tripEventId]/payment.tsx` + `TripCreatorStep5Review.tsx` are BYTE-UNCHANGED (`git diff` empty) and pass NO palette. Live: trip page payment toggle is brand-themed. RT-2 green + fails-on-revert. |
| SC-10 (sold-out wiring) | **PASS** | Live `soldout` (remaining 0): "SOLD OUT" banner + "Sold out · 102 of 102 booked" + non-tappable CTA. Live `remainingError` (RPC throws): NO sold-out, "102 max" shown — **fail-open proven, no fabricated sold-out** (Constitution #9). Real prod RPC verified: DC Adventure = 21 remaining / 81 sold / 102 cap. |
| SC-11 (every state) | **PASS** | Live: loading ("Loading trip…" spinner — see P3-2), error ("Couldn't load trip" + real PostgrestError "relation events boom…" — ORCH-0879), not-found ("Trip not found…"), closed ("Bookings are closed…"), deadline ("Bookings close in 1 day"), not-bookable (paid+can't-charge → unavailable CTA), free, installments-toggle, theme-absent (default `#eb7825`). |
| SC-12 (currency) | **PASS** | Live: "€500.00" / "€500 total" via `Intl.NumberFormat` (EUR tier). Free state → "Reserve my spot", no all-in line. No hardcoded GBP/£/$ (grep clean). |
| SC-13 (no dead taps) | **PASS** | Chrome Close/Share, brand "View", Reserve, payment segments, "Read more", day expand all have handlers + a11y labels. Map is static info (no tap promised). |
| SC-14 (foundation fit) | **PASS (design-review, on paper)** | Prop contracts abstract the page-specific panel via `stickyPanel`/`children`; no event/experience/brand code written (confirmed: diff touches only trip + foundation + palette files). |

---

## 3. Findings

### P3-1 — SC-2 SPEC worked-example is backwards for saffron (DOC nit, not a code defect)
- **Evidence:** SPEC §5 SC-2 + T-3 say `theme_color=#f5c518` (saffron) → "a LIGHT page with black-leaning text". The shipped engine (byte-identical to the production event-page engine) resolves saffron to a **DARK** page (`page=#1f1a0b`, primaryText `#ffffff`) because a bright-yellow accent fails contrast on a light page. Verified live (`lightTheme-390.png` shows a dark page) + algorithmically (`resolveTheme`+`createThemePalette` probe).
- **Impact:** None on users — the page is contrast-correct either way (measured AA-safe). Only the SPEC's example sentence is wrong.
- **Required fix:** None to code. Optionally correct the SPEC SC-2/T-3 example (e.g. use navy as the light-page example, which the engine DOES render light). Pre-existing engine behavior.
- **Retest:** n/a (doc).

### P3-2 — Loading state is a spinner, not the shimmer skeleton SC-11 names (PRE-EXISTING)
- **Evidence:** Route `:109-115` renders `<ActivityIndicator/>` + "Loading trip…". SC-11 specifies a shimmer skeleton (cover shimmer + title + meta bars). Origin/main rendered the same spinner; the rewrite preserved it (out of strict scope).
- **Impact:** Cosmetic — a plain spinner instead of a skeleton on first load.
- **Required fix:** Optional follow-on ORCH to build the skeleton; not a Leg-1 regression. Implementor flagged this in §10.
- **Retest:** visual on `/t/` cold load.

### P3-3 — Loading branch is `isLoading || isFetching` → a background refetch flashes the spinner over a loaded page (PRE-EXISTING)
- **Evidence:** Route `:109` `if (query.isLoading || query.isFetching)`. With `staleTime:60s`, a background refetch (data present, `isFetching=true`) replaces the loaded page with the spinner. **Identical on origin/main** (`git show origin/main:…[tripSlug].tsx` line 107) — NOT introduced by this leg.
- **Impact:** A spinner flash on refocus/remount after 60s. Latent, pre-existing.
- **Required fix:** A future cleanup should gate on `isLoading && !data` (Discovery, not this leg).
- **Retest:** open `/t/`, wait 60s, refocus.

### P4-1 — ORCH-1130 additive wrap is exemplary (praise)
The `palette?` optional + `paletteOverrides(undefined)→{}` + `isX ? ov.y : null` pattern is the textbook way to theme a shared component without touching protected callers. Byte-identity is structurally guaranteed (RN flattens `[s, null]`), and the protected callers are verifiably untouched. Replicate for the event/experience/brand legs.

### P4-2 — Fail-open sold-out + rule-9 discipline is clean (praise)
`fetchTripTicketsRemaining` catches RPC error → empty Map → `ticketsRemaining` stays null → no fabricated sold-out, with a clear `console.warn`. The map/gallery/stops gating all hide-on-absent. Proven at runtime, not just claimed.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proofs

All re-run by me at HEAD `b13e76f33` (= product tree of cited `3ec03e8e2`):

| Gate | Mutation I applied | Result | Implementor claim | Match |
|---|---|---|---|---|
| **RT-1** | `themePalette.ts` page-mix `useDark ? 0.1 → 0.25` | **3 failed, 2 passed** → restore → 5 passed | "3 tests fail" | ✓ EXACT |
| **RT-2** | deleted `if (palette === undefined) return {};` early-out | **1 failed, 3 passed** → restore → 4 passed | "1 fails" | ✓ EXACT |
| **RT-3** | added `import … "../../mingla-business/src/services/supabase"` to `ChipGroup.tsx` | **2 failed, 1 passed** → restore → 3 passed | "2 fail" | ✓ EXACT |
| **RT-4** | injected `{day.stops.map(...)}` into FOUNDATION DayByDay | **1 failed, 3 passed** → restore → 4 passed | "1 fails" | ✓ EXACT |

All four match the implementor's claimed counts exactly. Worktree restored clean after each (`git diff --stat` empty per file).

---

## 5. Gate results (re-run by me)

- **mingla-business jest — baseline parity (the load-bearing regression check):**
  - origin/main (detached worktree, same node_modules): **155 failed, 3347 passed, 439 suites (81 failed)**.
  - ORCH-1138 branch: **155 failed, 3369 passed, 444 suites (81 failed)**.
  - Failing-SUITE sets are **byte-identical** (`comm` diff both directions = empty; 81 = 81). Branch adds exactly 5 suites / +22 passing tests = the 5 ORCH-1138 files. **ZERO new failures, ZERO regressions.** The 3 amendment-modified test files (`TripVisualParity`, `TripVisualParity_adversarial`, `PublicEventPage.orch_0964_design_rework`) yield **identical 11-failed/56-passed on BOTH** branch and main — the A-1/A-2 repoints are net-neutral.
- **Package-isolation strict-grep** (`meta-orch-0827-package-isolation.mjs`): **PASS**.
- **ORCH-1083 `__common` web bundle-budget:** ran `npm run web:export` (succeeded; `lucide-react@0.577.0` present in this worktree — the implementor's noted gap is resolved here) → gate **PASS** (initial payload 2,944,759 B / ceiling 9,405,478; 134 chunks; 0 deferred specifiers in main entry; `__common` within cap).
- **ORCH-1138 suite incl. my adversarial:** **106/106 pass** (6 suites).

---

## 6. Adversarial test added (different angle)

- **Path (on-branch, in-diff once committed):** `mingla-business/src/components/trip/__tests__/themePaletteContrastInvariant.tester.orch1138.test.ts`
- **Angle (distinct from RT-1..RT-4):** RT-1 pins the EXACT palette object for 4 fixed colors (a snapshot). My test makes NO snapshot — it asserts the WCAG-AA contrast **INVARIANT that SC-2 actually promises** across a 36-hue sweep (12 hues × 3 lightnesses, HSL→hex) + adversarial inputs (saffron, pure/near black, malformed hex). Two hard guarantees (text-on-page ≥4.5, white-on-accent ≥4.5) asserted for EVERYTHING incl. degenerate whites; accent-on-page ≥3.0 for all saturated hues; surface-tone internal consistency (black-text ⇔ light page ⇔ `resolveOfferingSurface==='light'`); and the saffron SPEC-example discrepancy pinned as a contrast-contract test (not a tone test). 84 cases, all green.
- **fails-on-revert verified at `b13e76f33`:** weakened `contrastAdjustedForWhiteText(..., 4.5 → 1.05)` in `themePalette.ts` → many swept hues go red (white-on-accent < 4.5); restore → 84 passed. Recorded.
- **During authoring it surfaced a real edge (documented in-test):** pure/near-white accents (`#ffffff`/`#fefefe`) cannot reach accent-on-page ≥3.0 on a near-white page — a degenerate brand input, pre-existing engine behavior; excluded from the accent assertion, still covered by the two hard guarantees. → Discovery D-3.
- **Both tests in the closing diff:** the implementor's RT-1..RT-4 (5 files) ARE in `git diff origin/main...HEAD --name-only`; my adversarial file is currently untracked in the worktree and must be committed by CLOSE so it lands in the closing PR diff (flagged in handoff).

---

## 7. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | Chrome/View/Reserve/segments/expand all have handlers+a11y; Share→ShareModal (not bare Share.share). |
| 2 | One owner per truth | PASS | Single palette engine (`createThemePalette`); route owns checkout/share/mute state; hook owns fetch. |
| 3 | No silent failures | PASS | RPC error → `console.warn` + fail-open; query error → PostgrestError surfaced. |
| 4 | One query key per entity | PASS | `tripKeys.publicBySlug` unchanged. |
| 5 | Server state server-side | PASS | All trip data via React Query; no Zustand server cache added. |
| 6 | Logout clears everything | N/A | Anon-tolerant public route; no auth/session touched. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code added. |
| 8 | Subtract before adding | PASS | Bespoke IconChrome overlays + hardcoded warm-orange replaced by foundation; not layered on. |
| 9 | No fabricated data | PASS | No stops, no trip-level gallery, map gated on lat/lng, no fabricated sold-out, no brand bio. RT-4 + live. |
| 10 | Currency-aware | PASS | `Intl.NumberFormat` w/ tier currency; "€500.00" live; no GBP/£/$ hardcode. |
| 11 | One auth instance | PASS | No `useAuth` on the route (ORCH-1115 anon allowlist preserved). |
| 12 | Validate at right time | PASS | Deadline computed from `booking_deadline` vs now; sold-out from real remaining. |
| 13 | Exclusion consistency | PASS | Inclusions split included/excluded; absent sections omitted consistently. |
| 14 | Persisted-state startup | N/A | No persisted store added. |

---

## 8. Device / parity matrix

| Surface | Verdict | Evidence |
|---|---|---|
| Buyer/anon Web (`/t/`) — THE deliverable | **PASS (proven)** | Real chromium vs served `web-build`, every state @390 + @1280, Supabase intercepted with prod-shaped real data. Screenshots in evidence dir. |
| Business Web preview (wizard Step-5) | **PASS** | LEGACY TripPreview mode byte-stable (no palette passed); `TripCreatorStep5Review.tsx` unchanged (RT-2 + diff empty). |
| Business iOS (in-app trip route) | **BLOCKED — non-goal** | Worktree Metro built the bundle clean on iOS 17 Pro sim (4767 modules incl. new package — native build NOT blocked). App boot crashes on a STALE dev-client missing `expo-image-manipulator` native module (Jun-9 binary; unrelated to trip page; pre-existing). SPEC non-goal. Unblock = rebuild dev client. |
| Business Android | **N/A (non-goal)** | Native in-app is a Leg-1 non-goal; no Android dev client present. |
| Consumer iOS/Android | **N/A** | app-mobile out of scope. |
| Admin Web | **N/A** | Different app, untouched. |
- **Physical iPhone HITL:** not requested by this dispatch; the deliverable (RN-web) was fully proven headless. No physical step pending.
- **Edge-fn live deploy:** N/A — zero edge functions / migrations in this leg (verified: diff touches no `supabase/`).

---

## 9. Discoveries for Orchestrator

- **D-1 (pre-existing test debt):** mingla-business carries 155 failing tests / 81 red suites on origin/main (stale `_0964` BlurView/recurrence source-string tests, `tripsService`, `PaymentPlanEditor`, wizard IconChrome, post-ORCH-1114 `Share.share` legacy-API assertion). Independent of 1138. A triage/cleanup ORCH is warranted.
- **D-2 (native dev-client stale):** the installed business iOS dev client (Jun 9) predates `expo-image-manipulator ~14.0.8` → boots crash team-wide for native in-app testing of ANY route. NOT the COMMS-0030 CocoaPods break (that's resolved); this is a stale-binary/native-module mismatch. A fresh dev-client build is needed before any native QA of business-app features.
- **D-3 (engine edge):** `createThemePalette` cannot lift a pure/near-WHITE accent to AA accent-on-page contrast on a near-white page (degenerate input; the `theme_color` CHECK may already reject it). Pre-existing in the event-page engine. No prod brand sets white.
- **D-4 (shared date helper TZ):** the live page showed "Aug 16" for a `2026-08-17T00:00:00Z` master date — a UTC-midnight→local-display behavior in the SHARED `formatTripDateRange` (used by event/trip/consumer identically). Pre-existing, consistent across surfaces; flag if a date-correctness ORCH is ever opened.
- **D-5 (prod theming reality):** ZERO prod trips currently set a brand `theme_color` or per-trip override — every live trip renders the default `#eb7825`. SC-1/SC-2 themed paths proven via the algorithm + intercepted theming, not a live themed brand (none exists). When a brand first sets a theme, eyeball once.

---

## 10. Routing

**PASS → CLOSE (orchestrator).** At CLOSE: commit my adversarial test (`themePaletteContrastInvariant.tester.orch1138.test.ts`) so it lands in the closing PR diff; flip the I-PROPOSED-1138-* invariants ACTIVE; World Map; OTA/deploy decision (pure-JS/RN → `eas update` per memory; web → Vercel). Optionally correct the SPEC SC-2 saffron example (P3-1). Register D-2 (stale native dev-client) if native business-app QA is upcoming.
