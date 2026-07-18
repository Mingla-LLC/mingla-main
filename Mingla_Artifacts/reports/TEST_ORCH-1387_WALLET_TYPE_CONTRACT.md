# TEST — ORCH-1387 [wallet config first-class on PaymentSheetInitInput + Apple-4.9 threading regression net]

Date: 2026-07-17 · Phase: TEST · mingla-tester (Claude)
Worktree: `~/Desktop/mingla-orchs/ORCH-1387-[applepay-type-plumbing]/` branch `ORCH-1387-applepay-type-plumbing`
Rebased onto origin/main `0494a4146` (post-fix, COMMS-0109 factored) before ANY check; implementor HEAD after rebase: `d68cb0669`; tester test commit: `efc30e309`.
SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-1387_WALLET_TYPE_CONTRACT_AND_49_NET.md`
Implementation under test: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1387_WALLET_TYPE_CONTRACT.md`
Ground truth: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1387_APPLEPAY_TYPE_PLUMBING.md`

---

## 1. VERDICT

**PASS** — P0: 0 · P1: 0 · P2: 2 · P3: 2 · P4: 3.

Every implementor claim I could re-derive independently held, several beyond what was claimed. The
prime directive (ZERO runtime delta) is now proven for the ENTIRE product-code surface of the
branch — I independently re-derived emitted-JS byte-equality from the git revisions for BOTH
product files (`useReserveTable.ts` AND `StripeNativeProvider.tsx`, the latter beyond the
implementor's own T-16 which covered only the former), under both babel preset-typescript and tsc
transpileModule. The full battery re-ran green from a clean seat; 4 of the 11 revert drills chosen
by me re-executed red-on-revert/green-on-restore; the adversarial campaign found NO defect in the
shipped code — it found six green-while-broken decoy shapes in the NEW net's coverage breadth,
severity-graded per the dispatch ("findings = severity-graded gaps, not automatic FAIL"), the two
realistic ones as P2 hardening items.

Phase 0.A sim-gate class: **exempt (type/CI/gate/build-config change with mechanically proven zero
runtime delta)** — stated per skill rule; the one device-touching angle (A-5) is a read-only check
of the PRE-branch live 1.1.2 binary and is explicitly BLOCKED-with-operator-ask below (§8), not a
verdict cap on this change.

## 2. SC-by-SC matrix (all independently re-derived — no implementor evidence trusted)

| SC | Verdict | Independent evidence (this session, rebased tree) |
|----|---------|---------------------------------------------------|
| SC-1 | **PASS** | Diff read verbatim: `types.ts` declares `applePay?: PaymentSheet.ApplePayParams` + `googlePay?: PaymentSheet.GooglePayParams` via type-only namespace import; grep of `packages/payments-native/` (excl. typetests): zero hand-rolled wallet shapes |
| SC-2-biz | **PASS** (operative clauses; documented deviation verified) | My own `npx tsc --noEmit` run: 989 error lines, **byte-identical** to the archived `tsc-biz-postchange-final.txt` (diff = their EXIT trailer only); ZERO errors mentioning applePay/googlePay/PaymentSheetInitInput; TS2353@(351,9) GONE; exactly ONE `types.ts(12,35)` TS2307 — same pre-existing unresolvable-vendor class (5 siblings in the same package block), mechanically forced by the SPEC's own §4.1/§4.2 mandate. Deviation graded P3 (F-T3 below), routed as discovery D-2 |
| SC-2-consumer | **PASS** (same shape) | My run: 1027 lines, byte-identical to archived final; `nativeCheckoutFlow.ts(327,9)` TS2353 GONE; zero `useReserveTable` errors; the only "wallet" greps are the pre-existing Deno-file noise (implementor D-4) |
| SC-3-biz / SC-3-consumer | **PASS** | `git diff origin/main...HEAD -- <both flow files>` = **0 lines** (run myself post-rebase) |
| SC-4 | **PASS** | No `as Record<string, unknown>` in R (gate W-9 + suite green); `Pick<PaymentSheetInitInput, "applePay" \| "googlePay">` annotation read in diff; **A-1 equivalence re-derived independently — see §5** |
| SC-5 | **PASS** | tsconfig diff = exactly the two §4.3 lines, placed between theme-animations and phone-input; `app-mobile/tsconfig.json` absent from branch diff |
| SC-6 | **PASS** | Gate `--self-test` exit 0 + pristine run exit 0, executed myself |
| SC-7 | **PASS** | Implementor's 14-run matrix accepted AFTER spot re-execution: 4/11 drills chosen by ME re-executed (§4) — every one red on the named net(s), green on restore |
| SC-8 | **PASS** | Lane green pristine (exit 0, run myself); T-9 red path re-proven (types revert → gate W-11 + lane red inside my fails-on-revert run); T-10 re-executed: `applePay?: any` → 4× TS2578, lane exit 2; restore green |
| SC-9 | **PASS** | Both suites 20/20 pristine (run myself); suite-red re-proven inside my drills (T-3 → biz suite 9/1; T-6 → consumer suite 9/1; T-8 → biz suite 8/2) |
| SC-10 | **PASS (local half) / CLOSE-carry (on-PR half, by SPEC design)** | Both jobs present, YAML parses (346 jobs), commands verified byte-for-byte vs local battery; both `test:orch-1387` scripts green run myself. On-PR half = §6 A-4 confirmation list for the orchestrator |
| SC-11 | **PASS** | Enumeration verified against my own baselines: −TS2353, −4× TS7031 per app, +1 TS2307/app; `StripeNativeProvider.tsx` annotation **proven emitted-JS byte-identical by me** (§5 — beyond the claim); residuals reported not fixed |
| SC-12 | **PASS** | `git status --porcelain -- '*package-lock.json'` empty on the rebased tree with real installs present (1332/1167-package node_modules, vendor 0.65.1 confirmed on disk) |
| SC-13 | **PASS** | Registry stanza diff read against SPEC §6 — verbatim; DRAFT status intact for orchestrator flip |
| SC-14 | **PASS (strengthened)** | Product-code runtime surface = `useReserveTable.ts` + `StripeNativeProvider.tsx`; BOTH proven emitted-JS byte-identical (§5). Everything else: types, compiler config, tests, gate, workflow, registry docs — verified from the diff file list |

## 3. Findings

### F-T1 (P2) — W-8's spread check matches by substring: `...walletConfigEmpty` decoy is green across ALL CI nets
- **Evidence:** probe P-2 executed on disk: declared `const walletConfigEmpty = {}` and swapped the real spread to `...walletConfigEmpty,` in `app-mobile/src/hooks/useReserveTable.ts` → gate exit **0**, consumer structural suite **10/10 green** (`span.includes("...walletConfig")` matches the substring of `...walletConfigEmpty`; gate line 312, suite line 264). Wallet keys never reach `initPaymentSheet` at runtime — Apple Pay/Google Pay dark on the reserve flow with all-green CI.
- **Impact:** the most realistic accidental green-while-broken shape found (declaration/spread drift via rename); the net's core promise ("declared-but-never-passed is the silent-drop shape" — the suite's own words) has a substring hole. My tester suite incidentally reds on this shape (exact-token precondition on `        ...walletConfig,`), but it is not CI-wired.
- **Required fix (one line, follow-up ORCH or CLOSE-adjacent hardening — NOT this branch):** boundary-match the spread token (e.g. regex `/\.\.\.walletConfig\s*[,)]/` or reject `...walletConfig` followed by an identifier char) in gate + suite.
- **Retest:** re-run probe P-2 (`scratchpad/a2-decoy-probes.mjs` shape) — must go red.

### F-T2 (P2) — H-file (hook) has no uniqueness rule: dead-code decoy forward + second sanitized call is green
- **Evidence:** probe P-6: `await (false ? initPaymentSheet(input) : initPaymentSheet(sanitize(input)))` in `useStripePaymentSheet.ts` → `checkHookFile` green (the literal `initPaymentSheet(input)` exists in dead code; no count rule on H, unlike W-1/W-2/W-3 on B/C/R; no "applePay"/"merchantDisplayName" token needed to sanitize).
- **Impact:** structural asymmetry — the file the invariant calls MOST load-bearing (whole-object forward) is the only scanned file without single-call uniqueness.
- **Required fix:** add a `countToken(stripped, "initPaymentSheet(") === 1` rule for H (gate + biz suite).
- **Retest:** re-run probe P-6 — must go red.

### F-T3 (P3) — SC-2 letter-deviation confirmed real and allowlist-unavoidable: +1 TS2307/app (`types.ts(12,35)`)
- **Evidence:** my own tsc runs (§2 SC-2 rows); the vendor import cannot resolve from `packages/` in the app programs (no node_modules at/above `packages/`, tsc realpaths the symlink) — implementor D-1 mechanism independently confirmed.
- **Impact:** +1 line in each NON-CI-gated baseline; joins 6 pre-existing errors of the identical class in the same package.
- **Required fix:** none on this branch (allowlist forbids it); D-2 (app-tsconfig `paths` pin for `@stripe/stripe-react-native` — kills all 7/app) is the clean follow-up.
- **Retest:** after D-2 ships, both baselines lose the whole package-internal TS2307/TS2875 family.

### F-T4 (P3) — text-net residual blind spots (adversary-grade, pinned for the record)
- **Evidence:** probes P-1 (all three tokens smuggled inside an in-span string literal — the `stripped` text intentionally keeps string contents), P-7 (`import { buildEvilItems as buildApplePayCartItems }` re-points the helper — call-name token matches, import provenance unchecked), P-4/P-5 (`walletConfig.applePay = undefined` mutation; `applePay: flag ? undefined : {…}` conditional disable — semantically dark, textually present). All green on gate + suites.
- **Impact:** none reachable by accident; P-1 requires three exact tokens in in-span strings, P-4/P-5/P-7 are deliberate edits. Text nets cannot police semantics — the compensating controls are the type lane, review, and the OQ-2b device eyeball.
- **Required fix:** optional hardening only — an import-source rule for `buildApplePayCartItems` (P-7) is the only cheap one; graded P3 collectively.
- **Retest:** probes P-1/P-4/P-5/P-7 in `scratchpad/a2-decoy-probes.mjs`.

### F-T5 (P4 — praise) — parenthesized cast forms fail CLOSED via W-8's literal spread token
- Probe P-3: `...(walletConfig as any),`, `...(walletConfig as unknown as Record<string, unknown>),`, `...(walletConfig as object),` ALL go red (the paren breaks the `...walletConfig` literal → W-8 spread-half fires). SPEC A-3's feared W-9 pattern-evasion is structurally covered; pinned permanently in my adversarial suite so a gate refactor can't reopen it.

### F-T6 (P4 — praise) — evidence archives are honest
- Both archived tsc baselines byte-identical to my fresh runs; the §10 "honest gaps" section pre-declared the exact deviation I found; the D-1 falsification of the investigation's Q5 prediction is real and was reported against the implementor's own interest.

### F-T7 (P4 — praise) — gate module design enabled real-module adversarial testing
- Main-guarded exports (`scan`/`callSpan`/checkers/`FILES`) let my suite attack the SHIPPED module with real-HEAD mutations per COMMS-0106 provenance — no re-implementation drift possible.

## 4. Step 0.5 — independent re-run of the fails-on-revert proof (hashes cited)

Executed at rebased HEAD `d68cb0669` (implementor's proof commit `5164fa36c` was pre-rebase; per
the verify-against-MERGED-main rule I re-executed against the rebased tree — same content, current
ancestry). All reverts by TRUE LINE DELETION, all restores verified green:

| Drill (my pick) | Revert applied by me | Red observed (exact) | Restore |
|---|---|---|---|
| T-3 | 5-line `cartItems: buildApplePayCartItems(…)` call deleted from B | gate exit 1: `W-4: … call span is missing \`cartItems: buildApplePayCartItems(…)\`` + biz suite 9/1 (`not ok 6 — W-4 cart line`) | gate exit 0 |
| T-6 | 8-line `applePay: {…}` block deleted from R walletConfig | gate: 2× W-8 failures (missing applePay + missing cart line) + consumer suite 9/1 (`not ok 8 — W-8 body`) | gate exit 0 |
| T-8 | hook forward rebuilt to `initPaymentSheet({ merchantDisplayName…, applePay… })` | gate: 3× W-10 failures + biz suite 8/2 (`not ok 8`, `not ok 9`) | gate exit 0 |
| T-10 | `applePay?: PaymentSheet.ApplePayParams` → `applePay?: any` in types.ts | scoped lane exit 2 with 4× TS2578 at typetest lines 116/131/144/154 | lane exit 0 |

