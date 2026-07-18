# INVESTIGATION — ORCH-1387 [latent Apple Pay type bug in business native checkout — `applePay` passed but not an accepted `PaymentSheetInitInput` property]

Date: 2026-07-17 · Phase: INVESTIGATE (no fix proposed) · mingla-forensics (Claude)
Worktree: `~/Desktop/mingla-orchs/ORCH-1387-[applepay-type-plumbing]/` branch `ORCH-1387-applepay-type-plumbing`
Dispatch: orchestrator, per ORCH-1385 report §12 D-4 + WORLD_MAP stanza (2026-07-17)
Probes: `/tmp/orch-1387/` · Evidence: `Mingla_Artifacts/evidence/ORCH-1387/`

---

## HEADLINE VERDICT

**World W1 is real. The `applePay` field is NOT dropped — it flows untyped through every layer
into the Stripe SDK's native Apple Pay configuration, cart items included.** This is a
type-contract gap (plus a tsconfig-paths gap and zero threading-test coverage), not a runtime
outage. W2 (silent drop / Apple Pay dark) is **RULED OUT at every code layer**: our hook forwards
the whole object with no destructuring; the installed vendor SDK (0.65.1) documents, reads, and
natively parses the key.

Confidence: **W1 proven at Docs/Schema-type/Code layers (source-complete, installed-vendor-verified);
runtime capped at probable** — the Apple Pay sheet is device-only, and prod data contains **zero
completed payments since build-15 shipped**, so no live payment corroborates (or refutes) anything.
The physical-iPhone leg is named for TEST. Two operator-checkable Stripe PI ids are listed in F-8.

Compliance exposure (Apple 4.9): the ORCH-1246 product-line fix **does reach** the native
`PKPaymentSummaryItem` config (so the sheet should show the event title, never "Mingla"), and
Apple approved the 1.1.2 binaries carrying this exact code — but **no test anywhere proves the
threading**, so a future refactor could silently drop `applePay` and every existing gate/test
would stay green. That is the real, remaining 4.9 risk.

---

## 1. Symptom summary

- **Expected (per D-4 framing):** `initPaymentSheet` input should type-check; either the field is
  accepted by the contract or it is dropped at runtime.
- **Actual:** `mingla-business/src/payments/nativeCheckoutFlow.native.ts:351` passes `applePay`
  (and `:363` passes `googlePay`) into a parameter typed `PaymentSheetInitInput`
  (`packages/payments-native/types.ts:20-51`) which declares neither key. tsc never saw it because
  `@mingla/payments-native` is the ONE workspace package absent from `mingla-business/tsconfig.json`
  `paths`. Live question: does the field reach Stripe at runtime (W1) or get dropped (W2)?

## 2. Investigation manifest (all read verbatim)

