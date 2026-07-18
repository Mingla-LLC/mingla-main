# SPEC — ORCH-1387 [wallet config first-class on PaymentSheetInitInput + Apple-4.9 threading regression net]

Date: 2026-07-17 · Phase: SPEC · mingla-forensics (Claude)
Worktree: `~/Desktop/mingla-orchs/ORCH-1387-[applepay-type-plumbing]/` branch `ORCH-1387-applepay-type-plumbing`
Investigation (binding ground truth, REVIEW-APPROVED): `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1387_APPLEPAY_TYPE_PLUMBING.md` (F-1..F-9, Q1..Q9) at `81f84c329`.
Dispatch: orchestrator SPEC dispatch 2026-07-17, scope bound to investigation §11 items 1–5.

---

## PRIME DIRECTIVE (overrides everything below on conflict)

**ZERO runtime delta.** The sheet config Stripe receives must be **byte-identical before and after**
this change, on every callsite, on both apps, on both platforms. This ORCH is a type-contract +
coverage fix for a system that WORKS (investigation verdict W1, F-1/F-9). Any edit that could
change the object passed to `initPaymentSheet`, the timing of any call, or any user-visible
behavior is OUT OF CONTRACT — stop and request a SPEC amendment.

## OPEN QUESTIONS (reversible defaults chosen — work proceeds, Seth may override)

- **OQ-1 — Enforcement home: NEW gate (default) vs extending `i-stripe-paymentsheet-parity.mjs`.**
  Default: a NEW strict-grep gate `orch-1387-wallet-config-threaded.mjs` owned by the new DRAFT
  invariant. Rationale: the 0849 gate's 8-rule shape is ratified by SPEC_ORCH-0849 §3.5.3 and its
  registry entry says "Eight rules R-1..R-8" — piggybacking silently amends a ratified ACTIVE
  invariant's enforcement contract, which is the orchestrator's call at CLOSE, not the SPEC's.
  Reversible: the new rules are self-contained and can be folded into the parity gate later with
  zero behavior change.
- **OQ-2 — Standing operator checks (carried from investigation §12, NON-blocking):**
  (a) Stripe dashboard: `payment_method_details.card.wallet` on `pi_3ToXuJI4pBxuXrhh0OaFDbwh`,
  `pi_3TooOQI4pBxuXrhh0cZrpJqL`, + the two 2026-06-27 succeeded charges (first live wallet-type
  proof; shared fact with ORCH-1388). (b) Device eyeball at TEST on the live 1.1.2 binary.
  Default: IMPLEMENT proceeds without them; TEST carries (b).

---

## 1. Executive summary

The Apple Pay / Google Pay config that both apps pass to Stripe's PaymentSheet **works** but is
**invisible to the type system** (excess properties on `PaymentSheetInitInput`, F-1), invisible to
business tsc entirely (tsconfig-paths gap, F-3), suppressed by a cast at one callsite (F-5), and —
the real compliance exposure — **guarded by nothing**: deleting the entire wallet wiring, or the
Apple-4.9 `cartItems` product line, fails no test and no gate today (F-2).

This SPEC makes the wallet config **first-class in the shared type contract** (both wallet keys,
typed against the installed vendor SDK, automatically both apps), cleans all three callsites onto
the extended type **with zero runtime delta**, closes the tsconfig-paths gap, and builds a
**fails-on-revert regression net** around the 4.9 threading (strict-grep gate + structural test
suites + a scoped type-contract CI lane), pre-staging DRAFT invariant
`I-PROPOSED-1387-WALLET-CONFIG-THREADED`.

## 2. Scope & non-goals

### In scope (exactly investigation §11, items 1–5)

1. **Type contract:** extend `packages/payments-native/types.ts` `PaymentSheetInitInput` with BOTH
   wallet keys (`applePay`, `googlePay`) referencing the installed vendor types (§4.2).
2. **Callsites:** all THREE onto the extended type — the two object literals stay **byte-identical**
   (zero diff); the `useReserveTable` cast site drops `as Record<string, unknown>` for the typed
   field with a runtime-equivalence proof obligation (§4.4).
