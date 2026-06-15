# IMPLEMENTATION — ORCH-1139 [Stripe setup redirects to business sign-in]

- **Phase:** IMPLEMENT (binding SPEC executed)
- **Date:** 2026-06-15
- **Skill:** mingla-implementor + claude
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1139-[stripe-connect-route-gate]/` on branch `ORCH-1139-stripe-connect-route-gate` (rebased onto origin/main, 0 behind)
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1139_STRIPE_SETUP_REDIRECTS_TO_SIGNIN.md`
- **Status:** implemented and verified (gate-level). Device SC-4/SC-5 are the tester's runtime gate.
- **Implementation commit:** `e8d091da4`
- **Comms ledger:** read on entry. No BLOCK/WARN row addressed to ORCH-1139 / mingla-implementor / ALL requires action (COMMS-0029 is an ORCH-1119/1120 trip-migration matter; this ORCH touches no migration). COMMS-0021 (Stripe seller-copy rename) is copy-only and out of this ORCH's allowlist — no route/path impact. No new cross-ORCH discovery → no COMMS write.

---

## 1. Summary

A logged-in business user who tapped "Set up payments" / "Connect bank" was bounced to the business sign-in screen instead of the Stripe Connect onboarding form. Root cause (investigation F-1): the native CTA opens the WEB `/connect-onboarding` page in a SESSIONLESS in-app browser; ORCH-1102's route-agnostic root-layout gate redirects every web route without a Supabase web session to `/` (sign-in), and its only escape hatch (`PUBLIC_BUYER_ROUTE_PREFIXES`, ORCH-1115) was scoped to anon buyer routes — never the self-authenticating Stripe-Connect seller routes.

The fix is an allowlist extension only: two new, semantically-distinct exemption sets (`SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` = 6 connect routes; `INVITE_ACCEPT_ROUTE_PREFIXES` = 2 invite routes) plus the segment-safe matcher `isSelfAuthenticatedExemptRoute`, ANDed into both the web predicate `shouldRedirectToSignInFromRoute` and the native `nativeRedirectToSignIn` path. Plus the DRAFT closure invariant test that forces every top-level `app/` route into exactly one classified bucket. No CTA-routing, edge-function, or connect-page-body change.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `e8d091da4`) |
|----|-----------|--------|-------------------------------|
| SC-1 | logged-out web → no redirect on all 8 exempt routes | ✓ | `orch_1139_connect_seller_route_allowlist` T-A1/A2/A3 (bare + sub-path) |
| SC-2 | logged-out → STILL redirect on private routes | ✓ | T-A4 (`/account`, `/(tabs)/home`, `/brand/123`, `/notifications`) |
| SC-3 | segment-safety on near-miss/traversal | ✓ (matcher built identical to 1115; tester owns the adversarial file per SPEC) | matcher uses `normalized === base \|\| startsWith(base + "/")` |
| SC-4-iOS / SC-4-Android | device: CTA opens Stripe form, not sign-in | UNVERIFIED (tester device gate) | parity automatic via shared `coldLoadAuthGates.ts`; tester verifies ≥1 platform |
| SC-5 | direct sessionless web visit renders connect page | UNVERIFIED (tester runtime gate) | web predicate now returns false for `/connect-onboarding` (T-A1) |
| SC-6 | `PUBLIC_BUYER_ROUTE_PREFIXES` byte-for-byte unchanged | ✓ | 1115 T-9 (exactly 9 prefixes) still passes |
| SC-7 | each constant defined once; web+native consult matcher | ✓ | T-A7 (`source.match` count === 1; `_layout.tsx` contains `!isSelfAuthenticatedExemptRoute(pathname)`) |
| SC-8 | every top-level `app/` route classified into exactly one bucket | ✓ | `orch_1139_route_gate_closure` T-C1 (live enumeration === seeded map) |

UNVERIFIED items (SC-4/SC-5) are runtime/device gates the SPEC assigns to the tester (§12 downstream routing); they are not code-implementable at the gate layer.