| # | File | Why |
|---|------|-----|
| 1 | `Mingla_Artifacts/WORLD_MAP.md` §Issue Registry ORCH-1387 stanza (line 1340) | dispatch context + Seth context + archaeology |
| 2 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1385_PHONE_INPUT_DEP.md` §SC-4 + §12 D-1..D-8 | how the bug surfaced; environment caveats |
| 3 | `mingla-business/src/payments/nativeCheckoutFlow.native.ts` (432 lines) | the callsite (`:327-368`) |
| 4 | `mingla-business/src/payments/applePayCartItems.ts` (39 lines) | the 4.9 helper |
| 5 | `packages/payments-native/useStripePaymentSheet.ts` (125) | the consuming hook — spread-vs-destructure question |
| 6 | `packages/payments-native/types.ts` (59) | `PaymentSheetInitInput` — the narrow contract |
| 7 | `packages/payments-native/index.ts`, `normalizePaymentSheetResult.ts`, `StripeNativeProvider.tsx` | whole package |
| 8 | `mingla-business/src/payments/__tests__/applePayCartItems.orch1246.test.ts` (45) | what ORCH-1246's tests actually assert |
| 9 | commit `1c46b2700` (PR #693, ORCH-1246) full message + stat + diffs | the origin |
| 10 | `node_modules/@stripe/stripe-react-native@0.65.1` — `lib/typescript/src/types/PaymentSheet.d.ts`, `types/ApplePay.d.ts`, `lib/commonjs/functions.js` (initPaymentSheet + toNativePaymentSheetSetupParams), `src/specs/NativeStripeSdkModule.ts`, `ios/StripeSdkImpl+PaymentSheet.swift`, `ios/ApplePayUtils.swift`, `ios/StripeSdkImpl.swift`, `android/.../PaymentSheetFragment→PaymentSheetManager.kt` | INSTALLED vendor truth at every hop (per `feedback_external_api_docs_verified`) |
| 11 | `app-mobile/src/payments/nativeCheckoutFlow.ts` (applePay block `:308-345`), `app-mobile/src/hooks/useReserveTable.ts` (`:100-150`) | consumer mirrors / blast radius |
| 12 | `mingla-business/tsconfig.json`, `app-mobile/tsconfig.json` | paths gap A/B |
| 13 | `mingla-business/src/payments/StripeProviderWrapper.native.tsx` | provider mount parity |
| 14 | `Mingla_Artifacts/reports/INVESTIGATION_REJECTION_applepay_passkit.md` (2026-07-03, 112 lines) | prior sealed saga for this exact surface |
| 15 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` — I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY, I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST | invariant impact |
| 16 | `.github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs` (grep for applePay/cartItems) | gate coverage check |
| 17 | `supabase/functions/stripe-webhook/index.ts` (persistence greps) + prod schema/data via Supabase MCP (read-only) | Data layer |
| 18 | `Mingla_Artifacts/MASTER_BUG_LIST.md` ORCH-1387/1385 stanzas | registry state |

## 3. Q-scorecard

**Q1 — Where does `applePay` GO? (W1 vs W2)**
Traced end-to-end with the installed SDK: callsite → hook (`await initPaymentSheet(input)` —
whole-object forward, no destructure) → SDK JS (`initPaymentSheet` explicitly reads
`params.applePay?.setOrderTracking`; `toNativePaymentSheetSetupParams` is a no-op without a
`checkout` key) → TurboModule spec (`params: UnsafeObject<PaymentSheet.SetupParams>` — no
codegen filtering) → iOS Swift (`params["applePay"] as? NSDictionary` →
`buildPaymentSheetApplePayConfig` → `PKPaymentSummaryItem`s). TypeScript types are erased at
runtime; nothing anywhere picks known fields.
**Verdict: W1 — field reaches the native Apple Pay config, cartItems included. Code-layer proven;
runtime probable (device-only cap, F-8/F-9).**

**Q2 — Does the vendor SDK accept our exact shapes?**
`SetupParamsBase.applePay?: ApplePayParams` (`{ merchantCountryCode: string; cartItems?:
CartSummaryItem[]; … }`); `ImmediateCartSummaryItem = { paymentType:'Immediate'; isPending?;
label; amount }`; `SetupParamsBase.googlePay?: GooglePayParams` (`{ merchantCountryCode;
currencyCode?; testEnv?; … }`). All three of our payloads match field-for-field.
**Verdict: YES — verified against installed 0.65.1 types in node_modules, not memory.**

**Q3 — What do the ORCH-1246 tests ACTUALLY assert?**
`applePayCartItems.orch1246.test.ts` = 5 pure unit tests of `buildApplePayCartItems` (label =
product never company, fallback, trim, `(cents/100).toFixed(2)`, single item). They fail-on-revert
for the HELPER only. **No test anywhere asserts the threading** (that `applePay`/`cartItems` is
passed to `initPaymentSheet`), no type-level test, no runtime test. The parity CI gate
`i-stripe-paymentsheet-parity.mjs` (R-1..R-8) contains zero `applePay`/`cartItems` rules.
**Verdict: helper-math coverage only; the commit's "applePay cartItems fails-on-revert" claim is
true for the helper, false for the wiring.**

