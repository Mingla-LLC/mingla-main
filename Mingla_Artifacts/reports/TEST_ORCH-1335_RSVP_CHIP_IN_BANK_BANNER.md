# TEST — ORCH-1335 [rsvp-chip-in-connect-bank-banner-always-on]

**Branch:** `ORCH-1335-rsvp-chip-in-bank-banner` @ worktree `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1335-[rsvp-chip-in-bank-banner]/`
**Impl under test:** `01a4a3a75` (+ docs `692d8d0b3`)
**Tester adversarial test:** `mingla-business/src/components/rsvp/__tests__/RsvpStep5Setup.chipInWiring.tester.test.ts`

## VERDICT: PASS — P0: 0 · P1: 0 · P2: 0

Runtime claim capped (per mandate): the callout SWAP is proven via the RTL render config (`jest.orch1335.render.cjs`, 3/3) + a full source/wiring trace + provider-predicate verification against the server migration. No full business-app sim/device run of the RSVP wizard was done (heavyweight; authed business-web runtime is known-unreachable per project memory). No claim exceeds "verified via RTL render proof + wiring trace + source."

---

## Mandate item verdicts (all evidence-backed)

### 1. Wiring trace — BOTH compute sites correct & symmetric — PASS
- **Create wizard** (`RsvpCreatorWizard.tsx`): `brand` is a component prop (`RsvpCreatorWizardProps.brand: Brand | null`, line 145). `useMemo` imported (line 15). `const chipInStripeStatus = useBrandStripeStatus(brand?.id ?? null)` called **unconditionally** at top level; `chipInPayoutReady = useMemo(() => isChipInPayoutReady(brand, chipInStripeStatus.data?.status), [brand, chipInStripeStatus.data?.status])`. Threaded into `baseProps` and reaches `RsvpStep5Setup` via `case 4: <RsvpStep5Setup {...baseProps} />`. `baseProps` is built inside a plain per-render function (not a stale memo) → always current.
- **Edit-published** (`EditPublishedScreen.tsx`): `useMemo`/`useCallback` imported (lines 36/38). `rsvpMode` destructured prop (line 293, default false) — defined **before** the hooks (line 387). `const chipInBrandId = rsvpMode ? (liveEvent?.brandId ?? null) : null` then `useBrand(chipInBrandId)` + `useBrandStripeStatus(chipInBrandId)` — both called **unconditionally** (rsvpMode gating is via the `null` argument → disabled query, NOT a conditional hook; the in-code comment confirms "runs every render before any early return shell"). `chipInPayoutReady = useMemo(() => isChipInPayoutReady(chipInBrandQuery.data ?? null, chipInStripeStatus.data?.status), [chipInBrandQuery.data, chipInStripeStatus.data?.status])`.
- **useMemo dep array (stale-memo risk):** edit path deps `[chipInBrandQuery.data, chipInStripeStatus.data?.status]` recompute on brandId change (new query data) and on status flip — **correct**.
- **Stale-CLOSURE risk (the sharper one):** `renderSectionBody` is a `useCallback` (line 1295) that builds `stepBodyProps` (with `chipInPayoutReady`, line 1312) and renders `<RsvpStep5Setup {...stepBodyProps} />` (line 1343). `chipInPayoutReady` **is** in its dependency array (line 1361) → no stale closure. My adversarial test guards exactly this (see below).
- **No conditional-hook violation** in either site.

### 2. Provider-aware predicate mirrors `pg_brand_can_collect` — PASS
Read the server truth: `pg_brand_can_collect` (`20261220000000_orch_1291_rsvp_contributions.sql:195-208`) = `pg_brand_can_charge OR EXISTS(brands WHERE paystack_subaccount_code IS NOT NULL)`; `pg_brand_can_charge` (`20260927000000_orch_1116_booking_gate_rls.sql:72-88`) = attached `stripe_connect_accounts` row with `charges_enabled IS DISTINCT FROM false`. Frontend mirror (`chipInPayoutReadiness.ts`): Paystack → non-blank `paystackSubaccountCode`; Stripe (default) → fresh `status === "active"`. This is **strictly tighter** than the server (`deriveBrandStripeStatus` requires `charges_enabled === true`, not `IS DISTINCT FROM false`; the Stripe rail also gates behind `paymentProvider !== "paystack"`), so it can only produce false-**negatives** relative to the server — the SAFE direction. Adversarial cases all correct: Paystack `""`/`"   "`/`null`/`undefined` subaccount → not-ready; Stripe `onboarding`/`restricted`/`not_connected`/`undefined` → not-ready; a Paystack brand whose Stripe status is `"active"` but no subaccount → not-ready (provider gates first). **No path yields a false positive.**

### 3. Anti-false-positive (cardinal rule) — PASS
While `useBrandStripeStatus` is loading, `data` is `undefined` → `data?.status` is `undefined` → predicate returns `false` → neutral nudge. Edit path: `useBrand` loading → `chipInBrandQuery.data ?? null` is `null` → predicate returns `false` → nudge. Proven at the **render level** by `RsvpStep5Setup.orch1335.render.test.tsx` case 3 (prop omitted → undefined): nudge present, positive callout ABSENT. My tester test additionally proves the predicate never flashes ready from a stale cache even when a brand object literally carries `stripeStatus:"active"`.