3. **tsconfig paths:** add `@mingla/payments-native` to `mingla-business/tsconfig.json` `paths`
   (mirror the 5 existing `@mingla/*` entries' shape), plus the mandated fresh-`npm ci`
   re-enumeration + triage of surfaced package-internal errors (§4.3, §8 step 4).
4. **The 4.9 threading regression net (F-2):** enforcement that FAILS if the `applePay:` block, the
   `cartItems:` line, or the `googlePay:` block is deleted from any callsite, if the hook stops
   forwarding the whole object, or if the type extension is reverted/widened (§4.5, §9).
5. **Regression-test contract (CLOSE Step 0.5):** implementor happy-path fails-on-revert matrix +
   named tester adversarial angles (§9).

### Non-goals (explicitly OUT — one-phrase reasons)

- **Any runtime behavior change** — prime directive; W1 proven working.
- **ORCH-1388** (stuck-PI reconciler) — its own registered ORCH.
- **Stripe SDK version changes** — vendor 0.65.1 verified correct (F-6); untouchable.
- **Native build verification / EAS / OTA / `[deploy]`** — ORCH-1386 HOLD; TEST's device leg is
  read-only on the live 1.1.2 binary.
- **Web checkout rail** (buyer/anon web) — separate Stripe Checkout Sessions rail (investigation §7).
- **The ORCH-1385 D-6 tsc-baseline problem at large** — this SPEC adds one *scoped* green
  typecheck lane for the package contract only; it does not attempt to green-gate either app's tsc.
- **Unifying the two per-app `buildApplePayCartItems` helpers into the package** — behavior-adjacent
  refactor with no coverage payoff; register as a discovery if desired, do not do it here.
- **Fixing the PARITY registry-entry drift** (statement still says `merchant.com.mingla.business.v2`
  while the gate enforces `merchant.com.sethogieva.minglabusiness`) — orchestrator housekeeping,
  flagged in §10.

### Migration

**NONE.** No database, RLS, edge-function, storage, or data change of any kind.

### Assumptions

- ORCH-1385 is merged (`d4f0996df`): both apps declare the six `@mingla/*` workspace deps, so a
  real `npm ci` symlinks `@mingla/payments-native` into each app's `node_modules`
  (I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED, ACTIVE).
- Installed vendor `@stripe/stripe-react-native@0.65.1` exports the `PaymentSheet` namespace as an
  explicit named export from `types/index.d.ts` (verified in this tree — collision-immune, unlike
  `export *` wildcard re-exports).

## 3. Cross-Surface Impact Declaration (MANDATORY)

**User-visible behavior demanded on every covered surface: NONE — identical before/after.** The
observable contract is that Apple Pay / Google Pay keep rendering and the Apple Pay sheet keeps
showing the PRODUCT title (fallback "Ticket"/"Reservation", never "Mingla") — now enforced instead
of unguarded.

| # | Surface | Covered? | Files touched there | Parity |
|---|---------|----------|---------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | **YES** | `src/hooks/useReserveTable.ts` (cast-site cleanup); `src/payments/nativeCheckoutFlow.ts` **zero-diff** (typechecks via shared type); new test `src/payments/__tests__/wallet_config_threading.orch1387.test.mjs` | Automatic at type layer (shared `packages/payments-native/types.ts`); callsite verification manual per file |
| 2 | Consumer Android (`app-mobile/`) | **YES** | same files — `googlePay` key rides the same change | Automatic (same TS files) |
| 3 | Buyer/anonymous Web (`mingla-business` `/checkout/{eventId}`, `/e/…`, `/b/…`, `/t/…`) | **NO** | — | Separate Stripe Checkout Sessions rail; native package excluded from web bundle (orch-0778 gate) |
| 4 | Business iOS (`mingla-business/`) | **YES** | `tsconfig.json` (paths); `src/payments/nativeCheckoutFlow.native.ts` **zero-diff**; new test `src/payments/__tests__/walletConfigThreading.orch1387.test.mjs`; `package.json` (npm script) | Automatic at type layer; callsite verification manual |
| 5 | Business Android (`mingla-business/`) | **YES** | same files — `googlePay` analog (Q7) | Automatic (same TS file) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | **NO** | — | No native payments surface |
| 7 | Business Web preview (adjacent) | **NO** | — | Native-only package; web is a passthrough stub |

**displayTitle threading sources (read-only context for TEST traceability — NOT touched):**
- Business (3 checkout payment screens → `nativeCheckoutFlow.native.ts`):
  `mingla-business/app/checkout/[eventId]/payment.tsx:463` (`event?.name`),
  `app/checkout-trip/[tripEventId]/payment.tsx:486` (`trip?.title`),
  `app/checkout-experience/[experienceEventId]/payment.tsx:391` (`experience?.title`).
- Consumer (3 detail screens → `nativeCheckoutFlow.ts`):
  `ConsumerEventDetailScreen.tsx:555`, `ConsumerTripDetailScreen.tsx:735`,
  `ConsumerExperienceDetailScreen.tsx:616`; plus `VenueReserveSheet.tsx` → `useReserveTable.ts`
  (reserve flow, fallback "Reservation").

## 4. Layered specification

Layers genuinely unaffected and NOT specified: Database, RLS, Edge functions, Realtime, React Query
hooks/query keys, components/screens (all six screens above untouched), navigation, styling.

### 4.1 Vendor-type decision (dispatch-mandated justification)

**DECISION: reference the INSTALLED vendor types via a type-only namespace import — do NOT
hand-roll a local subset.**

- The runtime contract IS the vendor's: `useStripePaymentSheet.ts:84` forwards the whole input
  object to the SDK's `initPaymentSheet` (F-1), so the honest type for these keys is the vendor's
  own `ApplePayParams` / `GooglePayParams` (verified field-for-field against our payloads, F-6).
- Drift-proof by construction: an SDK upgrade that changes the wallet param shapes breaks compile
  at our callsites instead of silently diverging. A local subset is exactly the disease already in
  the tree — TWO per-app `ApplePayCartItem` mirror interfaces
  (`mingla-business/src/payments/applePayCartItems.ts:13`, `app-mobile/src/payments/applePayCartItem.ts:28`)
  each carrying "Mirror of @stripe/stripe-react-native …" comments. A third copy is the
  anti-pattern; those two existing helper interfaces stay AS-IS (they type the helper's RETURN and
  are structurally assignable to the vendor's `ImmediateCartSummaryItem` — the new scoped
  typecheck lane proves that assignability, §4.5.3).
- Import form: `import type { PaymentSheet } from "@stripe/stripe-react-native";` then
  `PaymentSheet.ApplePayParams` / `PaymentSheet.GooglePayParams`. The `PaymentSheet` namespace is
  an explicit named export in the installed 0.65.1 (`types/index.d.ts:5,16`) — immune to
  `export *` collision-drop; `import type` is erased syntax, so the package's RN-free unit-test
  property (`normalizePaymentSheetResult` header contract) and both apps' Metro bundles are
  untouched at runtime.

### 4.2 Shared package type contract — `packages/payments-native/types.ts`

Add at top (after the header comment, before existing declarations):

```ts
import type { PaymentSheet } from "@stripe/stripe-react-native";
```

Extend `PaymentSheetInitInput` (append after `customerEphemeralKeySecret`, keeping every existing
member byte-identical) with two optional keys, each carrying a doc comment that states, at minimum:

- `applePay?: PaymentSheet.ApplePayParams;` — ORCH-1387 first-classing of ORCH-0849-HOTFIX (wallet
  exposure is per-sheet, HERE — provider `merchantIdentifier` only registers the binding) and
  ORCH-1244/1246 (**Apple Guideline 4.9: `cartItems[…].label` MUST be the product/event/trip/
  experience/venue title — fallback "Ticket"/"Reservation" — NEVER the company/merchantDisplayName**).
  Typed against the INSTALLED vendor params — the SDK receives this object verbatim
  (whole-object forward, INVESTIGATION_ORCH-1387 F-1).
- `googlePay?: PaymentSheet.GooglePayParams;` — same ORCH lineage, Android analog (Q7).

The doc comments must also name the enforcement: `I-PROPOSED-1387-WALLET-CONFIG-THREADED` +
`orch-1387-wallet-config-threaded.mjs`, so the "why" survives in-file (regression-prevention
comment requirement, §9).

**Contract:** no other member of `types.ts` changes; no value (non-type) import is added; the
existing exports of `index.ts` are untouched (the keys flow through the already-exported
`PaymentSheetInitInput`).

### 4.3 Compiler config — `mingla-business/tsconfig.json`

Insert into `compilerOptions.paths`, mirroring the exact two-line shape of the five existing
`@mingla/*` entries, placed between `@mingla/theme-animations/*` and `@mingla/phone-input`
(mirrors `app-mobile/tsconfig.json:19-20` ordering):

```json
"@mingla/payments-native": ["../packages/payments-native"],
"@mingla/payments-native/*": ["../packages/payments-native/*"],
```

**Consequence (Q5/§11-4, MANDATED):** previously-invisible package-internal errors enter business
tsc output. The investigation's enumeration (5× TS2307 env-artifacts + 4× TS7031 implicit-any in
`StripeNativeProvider.tsx:76-79` + the one real TS2353) is **environment-bound** (stale pre-1385
anchor node_modules). The implementor MUST re-enumerate under a fresh real `npm ci` (§8 step 1)
and triage per this rule: **fix trivial implicit-anys inside the package ONLY IF the fix is
type-annotation-only and runtime-inert** (expected: the TS7031s vanish once React types resolve —
likely zero edits needed); **anything more = report, don't widen.** `app-mobile/tsconfig.json` is
NOT touched (mapping already present at :19-20).