---

## 3. Files changed

| File | Change | Δ lines |
|------|--------|---------|
| `mingla-business/src/utils/coldLoadAuthGates.ts` | +2 constants + matcher + AND exemption into `shouldRedirectToSignInFromRoute` + doc-comment | +~110 |
| `mingla-business/app/_layout.tsx` | import `isSelfAuthenticatedExemptRoute` + AND into `nativeRedirectToSignIn` + comment | +~9 |
| `mingla-business/src/utils/__tests__/orch_1115_anon_buyer_route_allowlist.test.ts` | removed `/connect-partner-onboarding` + `/stripe-onboarding-return` from `AUTHED_ONLY_ROUTE_SAMPLES` ([TEST-MOD-APPROVED ORCH-1139]) | -2 / +6 comment |
| `mingla-business/src/utils/__tests__/orch_1139_connect_seller_route_allowlist.test.ts` | NEW implementor happy-path | +~250 |
| `mingla-business/__tests__/orch_1139_route_gate_closure.test.ts` | NEW closure-invariant | +~210 |

All committed in `e8d091da4`. Working tree clean (`git status --short` empty, `git diff HEAD` empty after fails-on-revert proofs restored).

---

## 4. Data-model changes applied

None. Client-route-gate only. No DB / RLS / migration / edge / service / hook / realtime change.

---

## 5. Edge functions touched

None. (`brand-stripe-onboard` already enforces auth server-side at link creation — investigation reconciliation. No deploy required for this ORCH.)

---

## 6. Regression tests added

- **Happy-path (implementor):** `mingla-business/src/utils/__tests__/orch_1139_connect_seller_route_allowlist.test.ts` — 44 tests (T-A1..A7).
- **Closure invariant:** `mingla-business/__tests__/orch_1139_route_gate_closure.test.ts` — 33 tests (T-C1, I-PROPOSED-1139-ROUTE-GATE-CLOSURE).
- **Modified (approved):** `orch_1115_anon_buyer_route_allowlist.test.ts` — removed two now-exempt samples; `/accept-invite` kept as negative control. `[TEST-MOD-APPROVED ORCH-1139]` in commit body.

**fails-on-revert verified at commit `e8d091da4`:**

- **Gate clause (happy-path):** deleted `&& !isSelfAuthenticatedExemptRoute(pathname)` from `shouldRedirectToSignInFromRoute` → `orch_1139_connect_seller_route_allowlist`: **20 failed, 24 passed** (T-A1/A2/A3 flip redirect→true and FAIL; T-A4 private routes stay true and PASS). Restored → **44 passed**.
- **Closure invariant:** removed `/stripe-onboarding-return` from `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` → `orch_1139_route_gate_closure`: **2 failed, 31 passed** (route reclassifies connect-exempt → gated-default, contradicting the seeded map). Restored → **33 passed**.

Full restored suite: **227 passed across 6 suites** (`orch_1139` × 2, `orch_1115`, `androidWebOnlyConnectRoutes`, `orch1100ColdLoadAuthGates`).

---

## 7. Old → New receipts

### `mingla-business/src/utils/coldLoadAuthGates.ts`
**Before:** only `PUBLIC_BUYER_ROUTE_PREFIXES` / `isPublicBuyerRoute` exempted routes from the sign-in redirect; connect-seller + invite routes had no exemption.
**Now:** adds `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` (6), `INVITE_ACCEPT_ROUTE_PREFIXES` (2), and `isSelfAuthenticatedExemptRoute` (segment-safe matcher over the union). `shouldRedirectToSignInFromRoute` now ANDs `&& !isSelfAuthenticatedExemptRoute(pathname)`.
**Why:** SC-1/SC-2/SC-7 — exempt the self-authenticating routes (out-of-band URL credential, no Supabase session) without widening the buyer allowlist.
**Lines:** +~110.