**Q4 — Is `@mingla/payments-native` really absent from mingla-business tsconfig paths, and what
does adding it change?**
Absent — the only one of the six `@mingla/*` packages missing (5 present: brand-rendering,
offering-rendering, theme-animations, phone-input, location-input). A/B probe (untracked
`tsconfig.orch1387probe.json`, extends base, only `paths` overridden; removed after run):
baseline 945 error-lines → probe 953; the 2× TS2307 cannot-find-module vanish and
**`src/payments/nativeCheckoutFlow.native.ts(351,9): error TS2353: Object literal may only specify
known properties, and 'applePay' does not exist in type 'PaymentSheetInitInput'`** surfaces,
plus 10 package-internal errors (triage in Q5). Full diff: `evidence/ORCH-1387/tsc-ab-diff.txt`.
**Verdict: confirmed; adding the mapping is what makes the latent error visible to business tsc.**

**Q5 — Triage of the surfaced package-internal errors.**
In THIS environment (anchor node_modules is stale pre-1385 — no `@mingla/*` symlinks, so the
package's own deps don't resolve): 5× TS2307 (`react` ×2, `expo-constants`,
`@stripe/stripe-react-native` ×2) = **install-state artifacts**, resolve under a real post-1385
`npm ci`; 4× TS7031 implicit-any props in `StripeNativeProvider.tsx:76-79` = **downstream of the
missing React types** (with `React.FC<Props>` resolvable they type); 1× TS2353 = **the real
product bug**. The ORCH-1385 implementor's full-install run counted 11 latent errors with a
different composition; the exact full-install enumeration should be re-run at IMPLEMENT
verification time. **Verdict: exactly ONE proven product-code type error (TS2353 @ :351); the
rest are environment/install artifacts in this tree — none block runtime (nothing here is
tsc-gated in CI, per D-6).**

**Q6 — Did `applePay` EVER match a type (narrowed later)?**
No. `git log -S "applePay" -- packages/payments-native/` = empty; `types.ts` was created in the
`492fe343d` bundle (ORCH-0837-era) and last touched by ORCH-0844 (`7a4c84601`) — before the
wallet blocks existed. The wallet blocks landed in BOTH apps in `5fead2cb0` (ORCH-0847 close,
carrying the ORCH-0849 HOTFIX of 2026-05-15) — AFTER the hook had moved into the package, where
mingla-business tsc could not see it. ORCH-1246 (`1c46b2700`, 2026-06-30) only added `cartItems`
INSIDE the already-untyped `applePay` block. **Verdict: the contract never accepted the field at
any point; nothing was narrowed.**

**Q7 — Google Pay analog?**
Yes, same class, same callsites: `googlePay` at `nativeCheckoutFlow.native.ts:363` (business) and
`app-mobile/nativeCheckoutFlow.ts:335` is equally not in `PaymentSheetInitInput` — masked in tsc
output because TS2353 reports the first excess key of the literal. Runtime is the same W1
pass-through: Android native reads `args.getMap("googlePay")` → `.googlePay(config)`
(`PaymentSheetManager.kt:124,166`). **Verdict: identical latent type gap, identical (working)
runtime flow; any type fix must add BOTH keys or the error just moves from :351 to :363.**