### 4.4 Callsite contracts (three)

**4.4.1 `mingla-business/src/payments/nativeCheckoutFlow.native.ts` — ZERO DIFF.**
The literal at :327-368 (`applePay` :351, `googlePay` :363) already matches the extended type.
The change proves itself via tsc: post-change, business tsc (with §4.3 paths) reports **no TS2353
for `applePay`/`googlePay` in this file** and no TS2307 for the package. `git diff` for this file
must be empty.

**4.4.2 `app-mobile/src/payments/nativeCheckoutFlow.ts` — ZERO DIFF.**
Same contract; the pre-existing baseline TS2353 at (327,9) (F-4 evidence
`tsc-appmobile-applepay-excerpt.txt`) disappears from consumer tsc output. `git diff` empty.

**4.4.3 `app-mobile/src/hooks/useReserveTable.ts` — the F-5 cast site. Exact before/after:**

BEFORE (current :111-135 comment + declaration, and :146):
```ts
      // The wallet config (applePay/googlePay) is required for the wallet
      // buttons to render in PaymentSheet (ORCH-0849), but it is not on the
      // shared @mingla/payments-native PaymentSheetInitInput type (the package
      // type predates the wallet config; the native SDK accepts it at runtime —
      // exactly as nativeCheckoutFlow does). Pass it via a typed extension so
      // the keys reach the SDK without forking the package type.
      const walletConfig = {
        …body…
      };
      …
        ...(walletConfig as Record<string, unknown>),
```

AFTER (three edits ONLY — all TypeScript-erasure, zero emitted-JS delta):

