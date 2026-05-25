# REVIEW — META-ORCH-0952 [Buyer-web confirm pipeline deep forensics] — Implementation

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-24
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]`
**Branch:** `meta-orch-0952-buyer-web-confirm-deep-forensics`
**Bundle reviewed:** commit `b8d5300a` + uncommitted scoped implementation
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md` (with Amendments 1 + 2 + 3)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md`

---

## Verdict: APPROVED — proceed to TEST

Codex implementor delivered a proven-root-cause fix with full browser regression coverage, six-field DIAG isolation evidence, scoped-allowlist discipline, and honest accounting of remaining manual gates. The `qrCard` shrink-wrap fix + carousel rewrite + root `useRef(Date.now())` hardening + Expo Router `web.output: "static" → "single"` switch land the multi-ticket carousel cleanly on Chromium + WebKit + Firefox with zero React #418 pageerrors. SC-6 native regression gap is accepted as a tester manual gate (justified below — not requiring implementor rework). One orchestrator-side discovery is flagged for DECISION_LOG capture at CLOSE.

---

## Review checklist results

| Check | Result | Notes |
|---|---|---|
| Root cause proven? | YES | Discriminator probe (10 routes × 2 runs) deterministic: `static` reproduced #418 on `/auth` + `/home` + checkout; `single` eliminated it everywhere. Six-field evidence complete per finding F1 (#418 root cause) + F2/F3 (carousel deadlock). |
| Scope appropriate? | YES | Stayed strictly within Amendments 1+2+3 allowlist. `app.config.ts` was authorized but implementor chose not to edit it (narrower than needed — good discipline). |
| Hidden fallback paths? | NO | Carousel web path goes straight to mounted subtree; no silent-failure branches added. |
| Stale cache? | N/A | Fresh `expo export -p web` per probe run; bundle hash captured. |
| Response shape truthful in all states? | YES | Implementor honestly labels SC-6 as "manual gate remains" not "PASS." Fails-on-revert scope honestly excludes HP-03 (single-ticket already worked). |
| Real fix or symptom mask? | REAL | Proven structural cause (Expo static-export hydration) + proven eliminating change. Not a workaround. |
| Solo/collab parity? | N/A | Buyer-anonymous web; no auth/collab dimension. |
| Constitutional compliance? | PASS | Constitution #14 (persisted-state startup): `useRef(Date.now())` render-time divergence eliminated. Constitution #3 (no silent failures): error boundary fully reaped per SC-7. No fabricated data. |
| Hard guards intact? | YES | Confirmed by implementor + verified by allowlist diff: zero touches to DB, Supabase migrations, edge functions, Stripe, `CartContext.tsx`, `buildQrPayload`, consumer mobile (`app-mobile/`), admin (`mingla-admin/`), QR schema, edge deploys. No DIAG markers in source (`rg` returned zero). |
| Evidence chain complete? | YES | 9/9 browser test PASS captured + 6/6 fails-on-revert FAIL captured + DIAG reap grep clean + discriminator-probe table + isolation-attempts table + old→new file receipts. |
| Documents updated? | DEFERRED TO CLOSE | This is an APPROVE-to-TEST gate; DECISION_LOG / WORLD_MAP / MASTER_BUG_LIST / COVERAGE_MAP / PRIORITY_BOARD updates happen at CLOSE per protocol Step 1. |

---

## SC-by-SC mapping

| Criterion | Status | Verdict |
|---|---|---|
| **SC-1** HP-01 PASS on Chromium + WebKit + Firefox (3-ticket trip) | PASS | 9/9 in CI=1 run |
| **SC-2** HP-02 PASS on Chromium + WebKit + Firefox (3-ticket event) | PASS | Same run |
| **SC-3** HP-03 PASS on Chromium + WebKit + Firefox (1-ticket regression guard) | PASS | Same run |
| **SC-4** Tester adversarial test PASS | DEFERRED TO TEST | Adversarial test is tester's scope per SPEC §7 |
| **SC-5** Manual operator iPhone-Safari production check post-deploy | DEFERRED TO POST-DEPLOY | Cannot run pre-merge; tester's BC-11 covers physical iPhone in the live matrix |
| **SC-6** Manual native iOS/Android regression check (no native code path changed) | DEFERRED TO TEST | See "SC-6 decision" below |
| **SC-7** Zero `[META-ORCH-0952-DIAG]` matches | PASS | `rg` grep clean across all 4 surfaces |
| **SC-8** Zero `ORCH-0930 v3` / `useState initializer pattern` strings in confirm.tsx | PASS | `rg` grep clean |
| **SC-9** Implementation report documents the actual source of React #418 + the specific eliminating change | PASS | Root cause: Expo Router `web.output: "static"` SSR pre-render hydration. Eliminating change: `app.json` `web.output: "static" → "single"`. `useRef(Date.now())` hardening also documented as defense-in-depth (kept because it removes a real divergence even with `single`). |
| **SC-10** Strict-grep CI gate registered if warranted | NOT REGISTERED | SPEC §10 makes this optional ("Implementor MAY defer to follow-up META-ORCH"). Implementor deferred. Acceptable. The new invariant `I-PROPOSED-BUYER-WEB-CAROUSEL-BROWSER-TESTED` will flip to ACTIVE at CLOSE via INVARIANT_REGISTRY update, with CI gate as a follow-up ORCH if operator wants it. |

---

## SC-6 decision: ACCEPT as tester manual gate (no implementor rework)

**Question:** does the SC-6 native regression gap require implementor rework, or can it be discharged by Claude `mingla-tester`'s live BC-10/BC-11 matrix?

**Decision: ACCEPT as tester manual gate.** Tester runs SC-6 + BC-10 (iOS dev build + Android dev build paid 3-ticket trip-confirm) as part of the live matrix per BC-11 + the tester's standing parity-enforcement rule. No implementor rework required.

**Justification:**

1. **No native code path was changed in `TicketQrCarousel`.** Implementor preserved the native branch (`Platform.OS !== "web"` keeps numeric `pageWidth` + the `pageWidth === 0` early-return). Web/native split is clean. Native regression risk is structurally bounded to the two ambient changes below.
2. **`qrCard.alignItems: "center"` removal affects native too** — both RN and RNW honor `alignItems`. BUT the carousel internally centers via `styles.host.alignItems: "center"` (TicketQrCarousel.tsx L226), so visual centering is preserved. Low regression risk; tester verifies visually.
3. **Root `app/_layout.tsx useRef(Date.now())` hardening affects native too** — initializer changed from `Date.now()` to `null` + set in useEffect. On native there is no SSR, so this changes nothing functionally; splash elapsed math still works. Trivial regression risk.
4. **Tester is the right gate for visual native verification.** Per operator's standing rule `feedback_tester_canonical_and_platform_parity.md` and `feedback_tester_3sims_plus_operator_physical.md`: tester owns the live matrix (3 sims + physical iPhone) and is structurally positioned to drive a paid 3-ticket trip through iOS dev build + Android dev build with operator-assisted Stripe purchase. Pushing this back to implementor would duplicate work and not change the verification quality.
5. **Implementor's environment gap is honest, not negligent.** Android emulator was booted but the business package wasn't installed and there's no native test fixture in the worktree to drive a paid 3-ticket confirm state. That's an environment provisioning question for the tester's session, not an implementor failure.

**Risk assessment if I'm wrong about native parity:** worst case, tester surfaces a native regression in BC-10, returns FAIL, and we re-dispatch to implementor with a narrow rework scope (likely just restoring `qrCard.alignItems` on native via Platform.select). Cost is one retest cycle. Acceptable.

---

## Discoveries for orchestrator (capture at CLOSE)

1. **`web.output: "static" → "single"` is a project-level architectural decision** broader than the buyer-web carousel scope. The implementor's discriminator probe proved every route under `static` was vulnerable to #418 (or at least `/auth` + `/home` were already firing it in production), so the change is justified — but the implications (no SSR, no static-route pre-rendering for SEO/marketing, slightly different first-paint behavior) should be captured in `Mingla_Artifacts/DECISION_LOG.md` at CLOSE as a named decision with the discriminator probe as the evidence link. If mingla-business web ever needs SSG for SEO-critical pages (e.g., the `/e/{brandSlug}/{eventSlug}` event-public route or `/b/{brandSlug}` brand pages), a future ORCH will need to revisit per-route export config rather than the bundle-wide setting.
2. **Pre-existing typecheck failures across ~6 unrelated files** (checkout buyer files, marketing rich editor, IconChrome, Sheet.web, missing `@mingla/payments-native`, package typings) — flagged by implementor as not introduced by this ORCH. Worth a follow-up triage sweep but NOT blocking META-ORCH-0952.
3. **Strict-grep CI gate for `I-PROPOSED-BUYER-WEB-CAROUSEL-BROWSER-TESTED`** was deferred per SPEC §10 escape valve. Orchestrator should decide at CLOSE whether to register a follow-up ORCH for the CI gate or accept the invariant as enforceable via the (now-immutable) regression tests alone.
4. **Source-string test deletion citation** — implementor deleted `orch_0930_qr_carousel_mounted_guard.test.tsx`; CLOSE commit body MUST include `[TEST-MOD-APPROVED META-ORCH-0952]` per `feedback_close_commit_precommit_checks.md` and ORCH-0840.

---

## Praise (P4)

- Discriminator probe was run cleanly with two repeated runs — exactly what Amendment 3 demanded. The probe table is the gold standard for cross-route hydration analysis.
- DIAG instrumentation + reaping was disciplined: error boundary + render loggers added, used to capture trace evidence, then completely removed before report submission. `rg` grep clean.
- Honesty about SC-6 native gap (called out as "manual gate remains" rather than handwaved as PASS) is the right tester-handoff posture.
- `app.config.ts` was authorized under Amendment 3 but not touched. Scope discipline — touched only what evidence required.

---

## Routing decision

**APPROVED → TEST.** Claude `mingla-tester` (canonical TEST owner per `feedback_tester_canonical_and_platform_parity.md`) runs the live BC-11 matrix:

- HP-01/HP-02/HP-03 re-verification on Chromium + WebKit + Firefox (independent rerun)
- Tester-written adversarial regression test (SPEC §7 viewport-resize-during-mount vector) at `mingla-business/src/components/checkout/__tests__/meta_orch_0952_carousel_adversarial.test.ts` with `fails-on-revert verified` documented
- SC-6 native regression on iOS Simulator (worktree-assigned `iPhone 17 Pro 17091E60-...`) + Android Emulator (install business APK if needed — flag to operator for unblock if package missing)
- BC-11 physical iPhone Safari check (after operator-approved deploy, or against branch preview if tester can drive it)
- Parity gate per tester step 7 (mandatory — no PASS without it)

If TEST returns PASS or CONDITIONAL PASS with accepted conditions → orchestrator CLOSE protocol (Step 0.5 regression gate + Step 1 7-doc sync + Step 1.5 DIAG reap re-verify + Step 1.7 worktree reap + Step 2 commit with `[deploy]` tag + `[TEST-MOD-APPROVED META-ORCH-0952]` body + Step 2.5 Vercel gate verify + Step 4 announce next). If TEST returns FAIL → back to implementor REWORK with cited findings.

---

## Pre-merge gate forward-look (for CLOSE planning)

When tester returns PASS and orchestrator opens the CLOSE PR:

- Vercel `[deploy]` tag REQUIRED (touches `mingla-business/app/`, `mingla-business/src/`, `mingla-business/playwright/`, plus `app.json` config — all Vercel build inputs).
- `[TEST-MOD-APPROVED META-ORCH-0952]` REQUIRED in commit body for the source-string test deletion.
- No edge function deploys (none touched).
- No Supabase migrations (none touched).
- No EAS OTA (no `app-mobile/` changes).
- DECISION_LOG entry for the `web.output` change (Discovery #1 above).
- INVARIANT_REGISTRY entry flipping `I-PROPOSED-BUYER-WEB-CAROUSEL-BROWSER-TESTED` to ACTIVE.
- Worktree reap via `scripts/orch-worktree/reap.sh`.
