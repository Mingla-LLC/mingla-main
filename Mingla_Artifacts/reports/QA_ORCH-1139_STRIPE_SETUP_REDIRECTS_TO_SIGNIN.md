# QA — ORCH-1139 [Stripe setup redirects to business sign-in]

- **Phase:** TEST (mingla-tester, brutal gatekeeper)
- **Date:** 2026-06-15
- **Skill:** mingla-tester + claude
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1139-[stripe-connect-route-gate]/` on branch `ORCH-1139-stripe-connect-route-gate`
- **Implementation under test:** commit `e8d091da4` (+ docs `df9bfd8d4`)
- **QA test commit:** `1bf5b43a0`
- **Comms ledger:** read on entry. No BLOCK-OPEN row addressed to mingla-tester / ORCH-1139 / ALL. All OPEN rows are WARN→ALL for unrelated ORCHs (COMMS-0029 trip-migration; COMMS-0030 iOS-build now RESOLVED; COMMS-0003/0021 Stripe-copy/external-API-docs — this ORCH touches no Stripe payload/enum/copy, only a client route-gate predicate). No new cross-ORCH discovery → no COMMS write.

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2

The gate-layer fix is **correct, real, and not a symptom mask** (proven by exhaustive jest + independent fails-on-revert + segment-safety adversarial test). The verdict is capped at **CONDITIONAL PASS (not full PASS)** ONLY because the two runtime success criteria SC-4 (device CTA reaches Stripe form) and SC-5 (sessionless web visit renders) could **not** be proven at runtime this turn — the runtime web environment was genuinely blocked (details §7), and SC-4 is structurally un-provable pre-deploy (the native CTA opens the *deployed production* web URL, not this branch). Source + jest reasoning on these two runtime SCs is therefore capped at **suspected** per tester discipline; they are NOT fabricated as device passes.

There are no defects requiring rework. The single P3 + two P4s are observations, not blockers. If the orchestrator/Seth accepts the runtime SCs as deferred-to-deploy (the fix cannot reach a faithful runtime until the branch web is deployed), this is effectively a PASS on the implementable surface.

---

## 2. SC-by-SC matrix

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | logged-out web → no redirect on all 8 exempt routes (bare + sub-path) | **PASS** | `orch_1139_connect_seller_route_allowlist` T-A1/A2/A3 — 44/44; independently re-run green |
| SC-2 | logged-out → STILL redirect on private routes (`/account`, `/(tabs)/home`, `/brand/123`, `/notifications`) | **PASS** | T-A4 green; my adversarial ADV-3 control cases green |
| SC-3 | segment-safety on near-miss/traversal lookalikes | **PASS (proven)** | my `orch_1139_connect_route_segment_safety.test.ts` — 73/73; fails-on-revert (loosen→`includes`) = 43 fail |
| SC-4-iOS / SC-4-Android | device: "Set up payments"/"Connect bank" opens Stripe form, not sign-in | **suspected (runtime BLOCKED)** | structurally un-provable pre-deploy: CTA opens the *deployed prod* web URL (`result.onboarding_url` → `business.usemingla.com/connect-onboarding?session=…`), not the branch (`BrandOnboardView.tsx:384`). Gate logic that *would* run is the same shared `coldLoadAuthGates.ts` proven by SC-1/SC-3. |
| SC-5 | direct sessionless web visit renders connect page, not `/` | **suspected (runtime BLOCKED)** | web export SPA-fallback → "No routes found" (output:single static-serve limitation); `expo start --web` in this worktree bundled the **stock Expo template placeholder** ("Welcome to Expo", 614 modules), not the real app — neither gives a faithful runtime. Web predicate returns `false` for the 8 routes by unit proof (SC-1). |
| SC-6 | `PUBLIC_BUYER_ROUTE_PREFIXES` byte-for-byte unchanged | **PASS** | `git diff origin/main...HEAD` shows zero change to the constant body or `isPublicBuyerRoute`; 1115 T-9 (exactly 9 prefixes) still green |
| SC-7 | each constant defined once; web + native both consult the matcher | **PASS** | T-A7 (`source.match` count === 1) green; `_layout.tsx` ANDs `!isSelfAuthenticatedExemptRoute(pathname)` into BOTH paths (verified §4) |
| SC-8 | every top-level `app/` route classified into exactly one bucket | **PASS** | `orch_1139_route_gate_closure` 33/33; fails-on-revert (remove a connect prefix) = 2 fail, reproduced |

---

## 3. Both-predicates-covered finding (mandate item 1)

**CONFIRMED — the exemption is ANDed into BOTH the web predicate AND the native path. A web-only fix would have left native theoretically broken; this fix covers both.**

- **Matcher is segment-safe (not a loose `includes`/`startsWith`):** `coldLoadAuthGates.ts:255-273` — normalizes (trim → strip single trailing slash for `length>1`) then `normalized === base || normalized.startsWith(\`${base}/\`)` over the union of the two sets. Identical to the proven ORCH-1115 `isPublicBuyerRoute` normalization.
- **Constants are SEPARATE from `PUBLIC_BUYER_ROUTE_PREFIXES`:** `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` (6) + `INVITE_ACCEPT_ROUTE_PREFIXES` (2) are distinct exports (`:208`, `:232`); the buyer constant is untouched (SC-6).
- **Web predicate (`shouldRedirectToSignInFromRoute`, `:302-318`):** ANDs `&& !isSelfAuthenticatedExemptRoute(pathname)` as the 4th conjunct (composes after `isSignInRoute` + `isPublicBuyerRoute`; can ONLY flip `true`→`false`).
- **Native predicate (`nativeRedirectToSignIn`, `app/_layout.tsx:363-369`):** ALSO ANDs `&& !isSelfAuthenticatedExemptRoute(pathname)` (no-op on native today — business-native serves none of these — but keeps the allowlist in one place and hardens a future native connect/invite route; same rationale as the ORCH-1115 note). Import added at `:80`.

Architecturally clean: one shared helper, one allowlist, consulted by both code paths. This is a real fix, not a symptom mask.

---

## 4. Findings (P-numbered)

### P3-1 — `expo start --web` bundles the stock Expo template in this worktree (env hygiene, not a code defect)
- **Evidence:** `npx expo start --web --port 8092` produced "Web Bundled index.js (614 modules)" and headless Chromium rendered the default Expo Router starter ("Welcome to Expo · Start by creating a file in the app directory") at `/`, `/connect-onboarding`, and `/b/some-brand` alike. The real mingla-business app is thousands of modules.
- **Impact:** the dev-web runtime path could not faithfully exercise the gate this turn — it is the wrong bundle entirely. This is an environment/worktree Metro-entry issue, NOT a product defect (jest imports the real `coldLoadAuthGates.ts` and passes; the production app on Vercel is unaffected).
- **Required fix:** none for the ORCH; flag for env follow-up (likely a Metro/`main` entry resolution quirk in the freshly-spawned worktree). Does not block close.
- **Retest:** after the branch web is deployed to a preview URL, re-run the SC-5 probe (`playwright/orch1139-connect-gate-runtime-probe.mjs`) against it.

### P4-1 (praise) — matcher reuses the proven ORCH-1115 normalization verbatim
Correctness-over-DRY (SPEC §4.1.3-permitted). The duplicated segment-safe normalization is byte-identical to `isPublicBuyerRoute`, so the proven 1115 behavior carries over with zero new logic risk.

### P4-2 (praise) — closure invariant test converts a latent P0 into a CI failure
`orch_1139_route_gate_closure.test.ts` reads the live `app/` dir and forces every new top-level route into exactly one classification bucket. This is the structural root-cause fix for the *class* of bug behind both ORCH-1115 and ORCH-1139 (a new route silently inheriting "redirect to sign-in"). Excellent defense-in-depth.

---

## 5. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out commit `e8d091da4` (HEAD-2; the implementation commit), re-ran both proofs myself by true line-deletion:

| Proof | Mutation | Implementor claimed | I observed (independent) | Match |
|-------|----------|--------------------|--------------------------|-------|
| Gate clause | delete `&& !isSelfAuthenticatedExemptRoute(pathname)` from `shouldRedirectToSignInFromRoute` | 20 failed, 24 passed | **20 failed, 24 passed** | ✓ exact |
| Closure invariant | remove `/stripe-onboarding-return` from `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` | 2 failed, 31 passed | **2 failed, 31 passed** | ✓ exact |

Both restored → green (44/44, 33/33). File restored byte-for-byte (`diff -q` clean). Implementor's fails-on-revert is genuine, not claimed.

---

## 6. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/src/utils/__tests__/orch_1139_connect_route_segment_safety.test.ts`
- **Commit:** `1bf5b43a0` (on-branch, in `git diff origin/main...HEAD --name-only` — verified).
- **Angle (DIFFERENT from implementor happy-path):** the implementor proves exempt routes are NOT redirected. My suite attacks the **false-positive / boundary** failure mode — crafted near-miss/traversal/case/junk/query-smuggled paths that must STILL redirect, proving the matcher exempts ONLY the intended routes + sub-paths and never a loose substring. 73 tests across ADV-1..ADV-8.
  - ADV-1 suffix lookalikes (`/connect-onboarding-evil`, `/connect-onboardingX`, `/stripe-onboarding-return-fake`, `/accept-brand-invitationX`)
  - ADV-2 traversal / substring-in-the-middle (`/x/connect-onboarding`, `/foo/connect-onboarding`, `/account/connect-onboarding`, `/brand/123/connect-onboarding`)
  - ADV-3 every MUST_NOT_MATCH path rejected
  - ADV-4 case variants (`/Connect-Onboarding`, `/CONNECT-ONBOARDING`) do not match
  - ADV-5 query-string smuggling cannot flip a private route exempt
  - ADV-6 null/empty/whitespace never match (no crash)
  - ADV-7 legitimate exempt routes (bare / trailing-slash / sub-path) DO match
  - ADV-8 regression sentinel — re-derives loose `includes`/`startsWith` inline and proves the production matcher DIVERGES from them on exactly the dangerous boundary cases (and AGREES on the legit cases)
- **fails-on-revert verified at commit `e8d091da4` (matcher loosened to `normalized.includes(base)`):** suite went to **43 failed, 30 passed** — the loose matcher leaks `/connect-onboarding-evil`, `/x/connect-onboarding`, `/account/connect-onboarding`, `/connect-onboardingfoo`, `/accept-brand-invitationX`, etc.; every leak caught. Restored → **73/73 passed**. Gate file restored byte-for-byte (`diff -q` clean).
- **Both tests appear in the closing diff:** implementor `orch_1139_connect_seller_route_allowlist.test.ts` + tester `orch_1139_connect_route_segment_safety.test.ts` both in `git diff origin/main...HEAD --name-only`. Regression gate satisfied.

---

## 7. Runtime-evidence status (explicit — what I could and could NOT verify at runtime)

**Could NOT verify at runtime this turn — both runtime SCs are capped at `suspected`:**

- **SC-5 (sessionless web render):** TWO runtime attempts, both blocked by environment:
  1. `web:export` (output:single) served by the META-ORCH-0952 static server (SPA fallback): every non-root route threw `Error: No routes found` from the Expo Router store on hard-load — a static-serve limitation of `output:single` (the production Vercel rewrites are not replicated by the simple static server). The connect-route string IS present in the bundle, so the route exists; the static server just can't hand the deep path to the router on cold load.
  2. `expo start --web` dev server: bundled the **stock Expo template placeholder** (614 modules, "Welcome to Expo"), not the real app — wrong bundle (see P3-1). Every route uniformly bounced to `/` showing the template, INCLUDING the proven-exempt buyer route `/b/some-brand` (which is shipped-and-working in production) — confirming the uniform bounce is the wrong-bundle/dev-cold-load artifact, NOT the gate.

- **SC-4 (device CTA reaches Stripe form):** **structurally un-provable pre-deploy.** `BrandOnboardView.handleStart` (`:384`) opens `WebBrowser.openAuthSessionAsync(result.onboarding_url, …)` where `result.onboarding_url` is the **deployed production** web URL (`business.usemingla.com/connect-onboarding?session=…`). The gate that runs in that in-app browser is the *deployed* web bundle (origin/main, pre-fix), NOT this branch. A logged-in sim session would exercise the OLD gate. SC-4 cannot be device-proven until this branch's web is deployed. The business app IS installed on the booted iOS sim (`com.sethogieva.minglabusiness`), but pointing it at the branch gate is impossible without a deploy.

**Could verify at runtime / statically (proven):**
- All 8 exempt routes + sub-paths exist as real `app/` files (SPEC §5 grep re-verified).
- The connect-route string is in the production web bundle (export grep).
- The gate predicate logic is exhaustively unit-proven (301 jest tests, 2 independent fails-on-revert).

**Conclusion:** the runtime web environment is a genuine blocker requiring a branch deploy; it is NOT downgraded silently — SC-4/SC-5 are held at `suspected` and the verdict is capped at CONDITIONAL PASS accordingly. The cleanest unblock is to deploy the branch web to a Vercel preview, then re-run `playwright/orch1139-connect-gate-runtime-probe.mjs` against it (and, post-deploy, a device SC-4 tap).

---

## 8. Regression results (mandate item 4)

| Check | Result |
|-------|--------|
| Buyer routes (`/e/ /t/ /b/ /exp/ /checkout/ /checkout-trip/ /checkout-experience/ /o/ /booking/`) still exempt | **PASS** — 1115 happy-path suite green; `PUBLIC_BUYER_ROUTE_PREFIXES` + `isPublicBuyerRoute` byte-for-byte unchanged (git diff); 1115 path-confusion adversarial suite green |
| 1115 buyer behavior neither widened nor narrowed | **PASS** — only doc-comment + the `&&` append-line reference `isPublicBuyerRoute`; the constant + matcher body are untouched |
| Genuinely-private route (`/account`, `/(tabs)/home`, `/brand/123`, `/notifications`) STILL redirects unauthenticated | **PASS** — T-A4 + my ADV-3 controls green |
| ORCH-1103 self-redirect loop guard preserved | **PASS** — `isSignInRoute` ANDed first; strict-grep `orch-1105-layout-no-self-redirect.mjs` PASS |
| META-ORCH-0972 Android web-SDK quarantine | **PASS** — `androidWebOnlyConnectRoutes.test.ts` green; no connect-route-file or metro change |
| `tsc --noEmit` on touched files | **PASS** — zero errors in `coldLoadAuthGates.ts`, `_layout.tsx`, both new tests |
| strict-grep gates (`orch-1105-layout-no-self-redirect`, `orch-1105-no-route-stub-gates`, `orch-1105-web-gesture-safe`, `orch-1056-connect-page-shared-styles`) | **PASS (4/4)** |

**Full relevant jest:** 301 passed / 7 suites (`orch_1139` ×2, `orch_1139_route_gate_closure`, `orch_1115` ×2, `orch_1103_signout_redirect_loop`, `androidWebOnlyConnectRoutes`).

---

## 9. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | no UI added (pure predicate); the fix RESTORES a tap (CTA → form) — anti-dead-tap |
| 2 | One owner per truth | **PASS** | exemption defined once in `coldLoadAuthGates.ts`; both paths consult the one helper (SC-7) |
| 3 | No silent failures | **PASS** | exemption can only suppress a redirect on a known-safe route; private routes still redirect (no swallow) |
| 4 | One query key per entity | N/A | no query |
| 5 | Server state server-side | N/A | no state |
| 6 | Logout clears everything | N/A | no auth-state mutation |
| 7 | Label `[TRANSITIONAL]` | **PASS** | none added; `/stripe-onboarding-return` is pre-existing `@deprecated`, body untouched |
| 8 | Subtract before adding | **PASS** | allowlist extension only; no parallel mechanism; reuses 1115 normalization |
| 9 | No fabricated data | N/A | no data |
| 10 | Currency-aware | N/A | no money |
| 11 | One auth instance | **PASS** | reads existing `user`/`hasStoredWebSession`; no new auth |
| 12 | Validate at right time | **PASS** | gate composes after auth resolves (`!loading`); exemption is purely path-based |
| 13 | Exclusion consistency | **PASS** | three distinct exemption classes (buyer / connect-seller / invite), each reasoned independently; closure test enforces exactly-one-bucket |
| 14 | Persisted-state startup | N/A | no hydration gate touched |

Zero violations.

---

## 10. Device / parity matrix

| # | Surface | Status | Note |
|---|---------|--------|------|
| 1 | Consumer iOS (`app-mobile`) | N/A | different app; unaffected |
| 2 | Consumer Android (`app-mobile`) | N/A | different app |
| 3 | Buyer/anon Web | PASS (regression) | buyer allowlist untouched; 1115 suites green |
| 4 | Business iOS | **suspected (BLOCKED)** | SC-4 un-provable pre-deploy (CTA opens deployed prod web, not branch); sim has the app installed but cannot point at branch gate. Gate logic shared + unit-proven. |
| 5 | Business Android | **suspected (BLOCKED)** | same shared web-bundle path; physical Samsung A72 present but same pre-deploy constraint |
| 6 | Admin Web | N/A | separate app |
| 7 | Business Web preview | **suspected (BLOCKED)** | SC-5 runtime env blocked (P3-1 + static-serve limit); needs branch deploy |

Physical-iPhone HITL: not invoked — SC-4 is structurally un-provable pre-deploy regardless of device, so a manual tap would exercise the OLD deployed gate and prove nothing about this branch. Reserved for post-deploy retest.

---

## 11. Discoveries for Orchestrator

- **D-1 (env):** `expo start --web` in this freshly-spawned worktree bundles the stock Expo template, not the real app (P3-1). Likely a Metro/`main`-entry resolution quirk specific to the worktree. Worth a one-line env check before any future web-runtime QA in spawned worktrees — the `web:export` path produced the real bundle, so the export pipeline is fine; only the dev-web entry is off.
- **D-2 (process):** SC-4/SC-5 for any client-route-gate that the NATIVE app reaches via an in-app browser to the *deployed* web URL are inherently post-deploy gates. Future SPECs of this shape should mark SC-4/SC-5 as "verify on the preview/prod deploy" rather than "tester device gate," to avoid a structural BLOCKED at TEST time.

---

## 12. Accepted conditions (CONDITIONAL PASS)

The two runtime SCs are deferred, NOT defects:

- **SC-4 (device CTA reaches Stripe form)** — deferred to post-deploy device retest. Structurally un-provable pre-deploy.
- **SC-5 (sessionless web render)** — deferred to a branch web preview deploy, then re-run `playwright/orch1139-connect-gate-runtime-probe.mjs` against the preview URL.

The implementable surface (the gate predicate, both code paths, segment-safety, regression, closure invariant) is fully PROVEN. If Seth/orchestrator accepts the runtime SCs as deploy-gated, this is a clean pass to CLOSE with a post-deploy runtime confirmation step.