1. Add a type-only import adjacent to the existing package import (`useReserveTable.ts:2`):
   `import type { PaymentSheetInitInput } from "@mingla/payments-native";`
2. Replace the six now-false comment lines with a comment stating the config is first-class on
   `PaymentSheetInitInput` since ORCH-1387 (keep the ORCH-0849 wallet-buttons rationale and the
   ORCH-1244 4.9 cartItems comment lines below it VERBATIM), and type the declaration:
   `const walletConfig: Pick<PaymentSheetInitInput, "applePay" | "googlePay"> = {`
   — **the object body (:117-135) stays byte-identical.**
3. `...(walletConfig as Record<string, unknown>),` → `...walletConfig,`

**Runtime-equivalence proof obligation (implementation report MUST carry it):** the diff for this
file contains only (a) a type-only import, (b) a type annotation on a `const`, (c) removal of an
`as` cast inside a spread, (d) comment text. All four are erased by TS transpilation. The report
must include a mechanical proof: transpile the file pre- and post-change with the same tool/flags
(e.g. `npx tsc --target esnext --module esnext --jsx preserve` or the repo's babel), strip
comments, and show the emitted JS is **identical**.

### 4.5 Enforcement layer (the 4.9 threading regression net — F-2)

**Enforcement-family decision (dispatch-mandated justification):** a three-net family, all
writer-independent and CI-gated, per house patterns:

1. **NEW strict-grep gate** (pure-fs node script, `--self-test` mode — house pattern of
   orch-1322/orch-1105 gates) — the primary net; runs on raw checkout, no npm ci.
2. **Structural node:test suites** (fs-read + regex `.test.mjs`, NO product imports — ORCH-1271 /
   orch_1190 pattern) — developer-local + CI via bare `node --test`, no npm ci; these are the
   implementor happy-path fails-on-revert tests near the surfaces they guard.
3. **Scoped type-contract CI lane** (npm-ci'd `tsc --noEmit` over ONLY the package type + a
   typetest file — META-1337-job pattern for the install step) — the ONLY way the type half has
   any enforcement, because neither app's tsc is a CI gate (ORCH-1385 D-6) and jest/babel strips
   types unchecked. Rejected alternatives: extending the 0849 gate (OQ-1); executed-slice tests
   (COMMS-0106 proved them orphanable-by-default; where slice-like scoping is used below, the
   COMMS-0106 companions — uniqueness + provenance — are mandatory rules, not options).

**4.5.1 Gate: `.github/scripts/strict-grep/orch-1387-wallet-config-threaded.mjs` (NEW).**

Scanned files: `B = mingla-business/src/payments/nativeCheckoutFlow.native.ts`,
`C = app-mobile/src/payments/nativeCheckoutFlow.ts`, `R = app-mobile/src/hooks/useReserveTable.ts`,
`H = packages/payments-native/useStripePaymentSheet.ts`, `T = packages/payments-native/types.ts`.

Preprocessing contract (COMMS-0106 ORPHAN-2 defense — stronger than the 0849 gate): strip BOTH
`//` line comments AND `/* … */` block comments before any match. Rules (all must hold, exit 0;
any violation exit 1; fs error exit 2):

- **W-1 (B) / W-2 (C) / W-3 (R):** exactly **ONE** `initPaymentSheet(` occurrence in comment-stripped
  text per file (uniqueness companion — a second call shape can't smuggle an unguarded config).
- **W-4 (B) / W-5 (C):** within the argument span of that single call (from `initPaymentSheet(` to
  its closing `});` — scoped, not file-wide), text contains ALL OF: `applePay`,
  `merchantCountryCode`, `cartItems: buildApplePayCartItems(`.
- **W-6 (B) / W-7 (C):** same span contains `googlePay` and (per file) its `merchantCountryCode`.
- **W-8 (R):** the `walletConfig` declaration body contains `applePay`,
  `cartItems: buildApplePayCartItems(`, and `googlePay`; AND the call span contains the spread
  `...walletConfig` (deleting either the keys OR the spread fires).
- **W-9 (R):** the file does NOT contain `as Record<string, unknown>` (the F-5 cast must never
  return).
- **W-10 (H):** comment-stripped text contains the whole-object forward `initPaymentSheet(input)`
  AND contains neither `applePay` nor `merchantDisplayName` (the hook must forward, never rebuild
  or pick).
- **W-11 (T):** `types.ts` declares `applePay?: PaymentSheet.ApplePayParams` and
  `googlePay?: PaymentSheet.GooglePayParams` (guards the type-extension revert on raw checkout,
  independent of the typecheck lane).

`--self-test` mode: synthetic in-memory fixtures proving EVERY rule fires on its violation shape
(including: applePay block present only inside a block comment → W-4 fires; duplicate
`initPaymentSheet(` → W-1 fires; spread deleted but walletConfig intact → W-8 fires).

**4.5.2 Structural suites (NEW, node:test `.test.mjs`, fs+regex only, zero imports of product code):**

- `mingla-business/src/payments/__tests__/walletConfigThreading.orch1387.test.mjs` — asserts the
  B-file rules (W-1/W-4/W-6) + H-file rules (W-10) + T-file rule (W-11) as independent test cases
  with the same comment-stripping contract.
- `app-mobile/src/payments/__tests__/wallet_config_threading.orch1387.test.mjs` — asserts the
  C-file rules (W-2/W-5/W-7) + R-file rules (W-3/W-8/W-9).

These intentionally overlap the gate (defense in depth, house pattern: PARITY invariant ships gate
+ test). New files ONLY — the test-append-only gate needs no TEST-MOD token; do not modify any
existing test file (the 1244/1246 helper suites stay untouched).

**4.5.3 Scoped type-contract lane (NEW):**

- `packages/payments-native/__typetests__/paymentSheetInitInput.orch1387.typetest.ts` — a
  compile-only file (never imported at runtime, never bundled) containing:
  - POSITIVE: a full `PaymentSheetInitInput` literal mirroring the business callsite payload
    (applePay + cartItems `{ label, amount: "45.99", paymentType: "Immediate" }` + googlePay with
    `testEnv`/`currencyCode`) — must compile.
  - POSITIVE: the reserve-flow shape via `Pick<PaymentSheetInitInput, "applePay" | "googlePay">`
    spread into a full input — must compile.
  - POSITIVE: both apps' helper return types (`ApplePayCartItem[]` / `[ApplePayCartItem]`
    structural mirrors declared locally in the typetest) assignable to
    `NonNullable<PaymentSheet.ApplePayParams["cartItems"]>` — pins the helper-mirror ↔ vendor
    assignability without touching the helpers.
  - NEGATIVE (each under `// @ts-expect-error`): wrong-shaped cartItem `amount: 4599` (number);
    `paymentType: "Sometime"`; cartItem missing `label`; `applePay: {}` (missing
    `merchantCountryCode`); `googlePay: { merchantCountryCode: 123 }`; an unknown excess key
    (e.g. `walletFoo: {}`) on the init literal.
  - Two-sided enforcement mechanism: reverting the type extension breaks the POSITIVES; widening
    `applePay` to `any`/`Record<string, unknown>` makes the NEGATIVE `@ts-expect-error` directives
    unused → TS2578 → red.
- `packages/payments-native/tsconfig.orch1387.typetest.json` — `strict: true`, `noEmit: true`,
  `skipLibCheck: true`; `include` ONLY `types.ts` + the typetest file (never the app baselines —
  this is the D-6-immune scoped lane); explicit `paths` mapping `@stripe/stripe-react-native` →
  `../../mingla-business/node_modules/@stripe/stripe-react-native` (deterministic resolution; the
  packages dir has no own node_modules).
- Run: `npx tsc --noEmit -p ../packages/payments-native/tsconfig.orch1387.typetest.json` from
  `mingla-business/` (typescript devDep + vendor types present after npm ci).

**4.5.4 CI + npm wiring:**

- `.github/workflows/strict-grep-mingla-business.yml` — TWO new jobs:
  - `orch-1387-wallet-config-threaded`: checkout + setup-node(20) + gate `--self-test` + gate run +
    `node --test` both structural suites (no npm ci — raw-checkout pattern of the 1271/1272 jobs).
  - `orch-1387-wallet-type-contract`: checkout + setup-node(20 with mingla-business lockfile cache)
    + `npm ci` in `mingla-business` + the §4.5.3 tsc run (modeled on `meta-1337-business-jest-suites`).
- `mingla-business/package.json`: `"test:orch-1387"`: gate self-test && gate && `node --test` the
  business suite && the scoped tsc run.
- `app-mobile/package.json`: `"test:orch-1387"`: `node --test` the consumer suite.

## 5. Success criteria (numbered, observable; per-surface where parity is manual)

- **SC-1:** `PaymentSheetInitInput` declares `applePay?: PaymentSheet.ApplePayParams` and
  `googlePay?: PaymentSheet.GooglePayParams` via a type-only vendor namespace import; no
  hand-rolled wallet param shapes exist anywhere in `packages/payments-native/`.
- **SC-2-biz:** with §4.3 paths + fresh npm ci, `npx tsc --noEmit` in `mingla-business` reports
  ZERO errors mentioning `applePay`/`googlePay`/`PaymentSheetInitInput` and ZERO TS2307 for
  `@mingla/payments-native`.
- **SC-2-consumer:** `npx tsc --noEmit` in `app-mobile` no longer contains the
  `nativeCheckoutFlow.ts(327,9)` TS2353 (baseline shrinks; no new errors introduced by this ORCH).
- **SC-3-biz / SC-3-consumer:** `git diff` for `nativeCheckoutFlow.native.ts` (biz) and
  `nativeCheckoutFlow.ts` (consumer) is EMPTY — byte-identical callsite literals.
- **SC-4:** `useReserveTable.ts` contains no `as Record<string, unknown>`; `walletConfig` is typed
  `Pick<PaymentSheetInitInput, "applePay" | "googlePay">`; the walletConfig body and every other
  statement in the file are byte-identical; the implementation report carries the §4.4.3
  emitted-JS-identical proof.
- **SC-5:** `mingla-business/tsconfig.json` gains exactly the two §4.3 lines; `app-mobile/tsconfig.json`
  untouched.
- **SC-6:** the gate passes self-test (every W-rule fires on its fixture) AND passes on the
  pristine tree.
- **SC-7:** the fails-on-revert matrix (§9, 11 reverts) is EXECUTED — each revert makes at least
  one named net red, evidence pasted per revert.
- **SC-8:** the scoped type lane is green on pristine, red on type-extension revert, red on
  `applePay: any` widening (TS2578 path shown once as evidence).
- **SC-9:** both structural suites pass pristine and fail on their file's reverts (subset of §9
  matrix).