**Q8 — Data layer: have Apple Pay payments occurred in native business checkout since build-15?**
The DB **cannot answer wallet type**: zero `%wallet%` columns anywhere; no edge function reads
`payment_method_details`; `ticket_checkout_sessions` has no `surface` column and `metadata` is
empty on all rows. Volume truth (read-only prod): all-time post-wipe = 9 ticket sessions total —
**2 `paid_completed`, both 2026-06-27 (PRE-build-15/1246)**, 5 processing_payment, 1 failed,
1 expired; `reservation_checkout_sessions` = 0. Since 2026-06-30: only 2 sessions, both stuck
`processing_payment`, live-mode Connect PIs `pi_3ToXuJI4pBxuXrhh0OaFDbwh` (2026-07-01, $10.00)
and `pi_3TooOQI4pBxuXrhh0cZrpJqL` (2026-07-02, $20.00). **Verdict: no completed payment has ever
run through the 1246 code path in prod; wallet-type truth lives ONLY in the Stripe dashboard
(charge → payment_method_details.card.wallet) — operator check for Seth on the 4 PIs above/via
the 2026-06-27 sessions.**

**Q9 — Runtime layer: any init failure signal in the wild?**
Sentry (org mingla-llc, all projects, 90d): **zero** events matching
PaymentSheet/initPaymentSheet/applePay. Weak-negative only: `initPaymentSheet` errors return by
value (`result.error` → toast), they are not thrown, so Sentry would only see an explicit
capture; and payment volume is near zero. The sanctioned partial probe (vendor-source option
parsing) shows the extra key CANNOT cause an init validation error: the only throw-paths are
`missingMerchantId` (set — per-PI `initStripe` with `merchant.com.sethogieva.minglabusiness`,
Swift `StripeSdkImpl.swift:159,183`) and `missingCountryCode` (set — `"US"`); unknown dict keys
are simply never read. **Verdict: no runtime error evidence, and no mechanism by which the extra
key could fail init.**

## 4. Findings (six-field)

### F-1 — `applePay`/`googlePay` are excess properties on `PaymentSheetInitInput`; runtime flows them anyway (W1)
1. **Symptom:** TS2353 at `nativeCheckoutFlow.native.ts(351,9)` once the package resolves; no
   user-visible runtime symptom.
