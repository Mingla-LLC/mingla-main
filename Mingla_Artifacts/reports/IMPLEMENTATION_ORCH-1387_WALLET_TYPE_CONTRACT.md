# IMPLEMENTATION — ORCH-1387 [wallet config first-class on PaymentSheetInitInput + Apple-4.9 threading regression net]

Date: 2026-07-17 · Phase: IMPLEMENT · mingla-implementor (Claude)
Worktree: `~/Desktop/mingla-orchs/ORCH-1387-[applepay-type-plumbing]/` branch `ORCH-1387-applepay-type-plumbing` (rebased onto post-fix main `d4f0996df`+ before work)
SPEC (binding): `Mingla_Artifacts/specs/SPEC_ORCH-1387_WALLET_TYPE_CONTRACT_AND_49_NET.md` (rebased hash `4ff8ef200`)
Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1387_APPLEPAY_TYPE_PLUMBING.md`
Evidence: `Mingla_Artifacts/evidence/ORCH-1387/impl/` (force-added text evidence; the evidence dir is gitignored by default)
Status: **implemented and verified** (all locally-verifiable SC confirmed; SC-10's on-PR half and the A-5 device leg are TEST/CLOSE-phase by design)

---

## 1. Summary

The Apple Pay / Google Pay config both apps pass to Stripe's PaymentSheet is now **first-class and
vendor-typed** on the shared `PaymentSheetInitInput` (both apps automatically), the one callsite
that smuggled it past the type system with an `as Record<string, unknown>` cast is cleaned with a
**proven-byte-identical emitted-JS** erasure-only edit, the mingla-business tsconfig-paths gap is
closed, and — the real point — the Apple-4.9 threading (product title on the wallet sheet, never
"Mingla") is now guarded by a **3-net fails-on-revert family**: strict-grep gate W-1..W-11 +
two structural node:test suites + a scoped D-6-immune type-contract CI lane. Deleting the
`applePay:` block, the `cartItems:` line, the `googlePay:` block, the spread, the whole-object
forward, or the type extension now turns at least one CI net red — previously all of those failed
NOTHING (F-2). **PRIME DIRECTIVE held: zero runtime delta** — both flow-file literals have
ZERO diff; the single runtime-file edit is proven emitted-JS-identical under babel AND tsc.

## 2. SPEC success-criteria coverage

| SC | Verdict | Commit | Evidence |
|----|---------|--------|----------|
| SC-1 | ✓ | `062684521` | `types.ts` declares `applePay?: PaymentSheet.ApplePayParams` + `googlePay?: PaymentSheet.GooglePayParams` via type-only namespace import (verified explicit named export in installed 0.65.1 `types/index.d.ts:5,16`); no hand-rolled wallet shapes anywhere in `packages/payments-native/` |
| SC-2-biz | ✓ (operative clauses) | `1ef11ac4a` | `tsc-biz-postchange-final.txt`: ZERO errors mentioning applePay/googlePay/PaymentSheetInitInput; ZERO TS2307 for `@mingla/payments-native`; the TS2353@(351,9) is GONE. **Caveat: one NEW TS2307 at `types.ts(12,35)` — see §10 honest gaps** |
| SC-2-consumer | ✓ (operative clauses) | `1ef11ac4a` | `tsc-mobile-postchange-final.txt`: the `nativeCheckoutFlow.ts(327,9)` TS2353 is GONE; baseline SHRANK 1032→1028. Same single-TS2307 caveat (§10) |
| SC-3-biz | ✓ | — | `git diff origin/main...HEAD -- <both flow files>` = **0 lines** (T-17, §9) |
| SC-3-consumer | ✓ | — | same proof — file absent from the branch diff entirely |
| SC-4 | ✓ | `1ef11ac4a` | no `as Record<string, unknown>` in `useReserveTable.ts`; `walletConfig: Pick<PaymentSheetInitInput, "applePay" \| "googlePay">`; object body byte-identical; T-16 emitted-JS proof in §5 |
| SC-5 | ✓ | `1ef11ac4a` | exactly the two §4.3 lines added between theme-animations and phone-input (mirrors app-mobile ordering); `app-mobile/tsconfig.json` untouched |
| SC-6 | ✓ | `bcc46997d` | gate `--self-test` PASS (every W-rule fires incl. ORPHAN-2 block-comment decoys) + pristine-tree PASS (`final-gate-battery.txt`) |
| SC-7 | ✓ | executed at `5164fa36c` | FULL matrix T-2..T-13 (14 executions, T-5 split a/b/c) — every revert red on the named net(s), restored green, final sweep green. Full log: `revert-matrix-evidence.txt`; verdict block reproduced in §6 |
| SC-8 | ✓ | `062684521` | lane green pristine (exit 0); T-9 revert red (`typetest-T9-revert-red.txt`: TS2353/TS2344 on positives); T-10 `applePay?: any` red via 4× TS2578 (`typetest-T10-widen-red.txt`) |
| SC-9 | ✓ | `bcc46997d` | both suites 20/20 pristine; suite-red proven inside the §6 matrix on every named case |
| SC-10 | ◐ local-half ✓ | `bcc46997d` | both workflow jobs appended (YAML validated), `test:orch-1387` green in BOTH apps locally. On-PR green is CLOSE-phase (no PR is opened at IMPLEMENT; tester A-4 verifies fresh-event CI truth) |
| SC-11 | ✓ | `1ef11ac4a` | fresh-npm-ci enumeration + triage in §7 — composition DIFFERS from investigation Q5 (material finding); one conditional type-annotation-only fix applied (`StripeNativeProvider.tsx`); residuals reported not fixed |
| SC-12 | ✓ | — | real `npm ci` both apps (1332 + 1167 packages); `git status`/`git diff` on both `package-lock.json`: **zero diff** (T-18) |
| SC-13 | ✓ | `5164fa36c` | DRAFT stanza appended verbatim from SPEC §6; orchestrator flips at CLOSE |
| SC-14 | ✓ | — | total product-code runtime surface = `useReserveTable.ts` only, erasure-proven (§5); everything else is types, compiler config, tests, gate, workflow, registry docs |

## 3. Files changed (this phase; vs allowlist)

Every changed file is on the SPEC ALLOWLIST. No DO-NOT-TOUCH file has any diff.

| File | Allowlist row | Delta |
|------|---------------|-------|
| `packages/payments-native/types.ts` | ✓ §4.2 | +30 (type-only import + 2 optional members + doc comments; every existing member byte-identical) |
| `packages/payments-native/__typetests__/paymentSheetInitInput.orch1387.typetest.ts` | ✓ NEW | +187 |
| `packages/payments-native/tsconfig.orch1387.typetest.json` | ✓ NEW | +29 |
| `packages/payments-native/StripeNativeProvider.tsx` | ✓ CONDITIONAL (triggered — §7) | +8/−2 (props annotation + comment; runtime-inert) |
| `mingla-business/tsconfig.json` | ✓ §4.3 | +2 (exactly the two paths lines) |
| `app-mobile/src/hooks/useReserveTable.ts` | ✓ §4.4.3 | +10/−7 (three erasure-only edits) |
| `.github/scripts/strict-grep/orch-1387-wallet-config-threaded.mjs` | ✓ NEW | +607 |
| `.github/workflows/strict-grep-mingla-business.yml` | ✓ (2 new jobs appended; no existing job modified) | +35 |
| `mingla-business/package.json` | ✓ | +1 script |
| `app-mobile/package.json` | ✓ | +1 script |
| `mingla-business/src/payments/__tests__/walletConfigThreading.orch1387.test.mjs` | ✓ NEW | +262 |
| `app-mobile/src/payments/__tests__/wallet_config_threading.orch1387.test.mjs` | ✓ NEW | +277 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | ✓ (append-only stanza) | +7 |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1387_WALLET_TYPE_CONTRACT.md` | ✓ NEW | this file |
| `Mingla_Artifacts/evidence/ORCH-1387/impl/*` (text evidence, force-added) | mandated by SPEC §8-1/§4.4.3/§9 evidence obligations | 11 small text files |

