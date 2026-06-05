# QA — ORCH-1084 [business-logo-wordmark]

**Official Mingla Business logo replaces the "Mingla Business" text wordmark — web + iOS + Android**

- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1084-[business-logo-wordmark]/`
- **Branch:** `ORCH-1084-business-logo-wordmark` @ `6aa34c80b`
- **Mode:** TARGETED
- **Date:** 2026-06-05
- **Tester:** mingla-tester (Claude)

---

## VERDICT: CONDITIONAL PASS

The code change is correct, complete, and proven at every static + unit-test layer.
The single outstanding item is the **iOS-simulator live-fire render**, which was blocked
by **anchor `node_modules` filesystem corruption** (dataless/evicted babel runtime files),
NOT by anything in the ORCH-1084 diff. Per the dispatch's explicit instruction #2 ("If you
cannot reach the screen on the sim, say so explicitly and downgrade the confidence rather
than claiming PASS by source-reasoning alone"), the verdict is downgraded to CONDITIONAL
PASS pending a one-eyeball sim/device render by Seth.

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 (report cites a non-resolving fails-on-revert hash) | **P4:** 2

---

## 1. What changed (verified independently against the diff)

`git diff origin/main...HEAD` touches exactly three files:

1. `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` — the fix.
2. `mingla-business/__tests__/components/BusinessWelcomeScreenLogo.test.tsx` — implementor happy-path test.
3. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1084_BUSINESS_LOGO_WORDMARK.md` — report.

The component change, confirmed line-by-line:

- `styles.logo.aspectRatio` `1356 / 480` → `1` (the root fix — the square 2000×2000 asset
  was being letterboxed into a thin sliver by the wide consumer-mark ratio).
- `styles.logo` `width: s(180)` → `s(220)`, `maxWidth: "50%"` → `"62%"`.
- `styles.logoContainer.marginBottom` `vs(12)` → `vs(18)`.
- The redundant `<Text style={styles.businessBadge}>Mingla Business</Text>` element AND its
  `businessBadge` style block are both removed.
- Image `accessibilityLabel` `"Mingla logo"` → `"Mingla Business"`.
- Entrance animation (`logoOpacity` / `logoScale`, `useNativeDriver`) is untouched — preserved.

**Asset verified on disk:** `mingla-business/assets/brand/mingla-business-logo.png` is a real
PNG, **2000 × 2000 (square)**, RGBA — so `aspectRatio: 1` is physically correct for the source.
Confirmed via `sips` AND via the IHDR header read inside the adversarial test.

**Shared component → all three surfaces:** `BusinessWelcomeScreen.tsx` is the single RN
welcome/auth screen rendered on web (business.usemingla.com), iOS, and Android. One edit
covers all three. No platform-fork code exists for the logo.

**No orphaned references:** `grep` for `businessBadge` / `colors.accent` / `>Mingla Business</Text>`
in the component finds only comment references (the style + element are gone). `colors.accent`
is no longer used by this file.

---

## 2. Regression-test gate (Step 0.5)

### Implementor happy-path test — PRESENT + GREEN
`mingla-business/__tests__/components/BusinessWelcomeScreenLogo.test.tsx`

```
PASS __tests__/components/BusinessWelcomeScreenLogo.test.tsx
  ✓ SC-1 renders the official Mingla Business logo Image (square lockup)
  ✓ SC-2 does NOT render the orange 'Mingla Business' text wordmark badge
Tests: 2 passed
```
Angle: source-grep presence assertions (literal strings `aspectRatio: 1`,
`accessibilityLabel="Mingla Business"`, asset require path; absence of the literal
`aspectRatio: 1356 / 480` and `businessBadge`).

### Tester adversarial test — PRESENT + GREEN + FAILS-ON-REVERT
**Path:** `mingla-business/__tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx`

```
PASS __tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx
  ✓ A. logo style declares a SQUARE aspect ratio — no wide/sliver ratio can regress
  ✓ B. the brand name renders as a visible <Text> AT MOST once (no duplicate mark)
  ✓ C. logo source is the SQUARE business asset, not the wide consumer wordmark
  ✓ D. the <Image source={logo}> actually wears styles.logo (square ratio is applied)
Tests: 4 passed
```