### `mingla-business/app/_layout.tsx`
**Before:** `nativeRedirectToSignIn` ANDed only `!isSignInRoute(pathname) && !isPublicBuyerRoute(pathname)`.
**Now:** imports `isSelfAuthenticatedExemptRoute`; `nativeRedirectToSignIn` also ANDs `&& !isSelfAuthenticatedExemptRoute(pathname)` (no-op on native today; keeps the exemption in one place, hardens against a future native connect/invite route — same rationale as the ORCH-1115 note).
**Why:** SC-7 — single source of truth; web + native lockstep.
**Lines:** +~9.

### `orch_1115_anon_buyer_route_allowlist.test.ts`
**Before:** `AUTHED_ONLY_ROUTE_SAMPLES` asserted `/connect-partner-onboarding` + `/stripe-onboarding-return` STILL redirect.
**Now:** both removed (now exempt → would make T-2 fail); `/accept-invite` retained as a negative control (not a real route → correctly still redirects).
**Why:** SPEC §9 step 3.

---

## 8. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS (`app-mobile`) | NO | n/a — different app |
| 2 | Consumer Android (`app-mobile`) | NO | n/a |
| 3 | Buyer/anon Web | NO (already 1115) | buyer allowlist untouched |
| 4 | Business iOS | YES — CTA opens Stripe form, not sign-in | Automatic (shared gate) |
| 5 | Business Android | YES — same web-bundle path | Automatic (shared gate) |
| 6 | Admin Web | NO | separate app |
| 7 | Business Web preview | YES — direct sessionless visit renders connect/invite page | Automatic (shared gate) |

Single allowlist change in the shared `coldLoadAuthGates.ts` serves all three affected surfaces — parity automatic.

---

## 9. Smoke result

Gate-layer verification only (this ORCH is a pure client-route-gate predicate change with no device-buildable UI of its own):
- jest: 227 passed / 6 suites.
- strict-grep `orch-1105-layout-no-self-redirect.mjs`: self-test PASS (4/4), live PASS (loop guard intact; no unguarded `/` self-redirect — my change preserves `nativeRedirectToSignIn`'s `!isSignInRoute(...)` clause).
- `tsc --noEmit`: zero errors in any touched file.
- fails-on-revert: proven for both the gate clause and the closure invariant (§6).

Device SC-4/SC-5 deferred to tester per SPEC §12.

---

## 10. Known issues / deferred

- None. No `[TRANSITIONAL]` code added. `/stripe-onboarding-return` is `@deprecated` (ORCH-0954) but still live for legacy TEST hosted-onboarding returns — exempted per SPEC §5 because its mount-time self-redirect would otherwise be bounced first; no change to its body.

---

## 11. Operator action required

- None for this ORCH (no migration, no edge deploy). Route to **mingla-orchestrator REVIEW** → **mingla-tester** (writes the Step-0.5(b) adversarial `orch_1139_connect_route_segment_safety.test.ts` independently + runs device SC-4 / web SC-5) → **CLOSE** (flips `I-PROPOSED-1139-ROUTE-GATE-CLOSURE` ACTIVE, registers in `INVARIANT_REGISTRY.md`, World-Map sync).

---

## 12. Discoveries for orchestrator

- None outside scope. The closure test reads the live `app/` directory: any NEW top-level route added later WITHOUT seeding it in the test's `EXPECTED` map will redden the closure test — that is the invariant working as designed (it forces classification of every new route).

---

## SPEC deviations

None. The two SPEC symbol names matched the real file exactly (`shouldRedirectToSignInFromRoute`, `nativeRedirectToSignIn`, `isPublicBuyerRoute`). The matcher reuses ORCH-1115's exact segment-safe normalization (duplicated verbatim rather than factored into a shared private helper — correctness-over-DRY, which the SPEC explicitly permits in §4.1.3). All 8 exempt routes, both constant names, the matcher name, and the predicate wiring are implemented exactly as specified.