Commits (in §8 order): `062684521` (types + type lane) → `1ef11ac4a` (paths + cast site + provider triage) → `bcc46997d` (gate + suites + CI wiring) → `5164fa36c` (registry stanza) → evidence + this report.
Ledger acks pushed on the anchor: `414cd670b` (COMMS-0105/0106/0108/0109 IMPLEMENT-phase acks).

## 4. Data-model changes / edge functions

**NONE.** No migration, no RLS, no edge function, no storage, no `verify_jwt` surface. Nothing to
deploy — and per ORCH-1386 HOLD, no `[deploy]` tag, no EAS/OTA.

## 5. The §4.4.3 runtime-equivalence proof (T-16) + prime-directive evidence

The `useReserveTable.ts` diff contains ONLY: (a) a type-only import, (b) a `Pick<>` type
annotation on `const walletConfig`, (c) removal of the `as Record<string, unknown>` cast inside the
spread, (d) comment text. Mechanical proof both ways, same tool + flags pre/post:

- **babel** (`@babel/preset-typescript` — the Metro bundler's actual TS eraser), `comments: false`:
  `BABEL emitted-JS identical: true` (byte-equal). Outputs archived:
  `impl/T16-emitted-js-babel-pre.js` / `-post.js`.
- **tsc** `transpileModule` (target ESNext, module ESNext, removeComments): `TSC emitted-JS identical: true`.

Flow-file literals (T-17): `git diff origin/main...HEAD --stat` lists NEITHER
`nativeCheckoutFlow.native.ts` NOR `nativeCheckoutFlow.ts`; a scoped diff of both = 0 lines.
The sheet config Stripe receives is byte-identical on every callsite, both apps, both platforms.

## 6. Regression tests + the §9 fails-on-revert matrix (CLOSE Step 0.5)

**Happy-path regression tests (implementor-owned, NEW files only — append-only untriggered):**
- `mingla-business/src/payments/__tests__/walletConfigThreading.orch1387.test.mjs` — 10 tests (W-1/W-4/W-6/W-10/W-11 + 2 stripper self-proofs)
- `app-mobile/src/payments/__tests__/wallet_config_threading.orch1387.test.mjs` — 10 tests (W-2/W-5/W-7/W-3/W-8/W-9 + stripper self-proof)
- 20/20 pass pristine (`final-gate-battery.txt`); both files in `git diff origin/main...HEAD --name-only`, same branch as the fix.

**fails-on-revert verified at `5164fa36c`** — by TRUE LINE DELETION per matrix case (not comment-out;
T-12 separately proves the comment-out/decoy shape STILL fails via block-comment stripping).
Full log with per-case gate/suite/tsc exits: `Mingla_Artifacts/evidence/ORCH-1387/impl/revert-matrix-evidence.txt`.

| Case | Revert applied | Expected red | Result |
|------|----------------|--------------|--------|
| T-2 | `applePay:` block deleted from B | gate W-4 + biz suite | PASS (red as named, restored green) |
| T-3 | `cartItems:` line deleted from B | gate W-4 + biz suite | PASS |
| T-4 | `googlePay:` block deleted from B | gate W-6 + biz suite | PASS |
| T-5a/b/c | same three deletions on C | gate W-5/W-5/W-7 + consumer suite | PASS ×3 |
| T-6 | `applePay` deleted from R walletConfig | gate W-8 + consumer suite | PASS |
| T-7 | `...walletConfig` spread deleted, declaration kept | gate W-8 (spread half) | PASS |
| T-8 | hook rebuilt to pick fields instead of `initPaymentSheet(input)` | gate W-10 + biz suite | PASS |
| T-9 | wallet keys removed from types.ts | gate W-11 + biz suite + typetest positives | PASS (all three red) |
| T-10 | `applePay?: any` widening | typetest TS2578 ×4 | PASS |
| T-11 | `as Record<string, unknown>` re-introduced in R | gate W-9 | PASS |
| T-12 | real applePay deleted from B; decoy left ONLY in a `/* */` comment | gate W-4 STILL red (ORPHAN-2 proof) | PASS |
| T-13 | second `initPaymentSheet(` call added to B | gate W-1 (uniqueness) | PASS |
| FINAL | all restores | gate + both suites + lane ALL GREEN; B/C/H/R/T zero dirty | PASS |

Gate self-test (T-14): PASS — every W-rule fires on its synthetic violation fixture, including the
three SPEC-named shapes (block-comment-only applePay, duplicate call, spread-deleted-declaration-kept).
Typetest negatives (T-15): all six `@ts-expect-error` cases hold on pristine (lane green ⇒ each
stays an error; removal of any negative = TS2578 red, mechanism proven by T-10).

## 7. Fresh-npm-ci re-enumeration + triage (SC-11 / T-18) — MATERIAL FINDING

Real `npm ci` in both apps after removing the stale-anchor `node_modules` symlinks
(mingla-business: 1332 packages / 55s; app-mobile: 1167 packages / 51s incl. patch-package).
**Zero `package-lock.json` diff in any workspace** (SC-12 — no STOP condition).

**The composition DIFFERS from investigation Q5's prediction.** Q5 expected the package-internal
TS2307s/TS7031s to vanish under a real post-1385 install. They do NOT: tsc resolves the
`node_modules/@mingla/payments-native` symlink to its REALPATH (`packages/payments-native/`), and
no `node_modules` exists at or above `packages/`, so the package's own vendor imports (`react`,
`expo-constants`, `@stripe/stripe-react-native`) cannot resolve inside either app's tsc program.
Enumeration (identical in both baselines, `tsc-*-baseline-prechange.txt` lines 937-946 / 978-987):

