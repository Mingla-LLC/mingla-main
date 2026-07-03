# TEST — ORCH-1284 [Business "Manage tax and registrations" CTA 404s — wrong web domain]

**Skill:** mingla-tester · **Mode:** TARGETED · **Date:** 2026-07-03
**Worktree:** `~/Desktop/mingla-orchs/orch-1279-[tax-registrations-wrong-domain]/` · **Branch:** `orch-1284-tax-registrations-wrong-domain`
**Under test:** fix commit `bb3d684cc` (source) + renumber `1aa253ea2` · **Branch HEAD at test:** `1aa253ea2`
**Adversarial test commit:** `658e0a855`

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 1

The fix is correct and proven at source + unit + hook-wiring + live-domain-signal levels. The
**one capped item** is the full authed end-to-end live-fire (driving the real CTA inside an authed
brand→Payments screen and watching the embedded Stripe Tax component paint) — not run because
business-web authed runtime is unreachable/heavy (memory `feedback_biz_web_authed_runtime_unreachable_cap_claims`).
The dispatch pre-authorizes capping this leg ("cap the claim honestly if blocked… rather than
asserting it works"). No defect was found; the capped leg is a deferred verification, not an
accepted defect. Regression gate fully satisfied (both the implementor happy-path test and this
tester adversarial test fail-on-revert and appear in the closing diff).

**Routing:** back to Seth/orchestrator — CLOSE-ready given the dispatch-authorized live-fire cap; the
authed embedded-render leg is recorded as a residual (P4), governed by pre-existing
I-PROPOSED-EMBEDDED-TAX-UI, not by this change.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | `taxToolsUrl` resolves base from `MINGLA_BUSINESS_WEB_URL` (business.usemingla.com), never the marketing apex or dead env vars | **PASS** | Source read `useBrandStripeTaxAccountSession.ts:26` = `MINGLA_BUSINESS_WEB_URL.replace(/\/$/,"")`; branch diff removes the `EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL ?? EXPO_PUBLIC_WEB_BASE_URL ?? "https://usemingla.com"` fallback. Adversarial test B: dead vars set to garbage → output still `business.usemingla.com`. |
| SC-2 | The CTA actually routes through the fixed builder to `WebBrowser.openAuthSessionAsync` (real wiring, not just the pure builder) | **PASS** | Adversarial test A drives the SHIPPED hook's real `onSuccess` (captured off the actual `useMutation(options)` call) → `openAuthSessionAsync` invoked once with `https://business.usemingla.com/connect-tax-registrations?...`, host asserted, apex asserted absent; `mutationFn` delegates to the service. |
| SC-3 | Marketing apex `usemingla.com/connect-tax-registrations` 404s; business subdomain does NOT 404 (serves the SPA) | **PASS** (live) | `curl -L` apex → **HTTP 404**; business subdomain → **HTTP 200**, `<title>Mingla Business</title>` + Expo root shell markers. |
| SC-4 | Embedded Stripe Tax component renders for a real authed brand via the CTA (full end-to-end) | **DEFERRED / capped** | Authed brand→Payments runtime unreachable; anon GET renders the SPA shell only (route is clientSecret-gated). Source+unit+wiring+domain-signal verified; authed embedded-render live-fire NOT run. See P4-1. |
| SC-5 | Typecheck clean on touched files; strict-grep gates green; no hook/payments regression | **PASS** | Full `tsc --noEmit`: **0** errors mention any touched file (hook + both tests); 727 project-wide errors are pre-existing backlog, unrelated. `i-proposed-y-platform-web-url-from-env.mjs` → 0 violations / 2059 files. `orch-0955-embedded-tax-ui.mjs` → PASS. Hooks suite: only 2 pre-existing unrelated failures (see §7). |

---

## 3. Findings

### P4-1 (NOTE / residual) — authed embedded-render live-fire deferred
- **Evidence:** `business.usemingla.com/connect-tax-registrations` returns HTTP 200 (SPA shell) on an anon GET; the embedded `<ConnectTaxRegistrations>`/`<ConnectTaxSettings>` render is gated behind a valid Stripe `clientSecret` + authed brand session, which the test environment cannot reach.
- **Impact:** The final "component actually paints for a real brand" assertion is unverified by this run. This behaviour is governed by pre-existing `I-PROPOSED-EMBEDDED-TAX-UI` (ORCH-0955), NOT changed by ORCH-1284 — ORCH-1284 only changes which DOMAIN the CTA opens.
- **Required fix:** none (no defect). Optional: an operator-driven authed smoke (Brand → Payments → "Manage tax and registrations") to close SC-4.
- **Retest:** on an authed business-web session with a brand that has a Stripe account, tap the CTA and confirm the opened `business.usemingla.com/connect-tax-registrations` page paints the Stripe Tax embed (not a client-side 404).

No P0/P1/P2/P3 findings.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- **Restored (fixed) state, HEAD `1aa253ea2`:** `npx jest useBrandStripeTaxAccountSession.orch1284.test.ts` → **3/3 PASS**.
- **Reverted state** (working-tree edit of `useBrandStripeTaxAccountSession.ts:26` back to the pre-fix `process.env.EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL ?? EXPO_PUBLIC_WEB_BASE_URL ?? "https://usemingla.com"` resolution): implementor test → **2 failed / 1 passed**. Exact failing assertion: `expect(parsed.origin).toBe("https://business.usemingla.com")` → `Received: "https://usemingla.com"` (the 3rd test only checks param encoding, domain-independent → stays green, expected).
- **Restored** via `git checkout -- <file>` → back to 3/3 PASS; tree clean (only the untracked adversarial test remained).
- **Proof performed at branch HEAD `1aa253ea2`** (fix logic commit `bb3d684cc`). The revert was a temporary working-tree edit, never committed; source confirmed restored (`line 26 == MINGLA_BUSINESS_WEB_URL.replace(/\/$/,"")`).

---

## 5. Adversarial test added

- **Path:** `mingla-business/src/hooks/__tests__/useBrandStripeTaxAccountSession.orch1284.tester.adversarial.test.ts`
- **Commit:** `658e0a855` (on branch `orch-1284-tax-registrations-wrong-domain`).
- **Angle (different from the implementor's pure-builder happy-path):**
  - **A — Wiring/runtime (preferred):** captures the options the SHIPPED hook passes to `useMutation`, then invokes the REAL `onSuccess` closure and asserts `WebBrowser.openAuthSessionAsync` is called with `business.usemingla.com/connect-tax-registrations?...` and never the apex; also asserts `mutationFn` calls the service. Validates I-PROPOSED-EMBEDDED-TAX-UI. The implementor's test never reaches the hook wiring.
  - **B — Belt-and-braces env:** sets the OLD dead vars (`EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL`, `EXPO_PUBLIC_WEB_BASE_URL`) to garbage/marketing values and proves the builder STILL emits the business subdomain (dead vars truly ignored, not merely unset).
  - **C — Trailing-slash normalization:** a business URL with a trailing slash (re-resolved via `jest.isolateModules`) yields exactly one slash before `connect-tax-registrations` (no `//`).
- **fails-on-revert verified at HEAD `1aa253ea2`:** reverting the base resolution turns all three RED — A `host → usemingla.com`, B `host → garbage-marketing.example` (the dead var wins), C `origin → https://usemingla.com/...`. Restored → 3/3 PASS.
- **Closing-diff check:** `git diff origin/main...HEAD --name-only` shows BOTH `useBrandStripeTaxAccountSession.orch1284.test.ts` (implementor) AND `...orch1284.tester.adversarial.test.ts` (tester). Append-only gate: 0 test files modified, 0 files deleted vs origin/main.

---

## 6. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | **N/A** (source+unit; CTA firing proven via wiring test A) | onSuccess → openAuthSessionAsync fires with a valid 200 URL; live authed tap deferred (P4-1). |
| 2 | One owner per truth | **PASS** | Base now sourced solely from `MINGLA_BUSINESS_WEB_URL` (single source of truth `platformUrl.ts`); bespoke env reads removed. |
| 3 | No silent failures | **PASS** | `platformUrl.ts` throws loud at module load if the env is unset; no swallowed errors introduced. |
| 4 | One query key per entity | **N/A** | No query-key change. |
| 5 | Server state server-side | **N/A** | No Zustand/state change. |
| 6 | Logout clears everything | **N/A** | No auth/session state touched. |
| 7 | `[TRANSITIONAL]` labelled | **PASS** | No new transitional code; existing `platformUrl.ts` transitional block untouched. |
| 8 | Subtract before adding | **PASS** | Fix REMOVES two dead env reads + the apex fallback; net simplification. |
| 9 | No fabricated data | **PASS** | No data fabricated. |
| 10 | Currency-aware | **N/A** | No currency. |
| 11 | One auth instance | **N/A** | No auth instance touched. |
| 12 | Validate at right time | **PASS** | URL built at CTA-invocation from the canonical constant. |
| 13 | Exclusion consistency | **N/A** | No exclusion logic. |
| 14 | Persisted-state startup gate | **N/A** | No persisted state. |

No violations.

---

## 7. Device / parity matrix

| Surface | Ships here? | Result | Note |
|---------|-------------|--------|------|
| Business Web (buyer/authed) | YES (primary target) | **CONDITIONAL** | Live domain signal: apex 404 vs business 200 SPA shell (PASS); authed CTA→embedded-render deferred (P4-1). |
| Business iOS | YES (same RN codebase) | **source+unit** | Same `taxToolsUrl` + `openAuthSessionAsync` path; wiring proven by adversarial test A. No native-specific delta (opens system browser). Sim live-fire not run (authed brand-payments + Stripe account required; heavy). |
| Business Android | YES (same RN codebase) | **source+unit** | As iOS. |
| Consumer iOS / Consumer Android / Buyer anon Web | NO | skipped | CTA lives in `mingla-business` BrandPaymentsView (brand-owner surface); not present on consumer/anon surfaces. |
| Admin Web | NO | skipped | Not an admin surface. |
| Physical iPhone (HITL) | not invoked | — | Not requested; authed brand w/ Stripe account required. Available as the SC-4 close step if Seth wants it. |

Edge-function / DB / RLS: **N/A** — no backend change (the fix is a client-side URL string). The
`brand-stripe-tax-account-session` edge fn is unchanged by this ORCH.

---

## 8. Discoveries for Orchestrator

- **Pre-existing (not this ORCH):** the business jest corpus carries a large pre-existing failure/backlog — a broad keyword run touched ~615 suites with 130 failed / 222 tests failed, and full `tsc --noEmit` reports **727** pre-existing type errors. In the scoped `src/hooks` run, 2 suites fail — `authScopedQueryReadiness.test.ts` (expo-modules-core "Cannot use import statement outside a module" transform error) and `brandListState.test.ts` (source-text assertion drift on `useCurrentBrand`). Both files + their subjects are **byte-identical to origin/main** (confirmed via `git diff origin/main...HEAD --name-only`), so they are pre-existing and unrelated to ORCH-1284. Flagging as program-level test-health debt, not a blocker here.
- **SC-4 close option:** an operator-driven authed smoke would fully close the embedded-render leg (P4-1).

---

## 9. Accepted conditions (CONDITIONAL PASS)

- **AC-1:** Full authed end-to-end live-fire (CTA → embedded Stripe Tax component paints for a real
  brand) is **deferred/capped**, pre-authorized by the dispatch ("cap the claim honestly if
  blocked"). No follow-up ORCH required unless Seth wants the authed smoke closed; if so, track as a
  P4 verification task, not a code fix. The domain-correctness fix itself is fully proven.

---

## Commands of record

- Implementor test (fixed): `npx jest ...orch1284.test.ts` → 3/3 PASS.
- Implementor test (reverted): 2 failed / 1 passed, `Received: "https://usemingla.com"`.
- Adversarial test (fixed): 3/3 PASS. (reverted): 3/3 FAIL (A host, B garbage-host, C apex-origin).
- Both together (post-commit `658e0a855`): 2 suites / 6 tests PASS.
- Gates: I-PROPOSED-Y 0 violations/2059 files; orch-0955-embedded-tax-ui PASS.
- Typecheck: 0 errors on touched files (727 pre-existing project-wide, unrelated).
- Live: `curl -L usemingla.com/connect-tax-registrations` → 404; `business.usemingla.com/...` → 200 (Mingla Business SPA shell).
