# QA ORCH-0778 — ORCH-0777 Web Export Stripe Native Import Gate

Tester: Claude `mingla-tester` (canonical TEST owner per 2026-05-10 reversal of META-ORCH-0755 / DEC-133)
Date: 2026-05-10
Working tree: `.worktrees/orch-0778-orch0777-web-export-stripe-import/`
Branch: `orch-0778-orch0777-web-export-stripe-import`
Verdict: **PASS**

## Mission

Independently verify that the ORCH-0777 Stripe React Native import is platform-gated so `npx expo export --platform web` for `mingla-business` no longer fails on `react-native/Libraries/Utilities/codegenNativeComponent`, while native iOS/Android Stripe PaymentSheet behavior remains the same as ORCH-0777 and there is no fake/local web checkout success path.

## Inputs Read

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0778_ORCH0777_WEB_EXPORT_STRIPE_NATIVE_IMPORT_GATE.md`
- `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0778_ORCH0777_WEB_EXPORT_STRIPE_NATIVE_IMPORT_GATE.md`
- `Mingla_Artifacts/reports/QA_ORCH-0776D_EVENT_COVER_VIDEO_CANCELLED_AT_AND_DETAIL_DEPLOY.md` (discovery D-0776D-QA-1)
- `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`
- Implementation files:
  - `mingla-business/app/_layout.tsx`
  - `mingla-business/app/checkout/[eventId]/payment.tsx`
  - `mingla-business/src/payments/StripeNativeProvider.tsx`
  - `mingla-business/src/payments/StripeNativeProvider.native.tsx`
  - `mingla-business/src/payments/StripeNativeProvider.web.tsx`
  - `mingla-business/src/payments/stripePaymentSheet.ts`
  - `mingla-business/src/payments/stripePaymentSheet.native.ts`
  - `mingla-business/src/payments/stripePaymentSheet.web.ts`
  - `mingla-business/src/services/ticketCheckoutService.ts`
  - `mingla-business/src/components/checkout/PaymentElementStub.tsx`
  - `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs`
  - `mingla-business/package.json`
  - `mingla-business/metro.config.js`

## Verification Summary

| Step | Command / Action | Result |
|---|---|---:|
| 1 | Static repo-wide grep of `@stripe/stripe-react-native` import-form occurrences | PASS — only the two `.native` boundary files have import statements; one JSDoc comment in `PaymentElementStub.tsx` uses backticks (not regex-matched). |
| 2 | `npm run test:orch-0778` (clean) | PASS — `ORCH-0778 web Stripe native import gate passed.` |
| 3 | Inject regression probe (`src/payments/_regression_probe.tsx` with `import { useStripe } from "@stripe/stripe-react-native"`), re-run `npm run test:orch-0778` | PASS (gate behaved correctly) — exit 1, listed the probe file as a violation. Probe removed; re-run returned to passing state. |
| 4 | `npx expo export --platform web` from `mingla-business/` | PASS — exported 44 static routes including `/checkout/[eventId]/payment` (40.2 kB), no `codegenNativeComponent` failure. Sentry config warning + Stripe ConnectJS SSR warning are non-fatal and unrelated to this ORCH. |
| 5 | `grep -c "stripe-react-native" dist/_expo/static/js/web/entry-*.js` | PASS — 0 occurrences. The `@stripe/stripe-react-native` package is not in the web bundle. |
| 6 | `grep -c "codegenNativeComponent" dist/_expo/static/js/web/entry-*.js` | PASS — 0 occurrences. |
| 7 | `grep -c "StripeProvider" dist/_expo/static/js/web/entry-*.js` | PASS — 0 occurrences (native-only provider name absent). |
| 8 | `grep -c "Stripe PaymentSheet is not available on web" dist/_expo/static/js/web/entry-*.js` | PASS — 1 occurrence (web stub's unsupported error message is in the bundle). |
| 9 | `grep -c "Ticket payments are not available on web" dist/_expo/static/js/web/entry-*.js` | PASS — 1 occurrence (web UI copy in `payment.tsx` is in the bundle). |
| 10 | `grep -c "isPaymentSheetSupported" dist/_expo/static/js/web/entry-*.js` | PASS — 2 occurrences (runtime branch present, gates pay button on web). |
| 11 | `npx tsc --noEmit` from `mingla-business/` | PASS — exit 0, no diagnostics. |
| 12 | `npx jest phone.test ticketCheckoutService.test --runInBand` | PASS — 2 suites, 3 tests passed. Watchman recrawl warning is environment-only and unrelated. |
| 13 | `git diff --check` from worktree root | PASS — no whitespace errors. |
| 14 | Native iOS/Android — static + TypeScript parity | PASS — `.native` boundary preserves ORCH-0777 native API surface (`StripeProvider`, `useStripe()`, `initPaymentSheet`, `presentPaymentSheet`). See "Platform Parity Evidence" below for the per-platform breakdown. |

## Platform Parity Evidence

This dispatch's hard guards forbid copying ORCH-0777 Supabase migrations, edge functions, B2 Stripe Connect config, Resend/Twilio, or scanner code into the ORCH-0778 worktree. ORCH-0778 is narrowly the import-boundary fix; live-fire PaymentSheet end-to-end smoke is owned by ORCH-0777 CLOSE. Within those guards, the per-platform evidence is:

### Web — PRIMARY GOAL

- `npx expo export --platform web` succeeds (was previously failing on `codegenNativeComponent`). 44 routes exported including `/checkout/[eventId]/payment`.
- Bundle inspection (greps above) confirms the `@stripe/stripe-react-native` package, `codegenNativeComponent`, and the native `StripeProvider` symbol are completely absent from the web bundle.
- Runtime branch on web: `useStripePaymentSheet().isPaymentSheetSupported === false`. `handlePay` in `payment.tsx` short-circuits with an honest error message BEFORE `createTicketCheckout`, so the web path does NOT create a checkout session, does NOT mark an order paid, and does NOT route to `/confirm`.
- Static UI copy on web: `payment.tsx` line 308 renders "Ticket payments are not available on web yet. Please complete checkout in the Mingla Business mobile app." when `Platform.OS === "web"`.
- Root `<StripeNativeProvider>` on web resolves to `StripeNativeProvider.web.tsx`, which is a pass-through fragment with zero Stripe imports.

### iOS Simulator + Android Emulator — STATIC + TYPESCRIPT EVIDENCE

ORCH-0778 changes the resolution path; it does not change the native API surface. Evidence:

- `StripeNativeProvider.native.tsx` imports `StripeProvider` from `@stripe/stripe-react-native` and passes the configured publishable key — same provider, same key wiring as pre-ORCH-0778 ORCH-0777.
- `stripePaymentSheet.native.ts` imports `useStripe` from `@stripe/stripe-react-native` and returns `{ isPaymentSheetSupported: true, initPaymentSheet, presentPaymentSheet }`. These delegate directly to Stripe React Native's `useStripe()`; the function bodies are pass-through.
- `payment.tsx` calls `initPaymentSheet({ merchantDisplayName: "Mingla", paymentIntentClientSecret, allowsDelayedPaymentMethods: false })` then `presentPaymentSheet()` — same sequence as ORCH-0777.
- `payment.tsx` then polls `pollTicketCheckoutStatus(checkoutSessionId, buyerStatusToken)` and records the server-issued order via `recordResult` — identical to ORCH-0777.
- `npx tsc --noEmit` is clean: the platform-extension swap preserves type signatures.
- Expo's default Metro `sourceExts` resolves `import X from "./StripeNativeProvider"` to `StripeNativeProvider.native.tsx` on iOS/Android and `StripeNativeProvider.web.tsx` on web. `mingla-business/metro.config.js` only overrides `zustand` resolution on web; it does not interfere with platform-extension resolution for these payment modules.

Live-fire native PaymentSheet smoke (real Stripe key + B2 Connect account + Supabase backend deployed + valid PaymentIntent) is **explicitly out of ORCH-0778 scope** per the dispatch hard guards. It is owned by ORCH-0777 live-fire / CLOSE. Treating it as in-scope here would require copying ORCH-0777 backend into this worktree, which the dispatch forbids ("do not copy or mutate Supabase migrations/functions for this TEST pass").

This is documented N/A with reasoning, **not a silent skip**. Re-classify as BLOCKED if and only if a future operator dispatch widens ORCH-0778 scope to include native live-fire.

## Hard-Guard Compliance

| Guard | Status | Evidence |
|---|---:|---|
| Preserve native iOS/Android Stripe PaymentSheet behavior | PASS | `.native` boundary imports `StripeProvider` + `useStripe` from `@stripe/stripe-react-native`, returns identical pass-through to ORCH-0777 native flow; `payment.tsx` native branch unchanged. |
| Do not fake checkout success on web | PASS | Web branch sets `paymentError` and returns BEFORE `createTicketCheckout`. No order is created, no `recordResult` call, no router push to `/confirm`. Web bundle does not import any Stripe SDK that could simulate payment success. |
| Do not broaden into ORCH-0777 live-fire / config / B2 / Resend / Twilio / scanner | PASS | No Supabase migration changes in this worktree, no edge function modifications, no B2 RLS edits, no Resend/Twilio code, no scanner changes. ORCH-0777 frontend files (`buyer.tsx`, `confirm.tsx`, `CartContext.tsx`, `TicketQrCarousel.tsx`, `ticketCheckoutService.ts`, `phone.ts`) were seeded as inputs by the implementor because the original worktree was absent; they are unmodified ORCH-0777 surface, not ORCH-0778 changes. |
| Do not copy or mutate Supabase migrations/functions for this TEST pass | PASS | No files under `supabase/migrations/` or `supabase/functions/` were touched by ORCH-0778. The QA pass itself touched zero supabase paths. |
| Web export no longer fails on Stripe native import | PASS | Verified via successful `npx expo export --platform web` run + bundle content inspection. |
| Regression gate present and effective | PASS | `npm run test:orch-0778` exists, passes on clean tree, fails (exit 1) on injected regression probe. |

## Findings

### P0 — CRITICAL
None.

### P1 — HIGH
None.

### P2 — MEDIUM
None.

### P3 — LOW

**F-0778-QA-1 — `payment.tsx` web branch still references `merchantDisplayName: "Mingla"` literal in unreachable code, ends up as a string in the web bundle.**

- File: `mingla-business/app/checkout/[eventId]/payment.tsx:154-158`
- Severity: P3 LOW (cosmetic — bundle-size only, no behavior or security impact)
- Evidence: `grep -c "merchantDisplayName" dist/_expo/static/js/web/entry-*.js` → 1.
- Why this is benign: The `initPaymentSheet({...})` call is inside the `handlePay` async function and only reachable when `isPaymentSheetSupported === true`. On web, `isPaymentSheetSupported` is `false` and the function short-circuits with the unsupported error BEFORE reaching that line. Metro does not dead-code-eliminate strings inside function bodies; the literal is bundled but never executed. This is consistent with the implementation report's "Static + TypeScript evidence" approach and is not a security or behavior regression.
- Recommended action: None required for ORCH-0778. If desired in a future cosmetic-cleanup ORCH, the native PaymentSheet init args can be moved into the `.native` module so the literal never enters the web bundle at all.

### P4 — NOTE

**F-0778-QA-2 — Clean platform-extension pattern, regression gate, and runtime guard combine for a strong defense-in-depth.**

- The implementation uses three independent mechanisms, any one of which would prevent the regression:
  1. **Build-time gate**: Metro's `.native` / `.web` source extension resolution prevents `@stripe/stripe-react-native` from being included in the web bundle.
  2. **Repo-time gate**: `npm run test:orch-0778` strict-grep scan of `mingla-business/{app,src}` rejects any non-`.native`-boundary import.
  3. **Runtime gate**: `isPaymentSheetSupported` short-circuits `handlePay` BEFORE any Stripe API call or backend session creation on web.
- The dispatch did not require all three; this is the implementor's choice to make the regression class structurally impossible. Worth replicating for future native-only third-party SDKs that may need similar gating (e.g., react-native-permissions, react-native-camera, etc.).

**F-0778-QA-3 — Strict-grep gate is correctly integrated into the existing CI workflow pattern.**

- `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` follows the established strict-grep registry pattern (one script per invariant) — same shape as ORCH-0700/-0712/-0742/etc. gates. Consistent with `feedback_strict_grep_registry_pattern.md` (memory).
- `package.json` `test:orch-0778` script can be invoked locally or wired into `.github/workflows/strict-grep-mingla-business.yml`. Tester did not verify whether the workflow yml was updated to wire this script in CI; that is a separate ORCH-0777-CLOSE / strict-grep-registry housekeeping item, not an ORCH-0778 blocker. The script and `package.json` integration are sufficient for ORCH-0778 PASS criteria.

## Discoveries For Orchestrator

- **D-0778-QA-1 (P3 LOW, deferred)**: The `merchantDisplayName: "Mingla"` literal is in the web bundle as unreachable code. Not a blocker. Optional future cleanup: move PaymentSheet init args into the `.native` module so the literal never enters web bundle.
- **D-0778-QA-2 (process note)**: ORCH-0778 implementor ran in a "recovered" worktree because the dispatched worktree path did not exist at implementation time. The implementor seeded ORCH-0777 frontend inputs (`buyer.tsx`, `confirm.tsx`, `CartContext.tsx`, `TicketQrCarousel.tsx`, `ticketCheckoutService.ts`, `phone.ts`, `test:orch-0777` test files) into this worktree to reproduce the failure context. None of those were modified by ORCH-0778. Orchestrator should be aware that the ORCH-0777 canonical state is on a different (or pending) ORCH-0777 worktree/branch — when ORCH-0777 closes, the orchestrator must reconcile the seeded copies in this branch with the canonical ORCH-0777 branch to avoid lost work or drift. Suggested CLOSE sequence: merge ORCH-0778 first (this is a self-contained fix on top of ORCH-0777 frontend), then ORCH-0777, then verify both `test:orch-0777` and `test:orch-0778` pass on the resulting main.
- **D-0778-QA-3 (process note)**: Native live-fire PaymentSheet smoke (real Stripe key + ticket-checkout-create edge function deployed + B2 Connect account + Supabase backend) is owned by ORCH-0777 CLOSE, not ORCH-0778. This QA pass does not verify it, by design and by the dispatch's hard guards.

## Routing

- Verdict: **PASS**.
- Per the canonical-tester routing table, PASS routes to Codex `orchestrator-mingla` for CLOSE.

## Section 1 — Historical context (paragraph, layman terms)

During the ORCH-0776D event-cover-video tester pass on 2026-05-10, we discovered (D-0776D-QA-1) that the `mingla-business` web export was crashing because the recently-shipped ORCH-0777 ticket checkout pulled in `@stripe/stripe-react-native`, a package that only works on iOS/Android. ORCH-0778 was dispatched to put a "platform wall" between that native-only Stripe code and the web bundle, so the web export could build cleanly while iPhones and Android phones continued to charge cards through Stripe exactly as they did before. The fix had to be surgical — no changes to the live ticketing backend, no fake "successful" payment on web, and no scope-creep into the broader ORCH-0777 stack.

## Section 2 — What was just done (bullet list)

- Read the ORCH-0778 implementation report, dispatch prompt, ORCH-0776D QA discovery, and ORCH-0777 spec + implementation + rework reports.
- Inspected the platform-boundary modules: `StripeNativeProvider.tsx` / `.native.tsx` / `.web.tsx` and `stripePaymentSheet.ts` / `.native.ts` / `.web.ts`.
- Audited `app/_layout.tsx` and `app/checkout/[eventId]/payment.tsx` for direct `@stripe/stripe-react-native` imports — none found outside `.native` files.
- Ran `npm run test:orch-0778` — PASS.
- Injected a regression probe at `mingla-business/src/payments/_regression_probe.tsx` with `import { useStripe } from "@stripe/stripe-react-native"` — gate correctly failed with exit 1 and named the file. Probe deleted, gate returned to PASS.
- Ran `npx expo export --platform web` in `mingla-business/` — exported 44 routes including `/checkout/[eventId]/payment` with no `codegenNativeComponent` failure.
- Inspected the resulting web JS bundle: 0 occurrences of `stripe-react-native`, 0 of `codegenNativeComponent`, 0 of `StripeProvider`; web unsupported copy and `isPaymentSheetSupported` runtime branch are present.
- Ran `npx tsc --noEmit` — clean.
- Ran `npx jest phone.test ticketCheckoutService.test --runInBand` — 3/3 tests passed.
- Confirmed `git diff --check` clean.
- Wrote QA report: `Mingla_Artifacts/reports/QA_ORCH-0778_ORCH0777_WEB_EXPORT_STRIPE_NATIVE_IMPORT_GATE.md` — verdict PASS with 0 P0/P1/P2, 1 P3 (cosmetic bundle-size note), 3 P4 (notes for orchestrator).

## Section 3 — What needs to happen (paragraph, layman terms)

ORCH-0778 passes. The web export is unblocked, the regression gate works in both directions, and the native iOS/Android Stripe code path is preserved with byte-equivalent imports and types. The next step is for Codex `orchestrator-mingla` to run the ORCH-0778 CLOSE — update artifacts, lock in the new strict-grep gate as an active invariant, and decide the merge order between ORCH-0778 and the still-open ORCH-0777 (the implementor's note suggests ORCH-0778 first, then ORCH-0777). When ORCH-0777 itself closes, that pass owns the native live-fire PaymentSheet smoke test — ORCH-0778 does not.

## Section 4 — Exact handoff message

NEXT HANDOFF — paste into Codex `orchestrator-mingla`:

ORCH-0778 ORCH-0777 web export Stripe native import gate is **PASS** per the canonical-tester QA report at `Mingla_Artifacts/reports/QA_ORCH-0778_ORCH0777_WEB_EXPORT_STRIPE_NATIVE_IMPORT_GATE.md` (worktree `.worktrees/orch-0778-orch0777-web-export-stripe-import/`). Verification covered: strict-grep gate (`npm run test:orch-0778`) passes clean and correctly fails with exit 1 on an injected `@stripe/stripe-react-native` import outside the `.native` boundary; `npx expo export --platform web` from `mingla-business/` succeeds and the resulting web bundle contains zero occurrences of `stripe-react-native`, `codegenNativeComponent`, or `StripeProvider`; `npx tsc --noEmit` clean; `npx jest phone.test ticketCheckoutService.test` 3/3 pass; native iOS/Android PaymentSheet code path preserved via `.native` platform-extension files that delegate identically to ORCH-0777 (live-fire native smoke is documented as ORCH-0777 CLOSE's responsibility, not ORCH-0778's). Goal of the CLOSE pass: update artifacts (DECISION_LOG, INVARIANT_REGISTRY for the new strict-grep invariant, MASTER_BUG_LIST entry for D-0776D-QA-1 → ORCH-0778 → CLOSED, AGENT_HANDOFFS, WORLD_MAP), wire the new strict-grep script into `.github/workflows/strict-grep-mingla-business.yml` if not already wired, reconcile the seeded ORCH-0777 frontend files in this worktree with the canonical ORCH-0777 branch when ORCH-0777 closes (see Discovery D-0778-QA-2 for suggested merge order: 0778 first, then 0777), and provide the operator with the `git add` + commit message for ORCH-0778. Hard guards for CLOSE: do not touch ORCH-0777 backend/B2/Resend/Twilio/scanner, do not deploy edge functions for ORCH-0778 (none exist), and do not modify Supabase migrations/functions in this worktree. Outputs expected: `Mingla_Artifacts/CLOSE_NOTE_ORCH-0778.md` (or equivalent CLOSE artifact per current orchestrator pattern), updated indexes, and a single commit message for the operator to use.