- 5× TS2307 (`react` ×2, `expo-constants`, `@stripe/stripe-react-native` ×2) — environment-structural, NOT fixable inside the package (would need paths/config outside the allowlist). **Reported, not widened.**
- 4× TS7031 implicit-any props in `StripeNativeProvider.tsx:76-79` — **CONDITIONAL allowlist entry TRIGGERED; fixed** with a pure props annotation (`}: StripeNativeProviderProps) =>`), erased at transpile. Both baselines: −4 each.
- 1× TS2875 (jsx-runtime) — same structural class; untouched (line-shifted 85→91 by the annotation comment).

**Net baseline movement (final, `tsc-*-postchange-final.txt`):** business 994→990, consumer
1032→1028. Removed per app: the TS2353 (the registered bug) + 4× TS7031. Added per app: exactly ONE
TS2307 at `types.ts(12,35)` — the §4.2-mandated vendor import joining the same pre-existing
unresolvable-vendor-import class. No other delta; zero errors in/about `useReserveTable.ts`.

## 8. Old → New receipts

### packages/payments-native/types.ts
**Before:** `PaymentSheetInitInput` had no wallet keys — `applePay`/`googlePay` were excess
properties at every callsite (F-1), enforced by nobody.
**Now:** both keys are optional, vendor-typed (`PaymentSheet.ApplePayParams`/`GooglePayParams`) via
a type-only namespace import; doc comments carry the 4.9 contract + name the invariant and gate.
**Why:** SC-1, §4.1/§4.2 — the SDK receives this object verbatim, so the honest type is the vendor's.
**Lines:** +30.