- **SC-10:** CI wiring live: both new workflow jobs present and green on the PR; both
  `test:orch-1387` npm scripts run green locally.
- **SC-11:** fresh-npm-ci enumeration recorded in the implementation report: package-internal
  error list before/after, triage per §4.3 (type-only fixes at most, inside
  `packages/payments-native/` only), residuals reported not fixed.
- **SC-12:** `npm ci` produced ZERO `package-lock.json` diffs in any workspace (if not — STOP,
  report; lockfile churn is ORCH-1386 territory).
- **SC-13:** DRAFT invariant stanza `I-PROPOSED-1387-WALLET-CONFIG-THREADED` appended to
  `Mingla_Artifacts/INVARIANT_REGISTRY.md` exactly as §6 specifies (DRAFT — orchestrator flips at
  CLOSE).
- **SC-14:** total product-code runtime surface of the change = `useReserveTable.ts` only, and that
  file's delta is proven erasure-only; everything else is types, compiler config, tests, gates,
  workflow, docs.

## 6. Invariants

**Preserved (cite + how):**

- **I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY (ACTIVE):** untouched enforcement (OQ-1 default: its
  gate + 8 rules unmodified); both callsite literals byte-identical keeps R-1..R-8 green. The new
  wallet net COMPLEMENTS it — the invariant's known gap (zero applePay rules, investigation §8) is
  closed by the NEW invariant below, not by amending the ratified one.
