# IMPLEMENTATION — ORCH-1335 [rsvp-chip-in-connect-bank-banner-always-on]

**Branch:** `ORCH-1335-rsvp-chip-in-bank-banner` (rebased on origin/main `f2eb308be`)
**Impl commit:** `01a4a3a75` — "ORCH-1335: payout-aware RSVP chip-in bank banner"
**Status:** BUILT EXACTLY TO SPEC. tsc green, CI pure-logic pair green (18/18), RTL render proof green (3/3), fails-on-revert proven against `01a4a3a75`.

---

## 1. What changed (spec §7 manifest — all built)

| File | Change |
|---|---|
| `mingla-business/src/utils/chipInPayoutReadiness.ts` | **NEW** — `isChipInPayoutReady(brand, freshStripeStatus)` pure predicate. Mirrors `pg_brand_can_collect`: Paystack rail → non-blank `paystackSubaccountCode`; Stripe rail (default) → `freshStripeStatus === "active"`. `null`/`undefined` brand → false; undefined/loading status → false (no false-positive). No React/JSX → runs under default `jest.config.cjs`. |
| `mingla-business/src/components/event/types.ts` | Added optional `chipInPayoutReady?: boolean` to `StepBodyProps` (documented RSVP-chip-in-only, safe-ignored by other steps + undefined-safe). |
| `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx` | Imported `semantic` (added to the existing designSystem import) + `Icon`; destructured `chipInPayoutReady`; replaced the UNCONDITIONAL amber nudge with a `chipInPayoutReady ? <ready> : <nudge>` ternary. `true` → green "Payouts are on" (`readyCallout`, `check` icon in `semantic.success`, testID `rsvp-contribution-ready-callout`); `false`/undefined → today's byte-identical amber nudge (testID `rsvp-contribution-connect-callout`). Added 4 styles (`readyCallout`/`readyHeadingRow`/`readyHeading`/`readySub`) mirroring `connectCallout` with the kit's green success tokens. |
| `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx` | Imported `useBrandStripeStatus` + `isChipInPayoutReady`; added `const chipInStripeStatus = useBrandStripeStatus(brand?.id ?? null)` + `useMemo` computing `chipInPayoutReady`; threaded `chipInPayoutReady` into `baseProps` (flows to `RsvpStep5Setup` via the `{...baseProps}` spread). |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | Imported `useBrand` + `useBrandStripeStatus` + `isChipInPayoutReady`; added rsvpMode-gated `chipInBrandId`/`useBrand`/`useBrandStripeStatus` + `useMemo` (both hooks accept `null` → disabled for ticketed edits); threaded `chipInPayoutReady` into `stepBodyProps` + added it to the `renderSectionBody` useCallback dep array. |
| `mingla-business/src/utils/__tests__/chipInPayoutReadiness.test.ts` | **NEW** — predicate permutations (both rails; active/onboarding/restricted/not_connected/undefined/null; Paystack null/empty/whitespace subaccount; default-rail; null/undefined brand). |
| `mingla-business/src/components/rsvp/__tests__/RsvpStep5Setup.chipInBanner.test.ts` | **NEW** — `fs.readFileSync` source-structure guard: both callout copies + both testIDs + the `chipInPayoutReady ?` conditional present + `semantic.success`/`name="check"`. |
| `mingla-business/src/components/rsvp/__tests__/RsvpStep5Setup.orch1335.render.test.tsx` | **NEW** — RTL runtime swap proof (ready/unconnected/undefined-loading). |
| `mingla-business/jest.orch1335.render.cjs` | **NEW** — worktree-local render config (clone of `jest.orch1143.render.cjs`; RN preset + `.orch1118-testdeps` RTL overlay; `testMatch` → this file). |
| `mingla-business/jest.config.cjs` | APPENDED `RsvpStep5Setup\.orch1335\.render\.test\.tsx$` to `testPathIgnorePatterns` (one additive line). |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Added DRAFT invariant `I-PROPOSED-1335-CHIP-IN-BANK-BANNER-PAYOUT-AWARE` (flips ACTIVE at CLOSE). |

**Hard guards honored:** `pg_brand_can_collect` + publish/edit RPCs untouched; consumer `RsvpChipInPanel` untouched; nudge copy byte-identical; `chipInPayoutReady` optional; loading/undefined always falls to the nudge (never flashes a false positive). `currentBrandStore.Brand` is a re-export of `types/brand.Brand`, so the wizard's `brand` prop is assignable to the util's `Pick<Brand, …>` param with no cast.

**Env note:** the RTL overlay `.orch1118-testdeps/` was not present in this fresh worktree; provisioned per the documented one-time setup (`react-test-renderer@19.1.0` + `@testing-library/react-native@14.0.0` into the gitignored overlay) — a targeted 2-package install, NOT a full `npm ci`.

---

## 2. Gate results (against impl HEAD `01a4a3a75`)

### TypeScript — PASS
```
cd mingla-business && npx tsc --noEmit
TSC_EXIT=0   (no errors)
```

