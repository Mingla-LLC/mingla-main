# TEST REPORT — META-ORCH-1187 [Growth Analytics Hub] — Phase 1, LEG 1 (Marketing Web)

**Skill:** mingla-tester (BRUTAL, adversarial)
**Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/` on branch `META-ORCH-1187-growth-analytics-hub`
**HEAD tested:** `66acb0d17`
**Spec (contract):** `Mingla_Artifacts/specs/SPEC_META-ORCH-1187_GROWTH_ANALYTICS_PHASE1.md`
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1187_LEG1_MARKETING_WEB.md`
**Scope under test:** §8 STEP 1 ONLY — marketing web (`mingla-marketing/`). Buyer-web (LEG 2) + native (LEG 3) NOT in this leg.

---

## 1. VERDICT

### CONDITIONAL PASS — P0: 0 · P1: 0 · P2: 2 · P3: 1 · P4: 2

**SECURITY GATE (session-replay PII masking) — labeled result: PASS (source + config + library-level).**
- `maskAllInputs: true` + `maskInputOptions: { password: true, email: true }` + `maskTextSelector: '[data-ph-mask]'` present in the real (comment-stripped) `posthog.init` call (`posthog-provider.tsx:78-83`).
- The masking strict-grep gate FAILS on flip-to-false AND on real-line deletion (independently re-verified below).
- The beta-access email field is covered by `maskAllInputs: true` (global) + `email: true` (belt-and-suspenders). Event properties for `beta_access_submitted` carry NO email/PII (`source`, `status`, `surface_role` only) — no PII leak via event props either.
- **CAP:** the runtime recording inspection (T-16 — view an actual replay of the beta-access email entry and confirm a masked block) is **PENDING LIVE-FIRE (needs deploy + Vercel env + PostHog SA-2 replay-enable).** Source + config + library all prove masking is configured correctly; only the rendered-recording eyeball remains.

**Why CONDITIONAL not PASS:** all runtime SC (events landing in PostHog 479999 / GA4 realtime / fresh-visit cookie inspection / replay-recording inspection) are un-runnable without a deploy + Vercel env — they are correctly the tester's job AFTER Seth sets env, and are marked PENDING LIVE-FIRE. No P0/P1. The two P2s are gate-hardening / report-accuracy, not product defects. Seth must (a) accept the P2s as a fast-follow, or (b) the implementor closes P2-1 before CLOSE. Either way the **product code ships safe today** — consent gate and masking are correctly wired in source.

---