- **I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST (ACTIVE):** untouched — no PI-create change; wallet keys
  on the sheet config are consistent with `apple_pay`/`google_pay` in the Phase-1 allowlist.
- **I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY (ACTIVE, hook-header contract):** untouched —
  `useStripePaymentSheet.ts` body is DO-NOT-TOUCH; W-10 additionally hardens the wrapper's
  whole-object forward.
- **I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED (ACTIVE):** untouched; §4.3 is the tsc-side completion
  of the same hygiene (resolver fixed by 1385, type visibility fixed here).
- **I-RELEASE-VERSION-PARITY (ACTIVE):** untouched — no version, build, or store artifact changes.

**NEW — pre-staged DRAFT (orchestrator flips ACTIVE at CLOSE; SPEC does not flip):**

### I-PROPOSED-1387-WALLET-CONFIG-THREADED (DRAFT — flips ACTIVE on ORCH-1387 CLOSE)

**Statement:** Every native checkout callsite that passes wallet config (`applePay`/`googlePay`)
MUST pass it such that it reaches `initPaymentSheet` unmodified: `useStripePaymentSheet` MUST
forward its entire input object (no destructure/pick/rebuild), and the three callsites
(`mingla-business/src/payments/nativeCheckoutFlow.native.ts`,
`app-mobile/src/payments/nativeCheckoutFlow.ts`, `app-mobile/src/hooks/useReserveTable.ts`) MUST
each contain, inside their single `initPaymentSheet` call, an `applePay` config whose
`cartItems` come from `buildApplePayCartItems(…)` (Apple Guideline 4.9: label = product title,
fallback "Ticket"/"Reservation", NEVER the company/merchantDisplayName) and a `googlePay` config.
Both wallet keys MUST remain first-class, vendor-typed members of `PaymentSheetInitInput`
(`packages/payments-native/types.ts`); untyped casts (`as Record<string, unknown>` or equivalent)
to smuggle wallet keys past the contract are forbidden. The 4.9 cart line MUST have
fails-on-revert coverage at all times.

**Why:** ORCH-1387 proved (F-2) that the ORCH-1246 4.9 fix had helper-math coverage only —
deleting the entire wallet wiring failed nothing, a silent App-Review compliance regression
waiting to happen; and (F-1/F-3/F-5) that the config flowed as an untyped excess property invisible
to business tsc and cast around at one callsite for 14 months.

**Enforcement:** (1) strict-grep gate `.github/scripts/strict-grep/orch-1387-wallet-config-threaded.mjs`
(rules W-1..W-11, block+line comment-stripped, single-call uniqueness) + workflow job
`orch-1387-wallet-config-threaded`; (2) structural suites
`walletConfigThreading.orch1387.test.mjs` (biz) + `wallet_config_threading.orch1387.test.mjs`
(consumer), CI-run via `node --test`; (3) scoped type lane
`packages/payments-native/tsconfig.orch1387.typetest.json` + typetest, workflow job
`orch-1387-wallet-type-contract` (two-sided: revert breaks positives, widening trips TS2578).