### 4. No collateral damage — PASS
- Nudge copy **byte-identical** to origin/main (heading `Connect your bank to collect contributions` + both sub-lines verified char-for-char vs `origin/main:RsvpStep5Setup.tsx`).
- Publish/edit HARD gate untouched: impl commit `01a4a3a75` touches **zero** migration/`pg_brand_can_collect`/publish-RPC files (clean `git diff-tree` file list = 12 expected files only).
- Consumer `RsvpChipInPanel` untouched (`git diff origin/main` empty).
- Other steps that ignore the new optional prop still typecheck (only type-surface change is an **optional** `chipInPayoutReady?: boolean` on `StepBodyProps` — cannot break existing consumers; tsc delta confirms, see gates).
- Existing testIDs preserved (`rsvp-contribution-connect-callout`) + new `rsvp-contribution-ready-callout` added.
- Tokens/Icon exist: `semantic.success="#22c55e"`, `semantic.successTint="rgba(34,197,94,0.18)"` (`designSystem.ts:299-300`), `Icon` `check` glyph (`Icon.tsx:131`).

### 5. Tester adversarial test (DIFFERENT axis) — WRITTEN, COMMITTED, FAILS-ON-REVERT
`mingla-business/src/components/rsvp/__tests__/RsvpStep5Setup.chipInWiring.tester.test.ts` (7 tests, pure `.test.ts` → runs under default `jest.config.cjs`, CI-enforced). Attacks two axes the implementor's suite does NOT touch:
- **Stale-cache false-positive (runtime):** feeds the predicate a brand carrying a stale `stripeStatus:"active"` cache field while the fresh arg is `undefined`(loading)/`"restricted"` → must stay not-ready. The implementor's predicate test uses `Pick<Brand,"paymentProvider"|"paystackSubaccountCode">`, so it never exercises a brand that actually carries the stale field. Plus an active→restricted transition.
- **Wiring / stale-closure (source-structure):** asserts BOTH `RsvpCreatorWizard` and `EditPublishedScreen` feed the FRESH `useBrandStripeStatus(...).data?.status` into `isChipInPayoutReady` (never `brand.stripeStatus`), and that `EditPublishedScreen`'s `renderSectionBody` useCallback lists `chipInPayoutReady` in its dependency array (the stale-closure guard). No existing test inspects the wizard/edit wiring or that dep array.

**Fails-on-revert (baseline = restored impl `01a4a3a75`):**
- Revert A — weaken `chipInPayoutReadiness.ts` to fall back to `brand.stripeStatus === "active"` → **2 stale-cache tests FAIL** (`Expected false, Received true`); restored → PASS.
- Revert B — remove `chipInPayoutReady` from the `renderSectionBody` dep array (line 1361) → **dep-array stale-closure test FAILS**; restored → PASS.
- Both reverts were working-tree only (never committed) and fully restored (`git checkout --`); final tree clean apart from the untracked test.

### 6. Gates (run by tester)
- **`npx tsc --noEmit` (business):** raw command emits **760** errors in THIS fresh worktree, but the **parent commit `f2eb308be` emits 756** — the delta is exactly **+4**, ALL from the ORCH-1335 RTL render test file resolving `@testing-library/react-native` from the gitignored `.orch1118-testdeps` overlay (the identical, established, accepted pattern of every shipped render test, e.g. `LiveOfferingCard.orch1143.render.test.tsx`; render-test files are not the CI tsc gate target). **Zero** of the 760 errors are in any ORCH-1335 product or CI-gated test file (`chipInPayoutReadiness.ts`, `RsvpStep5Setup.tsx`, `RsvpCreatorWizard.tsx`, `EditPublishedScreen.tsx`, `types.ts`, the 2 `.test.ts`). 688/760 are pre-existing `../packages/*` monorepo noise (fresh worktree, packages not built). Conclusion: **ORCH-1335 introduces zero new tsc errors** in product/CI-test code. The implementor's "TSC_EXIT=0" was run in a fully-installed env; not reproducible in a fresh worktree, but the +4 delta is environmental/accepted, not a defect.
- **CI pure-logic pair (default jest):** `PASS chipInPayoutReadiness.test` + `PASS RsvpStep5Setup.chipInBanner.test` → **18 passed, 18 total**.
- **CI pure-logic incl. tester test:** `Test Suites: 3 passed` → **25 passed, 25 total**.
- **RTL render proof (`jest.orch1335.render.cjs --runInBand`):** `PASS RsvpStep5Setup.orch1335.render.test.tsx` → **3 passed, 3 total** (ready→positive/nudge-absent; not-ready→nudge/positive-absent; undefined-loading→nudge/positive-absent).

---

## Notes / caveats
- Runtime coverage is RTL render config + wiring trace + source (no device/sim run of the full wizard; authed biz-web runtime unreachable per memory). Business-web preview parity is automatic (same RN-web tree) and inherits the cap.
- The raw `npx tsc --noEmit` is noisy in a fresh worktree (756 pre-existing errors); this is environmental (unbuilt packages + overlay-only render-test deps), not an ORCH-1335 regression. Recommend the CLOSE gate run tsc in a fully-installed tree or scope the typecheck; ORCH-1335 itself is tsc-clean.