## 2. SC-by-SC matrix (LEG-1 subset)

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1-Marketing | homepage `$pageview` to PostHog + GA4 realtime | PENDING LIVE-FIRE | `capture_pageview:true` + `<GoogleAnalytics>` mounted (`layout.tsx:87`); needs deploy + env. |
| SC-2-Marketing | CTA fires `marketing_cta_clicked`; beta submit fires `beta_access_submitted` | PENDING LIVE-FIRE (source PASS) | capture calls verified in `cta-banner.tsx`, `glass-nav.tsx`, `beta-access-modal.tsx`, `beta-access-submit.ts:82-86`. Runtime = post-deploy. |
| SC-9-SecretHygiene | no `phx_*` in client; only `phc_*` + `G-...` ship | PASS | gate `no-phx-in-client.mjs` PASS (2933 files, 0 `phx_`). Key read via `process.env.NEXT_PUBLIC_POSTHOG_KEY` only; no hardcoded key literal in source. |
| SC-10-Consent-Marketing | fresh visit: banner shows, NO cookies/`$pageview` until Accept; Reject = off | PENDING LIVE-FIRE (source PASS) | `opt_out_capturing_by_default:true` (`provider:72`) + GA4 `consent default` all-denied `beforeInteractive` ahead of `<GoogleAnalytics>` (`layout.tsx:71-73,87`). posthog-js@1.391.2 honors `opt_out_persistence` (verified in lib). Banner Accept→`posthogOptIn()`+GA granted; Reject→`posthogOptOut()`+GA stays denied (`consent-banner.tsx:70-89`). Cookie inspection T-13/14/15 = post-deploy. |
| SC-13/14/15 | flags/surveys/errors smoke | PARTIAL / PENDING | `autocapture:true`+`capture_exceptions:true` wired; no marketing flag/survey call site (spec didn't require one). Verify via PostHog UI after SA-2. |
| SC-16-CostGuard | replay sampling configured; $0 cap (Seth) | PASS (code) + PENDING (SA-1) | `sampleRate: 0.2` (`provider:82`, const `PH_REPLAY_SAMPLE_RATE`). $0 billing cap = Seth action SA-1. |
| SC-Security-Web (config) | masking never false | PASS | gate `replay-masks-pii.mjs` PASS; fails on flip AND deletion (re-verified). |
| SC-Security-Web (recording) | actual replay masks card/email/inputs | PENDING LIVE-FIRE | T-16 — needs deployed site + PostHog replay enabled (SA-2). |
| I-1187-POSTHOG-HOST-US | US host at init | PASS | `api_host:'https://us.i.posthog.com'` (`provider:66`); gate PASS, fails on eu/app host. |
| I-1187-CONSENT-GATE-BEFORE-COOKIES | opt-out-default + GA consent pre-GA | PASS (with P2-1 caveat) | gate PASS; ordering correct (`beforeInteractive` runs before `@next/third-parties` `afterInteractive`). Deletion blind spot = P2-1. |
| I-1187-REPLAY-MASKS-PII | masking on everywhere | PASS | gate PASS, deletion-robust. |
| I-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS | web-only isolation | PASS (marketing) | gate PASS; `posthog-js` imported only from `'use client'` components. Buyer-web/native rules zero-violation today (guard later legs). |

SC-3..8, SC-11, SC-12, SC-Security-Native, T-17, T-19 = LEG 2/3 — out of scope this pass.

---

## 3. Findings

### P2-1 — Consent-gate strict-grep has a fails-on-revert BLIND SPOT against line deletion (+ implementor report inaccuracy)
- **Evidence:** `.github/scripts/strict-grep/i-proposed-1187-consent-gate-before-cookies.mjs:64-76` (section 1) reads RAW file contents (NOT comment-stripped) when asserting `opt_out_capturing_by_default: true`. The provider doc-comment at `posthog-provider.tsx:7` contains the literal `` `opt_out_capturing_by_default: true` ``. I deleted the REAL init line (`provider:72`) via true line-deletion → the gate STILL exited 0 (PASS). Only a flip-to-`false` is caught (section 3 strips comments). Independently reproduced at HEAD `66acb0d17`.
- **Report inaccuracy:** IMPLEMENTATION report §6 claims "deleted the `opt_out_capturing_by_default: true` line → `...consent-gate-before-cookies.mjs` exit 1 (FAIL)." That is **false** — a true deletion passes; they almost certainly flipped-to-false (which does fail) and mislabeled it "deleted."
- **Impact:** the #1 security gate does not fully protect against a future revert-by-deletion of the consent gate on the marketing provider. Product code is CORRECT today (line 72 is present), so live behavior is unaffected — this is a CI-robustness gap, not a runtime hole.
- **Required fix:** in section 1 of the consent gate, comment-strip the provider contents before the `opt_out_capturing_by_default: true` regex (mirror the strip already used in sections 2 & 3). Mitigated NOW by the tester adversarial gate (§5) which already enforces deletion-robustness — but the implementor's own gate should be corrected so the contract is self-consistent.
- **Retest:** delete `provider:72` → both gates must exit 1; restore → exit 0.

### P2-2 — All runtime SC un-verifiable on source alone (PENDING LIVE-FIRE)
- **Evidence:** no Vercel env set, no deploy. SC-1, SC-2, SC-10 (cookie inspection), SC-Security-Web (recording), SC-13/14/15 cannot be proven without a deployed `usemingla.com` build + `NEXT_PUBLIC_POSTHOG_KEY/HOST/GA4_MEASUREMENT_ID` + PostHog SA-1/SA-2.
- **Impact:** "events actually land + cookies actually gated + replay actually masks the email field" is proven by config + library + gates, but not by live observation. Per tester discipline, source-only caps at "suspected"; these stay PENDING.
- **Required fix:** none (expected for a pre-deploy leg). Seth sets env + deploys, then the tester (or Seth) runs the exact steps in §B.
- **Retest:** see the live-fire checklist in the chat handoff.

### P3-1 — `next lint` not configured; marketing has no jest/vitest
- **Evidence:** impl report §9 + confirmed — no eslint config, no test runner in `mingla-marketing`. The §9 "unit/lint test" is delivered as Node structural gates instead.
- **Impact:** no JSX-render unit test for the banner/provider; structural gates are the regression form. Acceptable for this leg (matches §9 intent) but worth a tooling-setup follow-on.
- **Required fix:** none this leg. Orchestrator may register a marketing test-harness ORCH.

### P4-1 (praise) — Clean consent architecture
`opt_out_capturing_by_default:true` + GA4 Consent-Mode-v2 `beforeInteractive` default-denied is the correct, documented dual gate. `beforeInteractive` provably executes ahead of `@next/third-parties`' `afterInteractive` GA scripts (both push to the same `window.dataLayer`, consent-default queued before config). No pre-consent `identify`/`capture`/`opt_in` path exists anywhere in `mingla-marketing` — the only `opt_in_capturing()` is in the banner Accept handler.

### P4-2 (praise) — No PII in event properties
`beta_access_submitted` deliberately omits the email and carries only `source`/`status`/`surface_role`. Combined with `maskAllInputs:true`, PII is protected in both replay and the event stream.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proofs

Re-run by the tester in the worktree (true line-deletion / value-flip, restored after each; tree left clean):

| Gate | Mutation | Tester result | Impl-claim match |
|------|----------|---------------|------------------|
| consent-gate (flip) | `opt_out_capturing_by_default: true`→`false` (`provider:72`) | exit 1 FAIL → restore exit 0 | MATCHES (flip) |
| consent-gate (DELETE) | delete real `provider:72` | exit 0 PASS (BLIND SPOT) | **CONTRADICTS** impl "deleted→exit 1" → P2-1 |
| consent-gate (GA) | `analytics_storage:'denied'`→`'granted'` (`layout.tsx`) | exit 1 FAIL → restore exit 0 | MATCHES |
| replay-masks-pii | `maskAllInputs: true`→`false` (`provider:79`) | exit 1 FAIL → restore exit 0 | MATCHES |
| posthog-host-us | `us.i.posthog.com`→`eu.i.posthog.com` (`provider:66`) | exit 1 FAIL → restore exit 0 | MATCHES |
| layout-mounts (GA) | delete `<GoogleAnalytics gaId={...} />` | exit 1 FAIL → restore exit 0 | MATCHES |
| layout-mounts (provider) | delete `<PostHogProvider />` | exit 1 FAIL → restore exit 0 | MATCHES |

All 6 gates green at HEAD after restore (`git status` clean except the new tester gate file).

## 5. Adversarial test added (tester-owned, different angle)
- **Path:** `.github/scripts/strict-grep/orch-1187-tester-consent-gate-deletion-robust.mjs`
- **Angle:** attacks the P2-1 deletion blind spot directly — comment-strips FIRST, then asserts the REAL `opt_out_capturing_by_default: true` + `maskAllInputs: true` survive, AND that `PostHogProvider` mount never auto-`opt_in_capturing()` (no pre-consent capture), AND the banner is the sole opt-in owner.
- **fails-on-revert verified at HEAD `66acb0d17`:** PASS on shipped code (exit 0); FAIL (exit 1) on deletion of the real opt-out line; FAIL (exit 1) on deletion of the real mask line; PASS on restore. This gate FAILS where the implementor's consent gate has the blind spot (proven side-by-side).
- **In-diff:** appears in `git diff origin/main...HEAD --name-only` once committed to the branch (this report's commit). Append-only — no existing test modified.

## 6. Constitution 14-rule matrix (against the LEG-1 diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | Accept/Reject both wired to `choose()`→`applyConsent`. Explorer "Get the app" stays intentionally dead-locked (NG-1 honored; observe-only capture). |
| 2 | One owner per truth | PASS | consent truth = `localStorage mingla_consent_v1`; PostHog tracks its own opt-state; single `initialized` flag in provider. |
| 3 | No silent failures | PASS | `captureMarketing` swallows transport errors (analytics-non-fatal, documented); missing key = explicit graceful no-op (T-3). No user-facing success masked. |
| 4 | One query key per entity | N/A | no React Query in this leg. |
| 5 | Server state stays server-side | N/A | client-only marketing; no Zustand. |
| 6 | Logout clears everything | N/A | no auth on marketing. |
| 7 | `[TRANSITIONAL]` labeled | N/A | nothing transitional. |
| 8 | Subtract before adding | PASS | footer stale hrefs corrected (subtraction), not duplicated. |
| 9 | No fabricated data | PASS | event props are real (`source`/`status`); no fake values. |
| 10 | Currency-aware | N/A. |
| 11 | One auth instance | N/A. |
| 12 | Validate at the right time | N/A. |
| 13 | Exclusion consistency | N/A. |
| 14 | Persisted-state startup | PASS | banner re-applies stored consent in mount `useEffect` before showing; no flash-capture (PostHog opted-out until applied). |

No violation → no automatic P0.

## 7. Device / parity matrix

| Surface | Result | Note |
|---------|--------|------|
| Marketing Web (`mingla-marketing`) | SOURCE PASS / runtime PENDING LIVE-FIRE | standalone Next.js app; build + typecheck + 7 gates green. Runtime needs deploy. |
| Consumer iOS / Android | N/A | LEG 3 — not touched (confirmed in diff). |
| Buyer/anon Web (`mingla-business`) | N/A | LEG 2 — not touched. |
| Business iOS / Android | N/A | LEG 3 — not touched. |
| Admin Web | N/A | Phase-2 / DO-NOT-TOUCH — not touched. |
| Business Web preview | N/A | LEG 2. |

Marketing is a standalone app — no cross-surface parity obligation this leg. Sim/device matrix N/A (web-only leg; no native/Expo screen). Physical-iPhone HITL: N/A this leg (no native surface).

**Build evidence:** `npm run typecheck` PASS; `npm run build` (clean `.next`) → `✓ Compiled successfully`, `✓ Generating static pages (12/12)`, all routes built, First Load JS shared 102 kB. The ORCH-1083 `__common` 2.25 MB web-bundle budget is a `mingla-business`-specific CI gate and does NOT apply to the separate `mingla-marketing` Next.js app — confirmed not blown / not applicable.

**Scope confirmation (`git diff --stat origin/main...HEAD`):** ONLY `mingla-marketing/**`, `.github/scripts/strict-grep/i-proposed-1187-*.mjs` (6), `.github/workflows/strict-grep-mingla-business.yml` (+marketing trigger + new job), and `Mingla_Artifacts/` docs. NO `next.config.ts`, NO `mingla-admin`, NO buyer-web, NO `app-mobile`, NO `mingla-business` source, NO edge functions, NO Mixpanel/AppsFlyer. CSP untouched.

## 8. Free-tier compliance (spec §4.G / §4.I)
- PASS: NO `posthog.group(` call anywhere in marketing (no paid group analytics). No data-warehouse/export code. Only free-tier flags used (`autocapture`, `capture_exceptions`, `session_recording`).
- PASS: replay `sampleRate: 0.2` set (protects the free 5K-recordings/mo cap). $0 billing cap = Seth SA-1 (out-of-band).

## 9. Discoveries for Orchestrator
- **DISC-1187-T1 (P2-1):** the implementor's `consent-gate-before-cookies.mjs` section-1 does not comment-strip → deletion blind spot on the #1 security gate; the impl report's "deleted→exit 1" claim is inaccurate. The tester adversarial gate already enforces deletion-robustness, but the implementor gate should be corrected for self-consistency. Route as a tiny REWORK or accept as fast-follow.
- **DISC-1187-T2 (P3-1):** `mingla-marketing` has no jest/vitest + no `next lint`. Structural Node gates are the only regression form. If the program wants a banner JSX-render unit test, that is a separate tooling ORCH.
- The 4 cross-tree gates (host-us, no-phx, web-only, replay-masks) scan `mingla-business` + `app-mobile` too and are zero-violation today — they pre-lock the LEG-2/LEG-3 contracts.

## 10. Accepted conditions (CONDITIONAL PASS)
This verdict is CONDITIONAL on ONE of:
1. **Seth/orchestrator accepts P2-1 as a fast-follow** (the gate gap; product code is safe today), OR the implementor applies the one-line comment-strip fix to `consent-gate-before-cookies.mjs` section 1 before CLOSE; AND
2. **The PENDING LIVE-FIRE SC (P2-2)** are run post-deploy per the live-fire checklist before the marketing leg is declared fully verified (CLOSE may proceed for the structurally-verified surface with live-fire tracked as a deploy-gated follow-on, mirroring the spec §11 close note).

No P0, no unaccepted P1 → not a FAIL. Runtime evidence ceiling on source-only is respected (all runtime SC marked PENDING, not PASS).