**EXIT condition:** Permanent while native checkout ships wallet buttons. A future callsite that
passes wallet config MUST be added to the gate's scanned-file list + rules in the same PR.

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Happy: pristine tree | gate + both suites + typetest lane | all green | CI/gates |
| T-2 | Revert: delete `applePay:` block from B | edited B | gate W-4 red + biz suite red | gate/test |
| T-3 | Revert: delete `cartItems:` line from B | edited B | gate W-4 red + biz suite red | gate/test |
| T-4 | Revert: delete `googlePay:` block from B | edited B | gate W-6 red + biz suite red | gate/test |
| T-5 | Revert: same three on C | edited C | W-5/W-7 red + consumer suite red | gate/test |
| T-6 | Revert: delete `applePay` from R walletConfig | edited R | W-8 red + consumer suite red | gate/test |
| T-7 | Revert: delete `...walletConfig` spread, keep declaration | edited R | W-8 red (spread half) | gate |
| T-8 | Revert: hook picks/rebuilds instead of `initPaymentSheet(input)` | edited H | W-10 red + biz suite red | gate/test |
| T-9 | Revert: remove wallet keys from types.ts | edited T | W-11 red + typetest positives red | gate/tsc |
| T-10 | Widen: `applePay?: any` | edited T | typetest TS2578 red | tsc |
| T-11 | Re-introduce `as Record<string, unknown>` in R | edited R | W-9 red | gate |
| T-12 | Edge: applePay block moved into a `/* */` comment, real one deleted | edited B | W-4 STILL red (block-strip proof) | gate |
| T-13 | Edge: second `initPaymentSheet(` added | edited B | W-1 red (uniqueness) | gate |
| T-14 | Error-path: gate self-test | `--self-test` | every W-rule fires on its fixture, exit 0 | gate |
| T-15 | Type negative set | typetest `@ts-expect-error` cases | each stays an error (lane green); removal of any negative = red | tsc |
| T-16 | Runtime equivalence (R) | pre/post transpile diff | emitted JS identical (comments stripped) | evidence |
| T-17 | Zero-diff (B, C) | `git diff --stat` | both files absent from the diff | evidence |
| T-18 | Fresh npm ci | all four workspaces | zero lockfile diff; enumeration recorded | env |

## 8. Implementation order

1. **Environment:** rebase worktree on origin/main; remove any `node_modules` symlinks to the
   anchor and run REAL `npm ci` in `mingla-business` AND `app-mobile`
   (`reference_ota_from_worktree_needs_real_npm_ci`); verify ZERO lockfile diff (SC-12; else STOP
   → report). Capture pre-change `npx tsc --noEmit` baselines for both apps (evidence files).
2. **Type contract:** §4.2 `types.ts` extension.
3. **Type lane:** §4.5.3 typetest + typetest tsconfig; run green; prove T-9/T-10 red paths once.
4. **Paths:** §4.3 tsconfig edit; run business tsc; enumerate + triage the surfaced
   package-internal delta vs the step-1 baseline (SC-11); package-internal type-only fixes only if
   actually surfaced.
5. **Cast site:** §4.4.3 `useReserveTable.ts` edits; consumer tsc delta check (SC-2-consumer);
   produce the T-16 transpile proof.
6. **Gate:** §4.5.1 script + self-test fixtures.
7. **Suites:** §4.5.2 both `.test.mjs` files.
8. **Wiring:** §4.5.4 two workflow jobs + two npm scripts.
9. **Registry:** append the §6 DRAFT stanza to `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
10. **Verification:** execute the FULL §9 revert matrix with pasted evidence; T-17 zero-diff proof;
    implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1387_WALLET_TYPE_CONTRACT.md`
    carrying SC-1..SC-14 evidence. Commit(s) on the ORCH branch only; no PR merge inside this
    phase; no TEST-MOD token needed (new test files only) — and per COMMS-0106, re-verify
    append-only status after ANY amend/rebase.

## 9. Regression prevention — the fails-on-revert contract (CLOSE Step 0.5, two-sided)

**Structural safeguard:** the three-net family of §4.5 + the DRAFT invariant of §6. Protective
"why" comments: in `types.ts` (§4.2, names the invariant + gate), in the gate header (cites F-2:
helper-math-only coverage was the 4.9 exposure), and in each suite header.

**Implementor happy-path (MUST EXECUTE, not argue):** the 11-revert matrix — T-2..T-13 — each
revert applied, the expected net(s) shown red, restored, shown green. Plus T-16 (equivalence
proof), T-17 (zero-diff proof), T-18 (env proof).

**Named tester adversarial angles (mingla-tester, binding):**

- **A-1 — attack the runtime-equivalence claim of the cast-site change:** independently transpile
  pre/post `useReserveTable.ts` and diff emitted JS; and/or mock `@stripe/stripe-react-native` +
  the package hook to deep-compare the exact object received by `initPaymentSheet` pre/post-fix.
  Any delta = FAIL the ORCH.
- **A-2 — attack the gate's blind spots (COMMS-0106 playbook):** ORPHAN-2 block-comment decoys
  (T-12 shape and variants); duplicate/renamed call shapes (T-13); wallet keys present in an object
  never spread into the call; `// @ts-` tricks inside spans; report any green-while-broken shape as
  a P1 with a pinned repro.