**Why it is genuinely adversarial (different angle than the implementor's presence checks):**

- **A — ratio cannot regress in ANY spelling.** Instead of checking the one literal string
  `aspectRatio: 1356 / 480`, it parses the `aspectRatio` expression out of the `logo:` style
  block and COMPUTES its value, asserting `toBeCloseTo(1)`. This catches `2.83`, `1356/480`
  (any whitespace), `2.825`, a future decimal, etc. — every non-square value, not just one.
- **B — duplicate-mark count, not style-name.** Counts rendered `<Text>...Mingla Business...</Text>`
  NODES (must be 0) and `accessibilityLabel="Mingla Business"` occurrences (must be exactly 1) —
  proving one and only one brand mark. The implementor only checks the specific `businessBadge`
  style is gone; a future dev could reintroduce a duplicate brand-name Text with a different
  style and slip past the implementor test but not this one.
- **C — source identity + self-validating asset.** Asserts the wide consumer mark
  (`mingla_official_logo.png`) is NOT the source, AND reads the actual PNG IHDR header off disk
  to prove the business asset is genuinely square — so `aspectRatio:1` is correct against the
  real file, not just asserted.
- **D — binding integrity.** Proves the `<Image source={logo}>` element actually wears
  `style={styles.logo}`, so the square ratio reaches what renders.

**Fails-on-revert proof.** I checked out the pre-fix component (`6aa34c80b^` = `8781d6d1f`,
the true parent) over just `BusinessWelcomeScreen.tsx`, ran the adversarial suite, and confirmed:

```
===== ADVERSARIAL test on REVERTED component (must FAIL) =====
  ● A. logo style declares a SQUARE aspect ratio ...   FAIL  (value 2.825, expected ~1)
  ● B. the brand name renders ... AT MOST once ...       FAIL  (Text node count 1, expected 0)
Tests: 2 failed, 2 passed
```
**Fails-on-revert commit hash: `8781d6d1f`** (parent of the fix). Tests A + B fail on revert —
the two assertions targeting the exact two regressions the fix addresses (wide ratio + duplicate
badge). C + D pass on revert because the asset-require and Image binding were already correct
before the fix (the bug was purely the ratio + the duplicate Text), which is expected and
correct behaviour for those two assertions. The component was then restored to `6aa34c80b`.

**Both tests ship in the PR diff** — both appear in `git diff origin/main...HEAD --name-only`.

### Both ORCH-1084 suites together
```
PASS __tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx
PASS __tests__/components/BusinessWelcomeScreenLogo.test.tsx
Test Suites: 2 passed, 2 total | Tests: 6 passed, 6 total
```

---

## 3. iOS simulator live-fire — BLOCKED (environment, not code)

**Outcome: BLOCKED — could not render the welcome screen on the sim. Confidence downgraded
per dispatch instruction #2. NOT claimed as a source-only PASS.**

Steps taken (full recovery attempt, per `feedback_sim_boot_blocker_must_resolve_not_note.md`):

1. iPhone 17 Pro sim (`17091E60-...`, iOS 26.4) was booted with the Mingla Business dev build
   (`com.sethogieva.minglabusiness`) already installed.
2. Metro was already running on `:8081` from the **anchor** `mingla-business` (on `main`). To
   live-fire the ORCH-1084 code I applied the fixed component onto the anchor checkout (the
   sanctioned `feedback_testing_handoff_just_run_expo_start` approach), confirmed the asset is
   present in the anchor (same 2000×2000 file, already committed to main), and triggered reload.
3. The app stayed on the Expo dev-client launcher; the bundle never loaded. Probing
   `GET /index.bundle?platform=ios` returned **HTTP 500**:
   - First: `@babel/compat-data/data/plugins.json: Unexpected end of JSON input`.
   - I restored that file from the **exact-version 7.29.0 tarball in the npm cache**
     (`~/.npm/_cacache`, extracted via Node) — it then read as valid (63 keys, 16954 bytes).
   - Re-bundle then surfaced a NEW error: `@babel/parser: (0, _parser.parse) is not a function`.
4. Root cause of the blocker: `node_modules/@babel/parser/lib/index.js` reports **512070 bytes
   in `stat`/`wc`/`ls` metadata but reads as 0 bytes / empty content** (`od -c` prints nothing,
   `require` exports `{}`). This is a **macOS dataless / evicted file** (cloud-sync "optimize
   storage" placeholder) in the anchor `node_modules`, affecting babel runtime files beyond the
   single one I could restore. Resolving it requires a full `npm ci` reinstall of
   `mingla-business/node_modules` — a network + destructive operation on Seth's working tree
   that is **denied in this sandbox** and is exactly the kind of destructive op that asks the
   operator first.

The anchor `BusinessWelcomeScreen.tsx` was restored to its origin/main version after the
attempt; the anchor working tree is clean (`git status` empty for the file). The restored
babel file is under gitignored `node_modules` — zero repo impact.

**Why CONDITIONAL PASS is the correct ceiling and the risk is low:** the change is a pure
StyleSheet value (`aspectRatio: 1`) + the deletion of one static `<Text>` element. There is no
new logic, no data flow, no conditional, no platform fork. The asset is proven square
(2000×2000) so the ratio is physically correct, and `resizeMode="contain"` guarantees the
square lockup renders un-squashed inside the square box. tsc is clean. All 6 tests pass.
The only thing the sim would add is the human eyeball confirmation that the lockup looks crisp
and the orange text badge is gone — which is what the handoff asks Seth to do.

**Android + Web legs:** same shared component, same blocker mechanism (all bundle through the
same corrupted anchor node_modules). Not independently run; the static + unit evidence covers
the shared code identically across platforms.

---

## 4. Pre-existing failure confirmation (dispatch requirement #3)

`PublicBrandPage.dataDriven` jest failure (flagged by the implementor) — **confirmed
pre-existing, NOT introduced by ORCH-1084:**

- `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` fails on this branch
  (3 of 4 tests; e.g. `expect(publicBrandPage).toContain("const UpcomingTab")`).
- ORCH-1084's diff does **not** touch `PublicBrandPage.tsx` or its test — confirmed:
  `git diff origin/main...HEAD --name-only | grep -i PublicBrandPage` → no match.
- Both the test file and `src/components/brand/PublicBrandPage.tsx` are **byte-identical to
  origin/main** on this branch (`git diff origin/main...HEAD -- <both files>` → empty).
- Therefore the failure exists identically on clean origin/main and is unrelated to this change.

**Wider suite note (P4):** the full `npx jest` run shows 67 failed suites / 125 failed tests —
these are pre-existing infrastructure issues (Playwright `*.test.ts` files picked up by the
jest `testMatch`, e.g. `meta_orch_0952_carousel_browser.test.ts` throwing
`throwIfRunningInsideJest`, plus the PublicBrandPage dataDriven family). None touch
`BusinessWelcomeScreen`. The two ORCH-1084 suites are green. Out of scope for this ORCH; flagged
for the orchestrator as test-infra debt.

---

## 5. Type-check

`npx tsc --noEmit` in `mingla-business` → **0 errors**, nothing on `BusinessWelcomeScreen.tsx`.

---

## 6. Constitution spot-check (relevant rules)

- **R1 (no dead taps):** N/A — logo is a decorative Image, no tap. Auth buttons untouched.
- **R8 (subtract before adding):** PASS — the fix REMOVES the redundant text badge rather than
  layering a second mark; net simplification.
- **R9 (no fabricated data):** PASS — uses the real official asset, no placeholder.
- All others: N/A (no DB/auth/currency/state/persistence touched).

---

## 7. Findings

- **P3-1 — Implementation report cites a non-resolving fails-on-revert hash.** The report and
  the implementor's test header cite `e8e3f2c` as the pre-fix commit, but that short hash does
  not resolve in this repo; the true parent of the fix `6aa34c80b` is `8781d6d1f`. The
  implementor's fails-on-revert claim could not be re-verified against the cited hash. I
  independently re-ran fails-on-revert against the correct parent `8781d6d1f` and it holds, so
  this is a citation error in the report, not a test defect. Recommend correcting the report's
  hash before CLOSE.
- **P4-1 — Clean, minimal, well-commented fix.** The `logo` style carries a precise comment
  explaining why `aspectRatio:1` (square source) replaced `1356/480` (consumer mark). Good.
- **P4-2 — Shared-component leverage.** Single edit correctly covers web + iOS + Android with no
  platform fork; the right architecture for a brand-mark swap.

---

## 8. Verdict gate accounting

- PASS requires `proven` sim live-fire on each applicable platform → **NOT met** (sim blocked by
  anchor node_modules dataless-file corruption; recovery attempted, blocker is destructive
  `npm ci` which is denied). → ceiling is CONDITIONAL PASS.
- Regression-test gate (adversarial + implementor + both in PR diff + fails-on-revert) → **MET**.
- Zero open P0/P1 → **MET**.
- tsc clean → **MET**.

**CONDITIONAL PASS**, contingent on Seth eyeballing the welcome screen once on a working build
(or on a `npm ci` of `mingla-business/node_modules` to unblock the sim leg).