Plus the full pristine battery from a clean seat: gate self-test exit 0 · gate exit 0 · both
structural suites 20/20 · scoped lane exit 0 · `test:orch-1387` green in both apps · zero
lockfile diff. Environment: real (non-symlinked) node_modules both apps, vendor 0.65.1 on disk,
all six `@mingla/*` symlinks present (post-1385 install state).

## 5. A-1 — runtime-equivalence INDEPENDENTLY re-derived (the prime-directive proof)

Method: both revisions pulled straight from git (`git show origin/main:<file>` vs `HEAD:<file>`),
transpiled by me with (a) `@babel/core` + `@babel/preset-typescript` (Metro's actual TS eraser),
`comments: false`, and (b) `typescript.transpileModule` (ESNext/ESNext, `removeComments`), byte-compared:

| File | babel sha256 (pre == post) | tsc sha256 (pre == post) |
|---|---|---|
| `app-mobile/src/hooks/useReserveTable.ts` | `dd382b91…39c0` — **identical** | `f02c95c5…47bf` — **identical** |
| `packages/payments-native/StripeNativeProvider.tsx` (beyond the implementor's T-16 scope) | `87a476e5…a135` — **identical** | `376f8f19…9289` — **identical** |

Combined with SC-3's zero-diff flow files, the object Stripe receives is byte-identical on every
callsite, both apps, both platforms. **Prime directive: HELD, independently proven.**

## 6. A-4 — CI truth: static verification done; on-PR confirmation list for CLOSE

Verified statically by me (and pinned in my adversarial suite so it fails-on-revert):
- Both jobs exist and YAML-parse (346 jobs total); the threaded job runs gate `--self-test` → gate
  → both structural suites on RAW checkout; the type-contract job runs `npm ci` (mingla-business,
  lockfile-cached) → the scoped lane — byte-for-byte the commands I ran green locally.
- Workflow `on.pull_request` path filters cover EVERY changed path class of this branch:
  `mingla-business/**`, `app-mobile/**`, `packages/**`, `.github/scripts/strict-grep/**`, and the
  workflow file itself (any one suffices to trigger; `branches: [main, Seth]` matches the CLOSE
  base). `Mingla_Artifacts/**` is NOT a trigger path — standing docs-only behavior, not a gap.

**Orchestrator MUST confirm on the real CLOSE PR (COMMS-0109 discipline):**
1. The CLOSE PR is a **FRESH pull_request event** (this branch is already rebased onto post-fix
   main `0494a4146`; never diagnose via a RERUN of any pre-existing check run — reruns rebuild the
   stale merge snapshot).
2. Both checks appear in the rollup and are GREEN: `orch-1387-wallet-config-threaded` and
   `orch-1387-wallet-type-contract`.
3. Red-capability is NOT re-provable on the PR without pushing a deliberate red commit (forbidden);
   the red-capability evidence chain is: gate self-test + my §4 drills + the implementor's 14-run
   matrix, all executing the SAME commands the jobs run.
4. No `[deploy]` tag anywhere (SPEC §11; ORCH-1386 HOLD).
5. Optional one-line hardening at CLOSE (orchestrator's call): append
   `mingla-business/src/payments/__tests__/walletConfigAdversarial.orch1387.tester.test.mjs` to the
   threaded job's `node --test` list — it currently runs locally only (F-T1's incidental net).

## 7. Adversarial test added (CLOSE Step 0.5, tester side)

- **Files (all NEW, on-branch, in `git diff origin/main...HEAD --name-only`):**
  - `mingla-business/src/payments/__tests__/walletConfigAdversarial.orch1387.tester.test.mjs` (10 tests)
  - `packages/payments-native/__typetests__/paymentSheetInitInput.orch1387.tester-adversarial.typetest.ts`
  - `packages/payments-native/tsconfig.orch1387.tester-adversarial.typetest.json`
- **Different angles than the implementor's nets:** real-module attacks on the SHIPPED gate with
  real-HEAD mutations (not synthetic fixtures); fail-closed pins (parenthesized cast forms,
  googlePay-without-country, hook rebuild, types revert — on real content); A-3 rejection-breadth
  lane (Deferred/Recurring union positives + 6 breadth negatives: deferredDate-less Deferred,
  string `testEnv`, excess key INSIDE ApplePayParams, string `isPending`, non-array `cartItems`,
  numeric `label`); A-4 static CI-wiring assertions (jobs + path filters).
- **fails-on-revert verified at `efc30e309`:** true deletion of the types.ts wallet-key extension →
  **3 tests red** (W-11 real-content pin, pristine-gate-binary, A-3 breadth lane) → restore →
  **10/10 green**. Two-sided: `applePay?: any` widening → **5× TS2578** in my lane → restore green.
- Both the implementor's happy-path suites AND my adversarial suite are visible in the closing
  branch diff. Append-only: zero existing test files modified (new files only; jest `testMatch`
  confirmed blind to `.mjs`/`.typetest.ts` — no lane poisoning).

## 8. Device / parity matrix

| Surface | Result | Basis |
|---|---|---|
| Consumer iOS | PASS (type/coverage layer) | Shared types + C/R callsites verified; zero runtime delta proven §5 |
| Consumer Android | PASS | Same files; googlePay analog typed + gated (W-7/W-8) |
| Buyer/anon Web | skipped — does not ship there | Separate Checkout Sessions rail; native package web-excluded (orch-0778) |
| Business iOS | PASS | tsconfig visibility closed; B callsite gated (W-1/W-4/W-6); baseline re-run by me |
| Business Android | PASS | Same file, googlePay analog |
| Admin Web (adjacent) | skipped — no native payments surface | — |
| Business Web preview (adjacent) | skipped — native-only package, web stub | — |
| **Physical iPhone (A-5, HITL)** | **BLOCKED — operator-unblock ask below** | Device "Seth's iPhone" (iPhone 15) IS paired/available via devicectl, but physical-iPhone is human-in-the-loop by house rule (never puppeted), and this background TEST leg cannot pause mid-run for a human step. **The leg tests the LIVE 1.1.2 App Store binary, which predates this branch entirely** — with zero runtime delta proven (§5), its outcome cannot change this ORCH's verdict; it retires the INHERITED post-1246 verification debt (investigation F-7/F-8). |

**Operator ask (OQ-2b, unchanged from investigation §12 — 2 minutes):** on your iPhone (Wallet card
present): live 1.1.2 **business** app → any paid event → checkout → payment sheet. Confirm
(a) the Apple Pay row renders, (b) tapping it shows the **event title** (fallback "Ticket") on the
sheet's line item — never "Mingla". Do NOT authorize. Companion 5-min check: Stripe dashboard
`payment_method_details.card.wallet` on `pi_3ToXuJI4pBxuXrhh0OaFDbwh`, `pi_3TooOQI4pBxuXrhh0cZrpJqL`
+ the two 2026-06-27 succeeded charges.

## 9. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No UI/interaction change (zero runtime delta, §5) |
| 2 | One owner per truth | PASS | Wallet types single-sourced in the shared package; the F-5 cast (a second de-facto owner of the contract) removed |
| 3 | No silent failures | PASS | Gate/suites/lane all fail loud (exit 1/2, named rules); fs error path exits 2 distinctly |
| 4 | One query key per entity | N/A | No query layer touched |
| 5 | Server state stays server-side | N/A | — |
| 6 | Logout clears everything | N/A | — |
| 7 | `[TRANSITIONAL]` labeled | PASS | None introduced (diff-grepped) |
| 8 | Subtract before adding | PASS | Cast + 6 stale comment lines removed; baselines net-shrank 4 lines/app |
| 9 | No fabricated data | N/A | — |
| 10 | Currency-aware | N/A | Currency literals untouched (zero-diff flow files) |
| 11 | One auth instance | N/A | — |
| 12 | Validate at the right time | N/A | — |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | — |

## 10. Discoveries for Orchestrator (register, do not widen)

- **DT-1 (from F-T1/F-T2, P2s):** gate+suite hardening follow-up — spread-token boundary match and
  H-file uniqueness rule; one-line each; candidate for a small ORCH or the next gate revision.
  Optional immediate mitigation at CLOSE: CI-wire my adversarial suite (§6 item 5).
- **DT-2 (carried, implementor D-2):** app-tsconfig `paths` pin for `@stripe/stripe-react-native`
  (+optionally react/expo-constants) kills the 7-error/app package-internal TS2307/TS2875 family
  incl. the SC-2 residual.
- **DT-3 (carried, SPEC §10 / implementor D-3):** PAYMENTSHEET-PARITY registry statement still
  names `merchant.com.mingla.business.v2` vs the gate's `merchant.com.sethogieva.minglabusiness`.
- **DT-4 (carried, implementor D-4):** Deno-style `googlePay_testEnvProductionGate.test.ts` noise
  in the app-mobile tsc baseline.
- **DT-5 (standing operator items):** OQ-2a Stripe-dashboard wallet check + OQ-2b device eyeball
  (§8) — non-blocking, named for Seth.

## 11. Routing

**PASS → CLOSE (orchestrator):** one PR carrying branch `ORCH-1387-applepay-type-plumbing`
(tester HEAD `efc30e309`); flip DRAFT `I-PROPOSED-1387-WALLET-CONFIG-THREADED` ACTIVE; execute the
§6 A-4 on-PR confirmation list; standard pre-merge gate, no `--admin` over red; registry row
removal + worktree reap per house rules; NO `[deploy]`.

— end of report —