### packages/payments-native/__typetests__/ + tsconfig.orch1387.typetest.json (NEW)
**Before:** no type-level enforcement existed anywhere (neither app's tsc is CI-gated, D-6).
**Now:** a scoped compile-only lane — 4 positives (both callsite payload shapes, the Pick<> reserve
shape, helper-mirror↔vendor assignability) + 6 `@ts-expect-error` negatives; two-sided red proofs
captured. **Why:** SC-8, §4.5.3. **Lines:** +216.

### mingla-business/tsconfig.json
**Before:** payments-native was the ONE `@mingla/*` package missing from paths (F-3) — the native
payment surface was type-invisible to business tsc for 14 months.
**Now:** the two mapping lines, placed to mirror app-mobile's ordering. **Why:** SC-5, §4.3. **Lines:** +2.

### app-mobile/src/hooks/useReserveTable.ts
**Before:** wallet config declared untyped and smuggled past the contract with
`...(walletConfig as Record<string, unknown>)` (F-5) — suppressing ALL type checking of the payload.
**Now:** `walletConfig: Pick<PaymentSheetInitInput, "applePay" | "googlePay">`, plain
`...walletConfig` spread, comment updated (ORCH-0849 rationale kept; stale "not on the shared type"
claim replaced); object body + every other statement byte-identical; emitted JS proven identical.
**Why:** SC-4, §4.4.3. **Lines:** +10/−7 (all four classes erasure-only).

### packages/payments-native/StripeNativeProvider.tsx
**Before:** destructured props implicitly-any (TS7031 ×4) in both app baselines because `React.FC`
degrades where `react` can't resolve (realpath resolution).
**Now:** explicit `}: StripeNativeProviderProps)` annotation — binds the props regardless of react
resolution; runtime-inert. **Why:** SC-11 conditional triage. **Lines:** +8/−2.

### .github/scripts/strict-grep/orch-1387-wallet-config-threaded.mjs (NEW)
**Before:** no gate contained any applePay/cartItems rule (the 0849 parity gate's known gap).
**Now:** W-1..W-11 over the five files, string-aware line+block comment stripping (URLs/template
literals safe), span-scoped rules, single-call uniqueness, googlePay block-scoped country check,
`--self-test` with violation fixtures for every rule. **Why:** SC-6, §4.5.1. **Lines:** +607.

### Structural suites (2 NEW `.test.mjs`)
**Before:** ORCH-1246's tests covered helper math only — zero threading assertions (F-2).
**Now:** 20 node:test cases asserting the same W-contract with an INDEPENDENT scanner
implementation (defense in depth), zero product imports, runnable via bare `node --test`.
**Why:** SC-9, §4.5.2. **Lines:** +539.

### CI + npm wiring
**Before:** nothing ran any wallet-threading check.
**Now:** job `orch-1387-wallet-config-threaded` (raw checkout: self-test + gate + both suites) and
job `orch-1387-wallet-type-contract` (npm-ci'd scoped tsc lane, modeled on meta-1337); `test:orch-1387`
scripts in both apps, both green locally. **Why:** SC-10, §4.5.4. **Lines:** +35 workflow, +2 scripts.

### Mingla_Artifacts/INVARIANT_REGISTRY.md
**Before:** the 4.9 threading behavior was invariant-less.
**Now:** DRAFT `I-PROPOSED-1387-WALLET-CONFIG-THREADED` appended verbatim from SPEC §6 (orchestrator
flips at CLOSE). **Why:** SC-13. **Lines:** +7.

## 9. Cross-surface impact

| # | Surface | Affected? | User-visible change | Parity |
|---|---------|-----------|---------------------|--------|
| 1 | Consumer iOS | YES (types/tests only) | NONE — identical before/after (prime directive) | Automatic at type layer (shared types.ts); callsite verification done per file |
| 2 | Consumer Android | YES (same files) | NONE | Automatic (same TS files; googlePay rides the same change) |
| 3 | Buyer/anon Web | NO | — | Separate Stripe Checkout Sessions rail; native package excluded from web bundle (orch-0778 gate) |
| 4 | Business iOS | YES (tsconfig/tests only) | NONE | Automatic at type layer |
| 5 | Business Android | YES (same file) | NONE | Automatic |
| 6 | Admin Web | NO | — | No native payments surface |
| 7 | Business Web preview | NO | — | Native-only package; web is a passthrough stub |

The observable contract everywhere: Apple Pay / Google Pay keep rendering and the Apple Pay sheet
keeps showing the PRODUCT title (fallback "Ticket"/"Reservation", never "Mingla") — now ENFORCED
instead of unguarded.

## 10. Known issues / honest gaps

1. **SC-2's "no new errors" clause vs the §4.2-mandated import (documented deviation, +1 per app).**
   The vendor import in `types.ts` adds ONE TS2307 (`types.ts(12,35)`) to each app's
   (non-CI-gated) tsc baseline — mechanically unavoidable: §4.1 REJECTS hand-rolled local shapes,
   and the packages dir structurally cannot resolve vendor modules in the app programs (that is
   exactly why the SPEC's own §4.5.3 lane pins the vendor path explicitly). It is the same class as
   the package's two pre-existing unresolvable `@stripe/stripe-react-native` imports. Handled under
   the SPEC's own triage ceiling ("anything more = report, don't widen"). Net baselines still
   SHRANK by 4 lines per app. If Seth wants this residual gone, the clean fix is an
   app-tsconfig paths pin for `@stripe/stripe-react-native` (or react/react-native/expo-constants
   for the whole family) — outside this allowlist; registered as a discovery (D-2 below).
2. **SC-10 on-PR half** — both jobs are wired and their exact commands run green locally; genuine
   red-capable on-PR execution is tester A-4 / CLOSE material (fresh PR event per COMMS-0109).
3. **Device-leg debt (inherited, not new):** the Apple Pay sheet has never been eyeballed on a
   physical device post-1246 — TEST's A-5 read-only leg on the live 1.1.2 binary.
4. No `[TRANSITIONAL]` code introduced. No DIAG markers. No secrets.

## 11. Operator action required

**NONE for this phase.** No migration (`db push` n/a), no edge deploy, no OTA, no store action.
Standing OQ-2 items remain open for Seth (from investigation §12, non-blocking): the Stripe-dashboard
`payment_method_details.card.wallet` check on `pi_3ToXuJI4pBxuXrhh0OaFDbwh`,
`pi_3TooOQI4pBxuXrhh0cZrpJqL` + the two 2026-06-27 succeeded charges.

## 12. Discoveries for Orchestrator

- **D-1 (spec-vs-environment fact, affects future package work):** post-1385 real `npm ci` does
  NOT make package-internal vendor imports resolvable to app tsc — tsc realpaths the `@mingla/*`
  symlinks and `packages/` has no `node_modules` above it. Investigation Q5's "resolve under a real
  npm ci" prediction is falsified; every future `packages/*` type change that imports a vendor
  module will surface the same TS2307 class in both app baselines.
- **D-2 (hardening candidate):** an app-tsconfig `paths` pin for `@stripe/stripe-react-native`
  (and optionally `react`/`expo-constants`) would eliminate the entire package-internal TS2307/TS2875
  family (7 errors per app incl. the new one) — one-line-per-module, but outside this ORCH's allowlist.
- **D-3 (carried from SPEC §10):** I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY registry STATEMENT still
  names `merchant.com.mingla.business.v2` while the gate enforces
  `merchant.com.sethogieva.minglabusiness` — registry-text drift, orchestrator housekeeping.
- **D-4 (test-dir observation):** `app-mobile/__tests__/googlePay_testEnvProductionGate.test.ts` is
  a Deno-style test sitting in the app-mobile tsc include (3 baseline errors: deno.land import +
  `Deno` global ×2) — harmless but noisy in every baseline; cleanup candidate.

— end of report —