- **A-3 — attack the type contract's rejection breadth:** wrong-shape probes beyond §4.5.3's set
  (numeric amounts, `Deferred` item without `deferredDate`, label-less items, alternate cast forms
  like `as unknown as` at any callsite); recommend hardening if a cast form defeats W-9's specific
  pattern.
- **A-4 — CI truth:** prove both new jobs actually executed red-capable on the PR (fresh event —
  COMMS-0109: reruns of pre-existing PRs reuse stale merge snapshots).
- **A-5 — device leg (read-only, live 1.1.2 binary; new builds blocked by ORCH-1386):** physical
  iPhone with a Wallet card → business checkout → sheet shows the Apple Pay row AND the line item
  shows the EVENT TITLE (fallback "Ticket"), never "Mingla". Read-only observation; no new build.

## 10. Open questions

OQ-1 and OQ-2 in the header (defaults chosen, work proceeds). **Discovery for orchestrator (not
scope):** the I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY registry STATEMENT still names
`merchant.com.mingla.business.v2` / `com.mingla.business.v2` while the gate (ORCH-0849 round 4)
enforces `merchant.com.sethogieva.minglabusiness` — registry-text drift, orchestrator housekeeping.

## 11. Downstream routing

- **Next: IMPLEMENT (mingla-implementor)** — this SPEC + the investigation are the complete
  contract; build in worktree `~/Desktop/mingla-orchs/ORCH-1387-[applepay-type-plumbing]/` on
  branch `ORCH-1387-applepay-type-plumbing`; commits on the branch; stop-and-amend on ANY need to
  touch a file outside the allowlist below.
- **Then: TEST (mingla-tester)** — type-level + gate legs now (A-1..A-4); physical-iPhone Apple
  Pay leg on the live 1.1.2 binary (A-5); any NEW-build leg stays blocked by ORCH-1386.
- **Then: orchestrator CLOSE** — flips `I-PROPOSED-1387-WALLET-CONFIG-THREADED` ACTIVE; CLOSE
  gates: all checks green, no `--admin` over red, one PR per CLOSE, registry row removal + worktree
  reap per house rules. NO `[deploy]` tag (no edge/web deploy in scope; ORCH-1386 holds EAS/OTA).

---

## ALLOWLIST (the implementor may create/modify ONLY these)

| File | Contract |
|------|----------|
| `packages/payments-native/types.ts` | §4.2 only: type-only import + two optional members + doc comments; nothing else changes |
| `packages/payments-native/__typetests__/paymentSheetInitInput.orch1387.typetest.ts` | NEW — §4.5.3 |
| `packages/payments-native/tsconfig.orch1387.typetest.json` | NEW — §4.5.3 |
| `packages/payments-native/StripeNativeProvider.tsx` | CONDITIONAL — only if fresh-npm-ci enumeration still surfaces implicit-anys; type-annotation-only, runtime-inert (SC-11) |
| `mingla-business/tsconfig.json` | §4.3: exactly two `paths` lines |
| `app-mobile/src/hooks/useReserveTable.ts` | §4.4.3: the three erasure-only edits |
| `.github/scripts/strict-grep/orch-1387-wallet-config-threaded.mjs` | NEW — §4.5.1 |
| `.github/workflows/strict-grep-mingla-business.yml` | two new jobs (§4.5.4) — no existing job modified |
| `mingla-business/package.json` | one `test:orch-1387` script line |
| `app-mobile/package.json` | one `test:orch-1387` script line |
| `mingla-business/src/payments/__tests__/walletConfigThreading.orch1387.test.mjs` | NEW — §4.5.2 |
| `app-mobile/src/payments/__tests__/wallet_config_threading.orch1387.test.mjs` | NEW — §4.5.2 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | append the §6 DRAFT stanza only |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1387_WALLET_TYPE_CONTRACT.md` | NEW — the report |

## DO-NOT-TOUCH (stop-and-amend before touching)

- `mingla-business/src/payments/nativeCheckoutFlow.native.ts` and `nativeCheckoutFlow.ts` (bare web
  stub) — ZERO diff (SC-3-biz).
- `app-mobile/src/payments/nativeCheckoutFlow.ts` — ZERO diff (SC-3-consumer).
- `packages/payments-native/useStripePaymentSheet.ts`, `normalizePaymentSheetResult.ts`,
  `index.ts` — the hook/normalizer/export surface is load-bearing (PRESENT-ONCE-ONLY) and needs no
  change.
- Both apps' `applePayCartItem(s).ts` helpers + ALL existing test files (append-only; 1244/1246
  suites stay verbatim).
- `.github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs` + its workflow job (OQ-1 default).
- Any `package-lock.json` (SC-12), the `@stripe/stripe-react-native` dependency/version, any
  `node_modules` content.
- `app-mobile/tsconfig.json` (mapping already present).
- `supabase/**` (migration = NONE), `app.json` / `eas.json` / any build or store config
  (ORCH-1386 HOLD), anything `[deploy]`-tagged.
- The six displayTitle-threading screens (§3) — read-only context.

— end of SPEC —