2. **Layer:** code (type contract) vs runtime — a Docs/Schema-vs-Code contradiction, not a bug in behavior.
3. **Probe:** in-worktree probe tsconfig A/B (`npx tsc --noEmit -p tsconfig.orch1387probe.json`);
   vendor-source trace of every hop (manifest #10).
4. **Evidence:** `useStripePaymentSheet.ts:84` `await initPaymentSheet(input)` (whole object, no
   destructure); vendor `functions.js`: `_params$applePay=params.applePay` +
   `toNativePaymentSheetSetupParams` returns `params` unchanged without a `checkout` key; spec
   `NativeStripeSdkModule.ts:79-81` `initPaymentSheet(params: UnsafeObject<PaymentSheet.SetupParams>)`;
   Swift `StripeSdkImpl+PaymentSheet.swift:27-38` parses `params["applePay"]` →
   `ApplePayUtils.buildPaymentSheetApplePayConfig` → `buildPaymentSummaryItem` `"Immediate"` case.
   Diff artifact: `evidence/ORCH-1387/tsc-ab-diff.txt`.
5. **Mechanism:** TS types are erased at runtime; the only entity that ever enforced
   `PaymentSheetInitInput` was tsc, and tsc couldn't resolve the module in mingla-business. The
   narrow package type simply post-dates nothing and pre-dates the wallet blocks (Q6); every
   runtime hop passes the dictionary through.
6. **Severity:** CONFIRMED ROOT CAUSE (of the type error; W2 outage RULED OUT — see F-9).

### F-2 — ORCH-1246 test coverage proves helper math, not threading
1. **Symptom:** "15/15 incl. applePay cartItems fails-on-revert" reads as wiring coverage; it isn't.
2. **Layer:** docs (commit claim) vs code (tests).
3. **Probe:** read `applePayCartItems.orch1246.test.ts` (all 5 tests); grep parity gate + repo for
   any threading assertion (`grep -rn "applePay\|cartItems" .github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs …` → empty).
4. **Evidence:** tests import and call `buildApplePayCartItems` directly; zero references to
   `initPaymentSheet`/`nativeCheckoutFlow` in any applePay test; parity gate R-1..R-8 has no
   applePay rule.
5. **Mechanism:** reverting the helper fails tests; deleting the `applePay:` block (or the
   `cartItems:` line) from the callsite fails NOTHING — the 4.9 behavior has no regression net.
6. **Severity:** SECONDARY ROOT CAUSE (this coverage gap is the actual 4.9 compliance exposure).

### F-3 — tsconfig-paths gap: payments-native is the one missing `@mingla` package
1. **Symptom:** business tsc emitted 2× TS2307 for the package pre-1385; consuming files' imports
   were `any`, disabling all downstream checking.
2. **Layer:** schema (compiler config).
3. **Probe:** parsed `mingla-business/tsconfig.json` paths; A/B probe per Q4.
4. **Evidence:** paths block lists brand-rendering / offering-rendering / theme-animations /
   phone-input / location-input — not payments-native; A/B: −2 TS2307, +TS2353(:351), +10 pkg-internal.
5. **Mechanism:** without the mapping (and with the anchor's pre-1385 node_modules lacking
   `@mingla` symlinks) tsc cannot resolve the module → the entire native payment surface has been
   type-unchecked in mingla-business since META-ORCH-0827 moved the hook into the package.
6. **Severity:** SECONDARY ROOT CAUSE (the visibility mechanism that hid F-1 from business tsc).

### F-4 — Consumer app has the SAME error, visible in its baseline all along
1. **Symptom:** `app-mobile/src/payments/nativeCheckoutFlow.ts(327,9): error TS2353 … 'applePay'
   does not exist in type 'PaymentSheetInitInput'` in a plain `npx tsc --noEmit` run today.
2. **Layer:** code (cross-surface).
3. **Probe:** `npx tsc --noEmit` in worktree app-mobile (`evidence/ORCH-1387/tsc-appmobile-applepay-excerpt.txt`).
4. **Evidence:** app-mobile `tsconfig.json:19-20` HAS the payments-native paths mapping; the error
   sits inside the ~1031-line baseline that is not a CI gate (ORCH-1385 D-6).
5. **Mechanism:** same excess property, same shared hook; visible-but-untreated because tsc output
   is diff-vs-baseline, never absolute.
6. **Severity:** SUSPECTED CONTRIBUTOR → scope datum: any type fix is a shared-package,
   BOTH-apps change.

### F-5 — A prior ORCH already documented the gap and cast around it (`useReserveTable`)
1. **Symptom:** consumer Reserve flow shows NO TS2353 despite passing the same wallet config.
2. **Layer:** code.
3. **Probe:** read `app-mobile/src/hooks/useReserveTable.ts:110-147`.
4. **Evidence:** verbatim comment: "it is not on the shared @mingla/payments-native
   PaymentSheetInitInput type (the package type predates the wallet config; the native SDK accepts
   it at runtime — exactly as nativeCheckoutFlow does). Pass it via a typed extension …" followed
   by `...(walletConfig as Record<string, unknown>)` spread into the typed call.
5. **Mechanism:** spreading a non-literal defeats excess-property checking — a deliberate,
   documented workaround (ORCH-1244 era) that is ALSO first-party documentary evidence for W1
   ("the native SDK accepts it at runtime").
6. **Severity:** SUSPECTED CONTRIBUTOR (pattern divergence across the three callsites; the cast
   suppresses ALL type checking of the wallet payload — worse than the raw excess property).

### F-6 — Installed vendor contract verified: our payloads match 0.65.1 exactly
1. **Symptom:** n/a (verification finding).
2. **Layer:** docs/vendor.
3. **Probe:** read `PaymentSheet.d.ts` + `ApplePay.d.ts` in the installed package (version
   confirmed 0.65.1 via package.json + lockfile).
4. **Evidence:** `applePay?: ApplePayParams` ("iOS only. Enable Apple Pay in the Payment Sheet…"),
   `ApplePayParams.merchantCountryCode: string` + `cartItems?: CartSummaryItem[]`;
   `ImmediateCartSummaryItem { paymentType:'Immediate'; label; amount }`;
   `googlePay?: GooglePayParams { merchantCountryCode; currencyCode?; testEnv? }`.
5. **Mechanism:** the correct type extension target is exactly the shape we already send; the
   helper's `ApplePayCartItem` interface is a faithful subset mirror of the vendor type.
6. **Severity:** RULED OUT (as a risk): no shape mismatch exists.

### F-7 — 4.9 compliance state
1. **Symptom:** Apple flagged wallet sheets showing the company name (consumer rejection ORCH-1244;
   business pre-empt ORCH-1246).
2. **Layer:** runtime/compliance.
3. **Probe:** code trace (F-1) + saga `INVESTIGATION_REJECTION_applepay_passkit.md` (2026-07-03) +
   launch state (1.1.2 approved & live both stores, API-verified 2026-07-15).
4. **Evidence:** cartItems reach `PKPaymentSummaryItem` (F-1); the 2026-07-03 forensic
   independently concluded "Apple Pay IS a real, wired, live feature … via PaymentSheet's applePay
   config"; Apple approved the binaries carrying this code.
5. **Mechanism:** the product-line fix is live in the config Apple reviews; the exposure is not
   "the fix doesn't work" but "nothing fails if someone removes it" (F-2), and the sheet's actual
   rendering has never been eyeballed on a device post-1246 (F-8: no completed prod payments).
6. **Severity:** RULED OUT as an active regression; OPEN residual risk = coverage gap (F-2) +
   device verification debt (TEST leg).

### F-8 — Data layer cannot see wallet type; near-zero payment volume post-build-15
1. **Symptom:** "Apple Pay has been working" (Seth, to be verified) — DB can neither confirm nor deny.
2. **Layer:** data.
3. **Probe:** read-only SQL via Supabase MCP (information_schema + status rollups + the two
   post-6/30 rows); grep of all edge functions for `payment_method_details|wallet`.
4. **Evidence:** zero wallet columns repo-wide; `metadata` empty on all sessions; no `surface`
   column; all-time: 2 paid_completed (both 2026-06-27, pre-1246), post-6/30: only
   `pi_3ToXuJI4pBxuXrhh0OaFDbwh` + `pi_3TooOQI4pBxuXrhh0cZrpJqL`, both stuck `processing_payment`.
5. **Mechanism:** wallet-type truth exists only on Stripe's side
   (`charge.payment_method_details.card.wallet.type == "apple_pay"`); an operator dashboard check
   on those PIs (and the two 06-27 completed sessions' PIs) is the only way to know whether Apple
   Pay has ever been used.
6. **Severity:** CONFIRMED (as a data-layer gap statement); operator check named in Open Questions.

### F-9 — W2 (silent drop / Apple Pay dark) — RULED OUT
1. **Symptom:** hypothesized by the dispatch.
2. **Layer:** code + runtime-mechanics.
3. **Probe:** the full hop-by-hop trace (Q1) + throw-path audit (Q9).
4. **Evidence:** no destructuring/picking anywhere between callsite and native parse; TurboModule
   `UnsafeObject` does not filter; Swift reads the key; only throw-paths are satisfied inputs.
5. **Mechanism:** there is no code path by which the field could be dropped or could fail init.
6. **Severity:** RULED OUT (with the honest cap: actual wallet-button rendering on a physical
   device — Wallet card + merchant cert + entitlement — remains TEST's device leg; the
   entitlement/cert chain was separately verified live by the 2026-07-03 saga).

## 5. Five-Truth-Layer reconciliation

| Layer | Truth | Agrees? |
|---|---|---|
| Docs | Vendor 0.65.1 documents `applePay`/`googlePay` on SetupParams; ORCH-1246 commit claims threading coverage | Vendor: yes. 1246 claim: **contradiction** → F-2 |
| Schema (types/config) | `PaymentSheetInitInput` rejects the keys; mingla-business tsconfig can't even see the package | **Contradiction with Code** → F-1/F-3 (the registered bug IS this gap) |
| Code | All three callsites send wallet config; hook + vendor chain forward wholesale | yes — W1 |
| Runtime | No init-failure mechanism exists; Sentry silent; device-only cap on the sheet itself | consistent with W1 (probable) |
| Data | DB blind to wallet type; ~zero post-1246 payments; 2 stuck PIs | cannot arbitrate W1/W2 — named operator check |

The load-bearing contradiction is Schema-vs-Code (type says no, code says yes, runtime obeys code).
The 1246-claim-vs-tests contradiction (Docs-vs-Code) is the durable compliance risk.

## 6. Repro evidence

- tsc A/B (mingla-business): baseline 945 lines → probe 953; −2 TS2307, +TS2353(:351), +10
  pkg-internal. Artifacts: `evidence/ORCH-1387/tsc-baseline-no-paths.txt`,
  `tsc-probe-with-paths.txt`, `tsc-ab-diff.txt`, `tsconfig.orch1387probe.json` (probe config;
  the in-worktree copy was deleted after the run — nothing product-side modified).
- app-mobile: plain tsc reproduces the same TS2353 at `nativeCheckoutFlow.ts(327,9)` today
  (`tsc-appmobile-applepay-excerpt.txt`).
- Sim/device: **not run — exempt class** (type/plumbing audit; no UI reproducer). The Apple Pay
  wallet button is device-only (Wallet card + merchant cert); the dispatch explicitly caps runtime
  claims accordingly. Named for TEST: physical-iPhone leg — open the business checkout payment
  sheet on a device with a Wallet card, confirm (a) Apple Pay row renders, (b) the sheet's line
  item shows the EVENT TITLE (fallback "Ticket"), never "Mingla". NOTE: this leg is
  downstream-blocked by ORCH-1386 (EAS builds from main HELD) for any new build; the live 1.1.2
  App Store binary already carries this code and can be used for a read-only device check now.
- Environment caveat: the shared anchor's `mingla-business/node_modules` predates the ORCH-1385
  dep fix (no `@mingla/*` symlinks — `ls node_modules/@mingla` is empty), and worktree
  node_modules symlink to it; the package-internal error composition in Q5 reflects that.

## 7. Blast radius / cross-surface map

In scope (share the flowing-untyped wallet config):
1. **Business iOS** — `nativeCheckoutFlow.native.ts` (all 3 checkout payment screens: event / trip /
   experience thread `displayTitle` into it).
2. **Business Android** — same file, `googlePay` analog (Q7).
3. **Consumer iOS / Android** — `app-mobile/nativeCheckoutFlow.ts` (same literal, TS2353 visible)
   + `useReserveTable.ts` (cast workaround, F-5).
Out of scope: buyer/anonymous web checkout (Stripe Checkout Sessions rail — separate, and the one
place an Apple Pay payment WAS operator-verified live, META-ORCH-0952 2026-05-25), admin web,
business web preview (native-only package).

Shared-code note: the type fix target (`packages/payments-native/types.ts`) is consumed by BOTH
apps — parity is automatic at the type layer, but the three callsites (two literals + one cast)
need individually verified cleanup, and tsconfig paths is a mingla-business-only gap.

## 8. Invariant impact (flagged, not resolved)

- **I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY (ACTIVE):** currently silent on wallet config. Its
  statement ("MUST pass customer + ephemeralKey…") is honored; the gap is that the invariant's
  gate never grew applePay/cartItems rules when 0849-HOTFIX/1244/1246 added them. Extending it is
  a SPEC decision.
- **I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST (ACTIVE):** `apple_pay`/`google_pay` are in the PI
  allowlist — consistent with W1; no conflict.
- **I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY (ACTIVE):** untouched by any type fix as long as callers
  keep using the package hook.
- No invariant currently guards "wallet sheet shows the product line" — the 4.9 behavior is
  invariant-less (candidate `I-PROPOSED-*` territory for the SPEC).

## 9. Discoveries for Orchestrator (side issues — register, do not widen)

- **D-A:** app-mobile carries the same visible-in-baseline TS2353 (F-4) — whatever ORCH fixes the
  type must scope BOTH apps or the bug class survives.
- **D-B:** `useReserveTable`'s `as Record<string, unknown>` cast (F-5) suppresses all type checking
  of its wallet payload; should be unified onto the extended type when it exists.
- **D-C:** two live-mode checkout sessions stuck `processing_payment` since 2026-07-01/02 with
  null failure_reason (`reconcile-stuck-checkouts` evidently didn't close them) — worth a look as
  its own item; PIs listed in F-8.
- **D-D:** the anchor checkout's node_modules is stale pre-1385 (no `@mingla` symlinks): any
  session running tsc/bundlers against anchor-linked node_modules sees pre-fix resolution state.
  Operational hygiene note for parallel sessions.
- **D-E:** tsc-baseline drift confirmed again (945 lines here vs 984 in the 1385 report on a
  different tree) — reinforces ORCH-1385 D-6 (tsc is diff-vs-baseline only, never absolute).

## 10. Confidence

- **W1 (field flows, Apple Pay + 4.9 line item configured): proven at code layers** — every hop
  read verbatim in the installed vendor package; corroborated by the sealed 2026-07-03 saga and
  the ORCH-1244-era first-party comment (F-5).
- **Runtime end-behavior (button renders, sheet shows product line on a real device): probable** —
  named blocker: Apple Pay sheet is physical-device-only AND prod has zero completed post-1246
  payments to corroborate; no mechanism for failure was found, and Apple approved the 1.1.2
  binaries. Cannot be "proven" from this chair; TEST owns the device leg.
- **W2: ruled out** (code-complete negative).

## 11. Recommended next phase + scope (direction only — NO fix here)

**Next: SPEC (mingla-forensics), then IMPLEMENT + TEST.** Recommended scope boundaries for the
SPEC (from the evidence, not a design):
1. The type-contract gap (F-1/Q7): both wallet keys, shared package, both apps' callsites incl.
   the F-5 cast site.
2. The tsconfig-paths gap (F-3): mingla-business only.
3. The regression net for the 4.9 threading (F-2) — the actual compliance exposure; consider the
   invariant candidacy from §8.
4. The 10 surfaced package-internal errors: re-enumerate under a fresh post-1385 `npm ci` at
   IMPLEMENT-verification time (Q5's composition is environment-bound).
5. TEST must carry the physical-iPhone Apple Pay leg (§6), currently blocked for NEW builds by
   ORCH-1386 but executable read-only on the live 1.1.2 binary.

## 12. Open questions for Seth (NOTIFY-LIST)

1. **Stripe-dashboard-only check (5 min):** in the Stripe dashboard, open payments
   `pi_3ToXuJI4pBxuXrhh0OaFDbwh` (Jul 1, $10) and `pi_3TooOQI4pBxuXrhh0cZrpJqL` (Jul 2, $20) plus
   the two succeeded payments from 2026-06-27, and read
   `payment_method_details.card.wallet` on their charges. `apple_pay` there = first live proof of
   wallet usage (and for the stuck two, the PI status tells why they never completed). Our DB
   cannot see this — nothing records wallet type.
2. **Device leg (when convenient / at TEST):** on your iPhone (Wallet card present), the live
   1.1.2 business app → any paid event → checkout → payment sheet: does the Apple Pay row render,
   and does tapping it show the event title (not "Mingla") on the sheet's line item?

— end of report —