### CI pure-logic pair (default jest.config.cjs) — PASS 18/18
```
PASS src/components/rsvp/__tests__/RsvpStep5Setup.chipInBanner.test.ts
PASS src/utils/__tests__/chipInPayoutReadiness.test.ts
Test Suites: 2 passed, 2 total
Tests:       18 passed, 18 total
```

### RTL render proof (jest.orch1335.render.cjs) — PASS 3/3
```
PASS src/components/rsvp/__tests__/RsvpStep5Setup.orch1335.render.test.tsx
  ✓ READY (true) → positive 'Payouts are on', neutral nudge absent
  ✓ NOT READY (false) → neutral nudge, positive callout absent
  ✓ LOADING / UNKNOWN (prop omitted → undefined) → neutral nudge, NO false-positive flash
Tests: 3 passed, 3 total
```

### Lint (touched files)
No CI job runs `expo lint`/eslint as a blocking gate (CI gates = strict-grep + jest + tsc). Ran eslint on all touched files anyway:
- `src/components/rsvp/RsvpStep5Setup.tsx`: 2 `react/no-unescaped-entities` errors on the nudge sub-copy (`isn't`, `you'll`) — **PRE-EXISTING on origin/main** (identical copy at origin/main lines 306–307; verified by linting the origin/main version in-tree → same 2 errors). Kept byte-identical per the spec's hard guard. My new positive-callout copy uses an em-dash, no apostrophes → adds zero new unescaped-entity issues.
- `src/components/rsvp/__tests__/RsvpStep5Setup.orch1335.render.test.tsx`: `import/no-unresolved` (`@testing-library/react-native`) + `no-require-imports`/`import/first` — **matches the established render-test pattern exactly** (the shipped `LiveOfferingCard.orch1143.render.test.tsx` emits the identical set; RTL lives in the gitignored overlay so eslint can't resolve it).
- `RsvpCreatorWizard.tsx` / `EditPublishedScreen.tsx`: only pre-existing unused-var / exhaustive-deps warnings on lines I did not touch. My additions introduce no new lint findings.
- `chipInPayoutReadiness.ts`, `types.ts`, `chipInPayoutReadiness.test.ts`, `RsvpStep5Setup.chipInBanner.test.ts`: clean.

---

## 3. Fails-on-revert proof (cited hash: `01a4a3a75`)

**Revert applied to the working tree:** (a) `RsvpStep5Setup.tsx` restored to origin/main (unconditional nudge, no prop), and (b) `isChipInPayoutReady` weakened to always-true (Paystack branch + fresh-Stripe rule dropped).

### FAIL — pure-logic pair (reverted)
```
FAIL src/components/rsvp/__tests__/RsvpStep5Setup.chipInBanner.test.ts
  ● adds the positive 'Payouts are on' confirmation copy + testID
      Expected substring: "Payouts are on"
  ● gates the two callouts on the chipInPayoutReady prop (NOT unconditional)
      Expected substring: "chipInPayoutReady ?"
  ● renders the positive confirmation with the semantic success token + check icon
      Expected substring: "semantic.success"
FAIL src/utils/__tests__/chipInPayoutReadiness.test.ts
  ● returns false when Stripe status is onboarding/restricted/not_connected   Expected: false  Received: true
  ● returns false while the status is still loading (undefined)               Expected: false  Received: true
  ● returns false when the status is null                                     Expected: false  Received: true
  ● Paystack blank subaccount even if Stripe active                           Expected: false  Received: true
```

### FAIL — RTL render proof (reverted)
```
FAIL src/components/rsvp/__tests__/RsvpStep5Setup.orch1335.render.test.tsx
  ✕ READY (true) → positive 'Payouts are on', neutral nudge absent
      Unable to find an element with text: Payouts are on
Tests: 1 failed, 2 passed, 3 total
```

### RESTORE (`git checkout -- …`) → PASS
```
PASS src/components/rsvp/__tests__/RsvpStep5Setup.chipInBanner.test.ts
PASS src/utils/__tests__/chipInPayoutReadiness.test.ts
Tests: 18 passed, 18 total

PASS src/components/rsvp/__tests__/RsvpStep5Setup.orch1335.render.test.tsx
Tests: 3 passed, 3 total
```

Both the predicate weakening AND the component un-swap flip the guards red; restoring the fix returns all suites green. Working tree clean after restore (`git status --short` empty).

---

## 4. Notes for tester (spec §5.b)

- Adversarial predicate axis (Paystack null/empty subaccount with Stripe active → false; onboarding/restricted → nudge) is already covered in `chipInPayoutReadiness.test.ts`; the tester's sibling `.tester.test.ts` can extend on the readiness SOURCE axis.
- The undefined/loading render case (no false-positive flash) is the third RTL case and passes.
- business-web preview parity is automatic (same component tree via react-native-web); per memory the authed biz-web runtime is not QA-drivable, so the web claim is capped at source + native-sim render proof.
