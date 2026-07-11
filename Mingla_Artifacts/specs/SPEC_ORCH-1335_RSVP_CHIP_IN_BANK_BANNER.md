# SPEC — ORCH-1335 [rsvp-chip-in-connect-bank-banner-always-on]

**Classification:** bug + ux / S2-medium
**Surfaces:** business-iOS, business-Android (`mingla-business`); business-web preview (parity, automatic).
**Branch / worktree:** `ORCH-1335-rsvp-chip-in-bank-banner` @ `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1335-[rsvp-chip-in-bank-banner]/` (rebased on origin/main `f2eb308be`).
**Root cause (proven cold by orchestrator, confirmed here):** `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx:300-309` renders the amber "Connect your bank to collect contributions" nudge UNCONDITIONALLY whenever the "Let guests chip in" toggle is on. It is static copy that reads no payout-readiness signal, so an already-connected brand still sees a warning telling it to connect a bank it already connected (false-negative).

**Locked product decision (Seth):** when the brand is ALREADY payout-ready, the callout SWAPS to a positive confirmation (not hidden). When NOT ready (or unknown/loading), it keeps today's exact nudge.

**Hard guards — do NOT touch:** `pg_brand_can_collect` or any publish/edit RPC (the hard gate stays exactly as-is); the consumer/buyer `RsvpChipInPanel`; the money fields, toggle behavior, or publish flow. Do NOT redesign the step. Mirror the server's provider-aware readiness — do not invent a new definition.

---

## 1. The readiness predicate (provider-aware, exact — mirrors `pg_brand_can_collect`)

Server truth (do not change), from `supabase/migrations/20261220000000_orch_1291_rsvp_contributions.sql:195-208`:

```
pg_brand_can_collect(brand) := pg_brand_can_charge(brand)                       -- Stripe rail
                            OR EXISTS(brands WHERE paystack_subaccount_code IS NOT NULL)  -- Paystack rail
```
and `pg_brand_can_charge` (`supabase/migrations/20260927000000_orch_1116_booking_gate_rls.sql:72-88`) = a `stripe_connect_accounts` row exists with `detached_at IS NULL AND stripe_account_id IS NOT NULL AND charges_enabled IS DISTINCT FROM false`.

**Frontend mirror (locked to the client signals the task prescribes):**
- **Stripe rail ready ⇔ `stripeStatus === "active"`.** `deriveBrandStripeStatus` (`src/utils/deriveBrandStripeStatus.ts:46-60`) returns `"active"` only when `has_account && detached_at == null && no disabled_reason && charges_enabled === true`. This is STRICTER than the server's `charges_enabled IS DISTINCT FROM false` (which also allows `null`), so it can only produce a false-NEGATIVE relative to the server — SAFE (a false-positive is worse than today's false-negative). It also matches how the whole app already treats "connected" (`"active"`).
- **Paystack rail ready ⇔ `paymentProvider === "paystack"` AND `paystackSubaccountCode` present.** These map byte-for-byte from `brands.payment_provider` / `brands.paystack_subaccount_code` (`src/services/brandMapping.ts:292-294`: `paymentProvider: row.payment_provider ?? "stripe"`, `paystackSubaccountCode: row.paystack_subaccount_code ?? undefined`). This is exactly the column the server gate reads — no divergence from the hard gate is possible.

Exact `Brand` field paths (`src/types/brand.ts`): `stripeStatus?: BrandStripeStatus` (line 223, `"not_connected"|"onboarding"|"active"|"restricted"`), `paymentProvider?: "stripe"|"paystack"` (line 230), `paystackSubaccountCode?: string` (line 234).

### 1.1 New pure util — `mingla-business/src/utils/chipInPayoutReadiness.ts` (NEW FILE, no JSX)

```ts
/**
 * ORCH-1335 — provider-aware chip-in payout readiness.
 * TS mirror of pg_brand_can_collect (Stripe active OR Paystack subaccount).
 * Positive readiness NEVER derives from the stale brands.stripe_* cache: the
 * Stripe rail requires the FRESH `useBrandStripeStatus` hook status === "active".
 * Undefined/loading status → NOT ready (no false-positive).
 */
import type { Brand, BrandStripeStatus } from "../types/brand";

export function isChipInPayoutReady(
  brand: Pick<Brand, "paymentProvider" | "paystackSubaccountCode"> | null | undefined,
  freshStripeStatus: BrandStripeStatus | null | undefined,
): boolean {
  if (brand == null) return false;
  // Paystack (NGN) rail: mirror `paystack_subaccount_code IS NOT NULL`.
  if (brand.paymentProvider === "paystack") {
    return (
      typeof brand.paystackSubaccountCode === "string" &&
      brand.paystackSubaccountCode.trim().length > 0
    );
  }
  // Stripe rail (default provider): require FRESH confirmed active.
  return freshStripeStatus === "active";
}
```

> `BrandStripeStatus` and `Brand` both export from `src/types/brand.ts`. The util has NO React/JSX so it runs under the default `jest.config.cjs` (ts-jest/node) with no overlay.

---

## 2. Freshness — compute in the WIZARD (and edit-published), refresh via `useBrandStripeStatus`

**Where computed:** at the wizard/screen level (which holds `brand`), ONCE, then threaded to the step. **Never** in `RsvpStep5Setup` itself (it must stay a dumb prop consumer — it has no `brand`, and this keeps create + edit-published sourcing identical).

**Fresh Stripe source:** `useBrandStripeStatus(brandId)` (`src/hooks/useBrandStripeStatus.ts`) returns `UseQueryResult<RefreshStatusResult>`; `RefreshStatusResult.status: BrandStripeStatus` (`src/services/brandStripeService.ts:32-42`) is the server-derived status from `brand-stripe-refresh-status` reading the live `stripe_connect_accounts` row (Realtime-invalidated on `account.updated`, 30 s poll). Consume `query.data?.status`.
- **Loading / undefined:** while the query is resolving, `data` is `undefined` → `data?.status` is `undefined` → `isChipInPayoutReady(...)` returns `false` → the neutral nudge renders. This is the anti-false-positive guarantee: the positive can NEVER appear until the fresh hook confirms `"active"`.
- **Paystack:** no async — read from `brand` cache (same column the server gate reads; a stale value would stale the hard gate identically, so banner and gate stay consistent).

### 2.1 Create wizard — `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx`
- Add imports (near lines 49-61): `import { useBrandStripeStatus } from "../../hooks/useBrandStripeStatus";` and `import { isChipInPayoutReady } from "../../utils/chipInPayoutReadiness";`.
- In the component body (after `brand` is in scope; `useMemo` is already imported, line 15), add:
```ts
// ORCH-1335 — provider-aware chip-in payout readiness (mirrors pg_brand_can_collect).
// Fresh Stripe truth via the hook; Paystack via the brand subaccount; loading → false.
const chipInStripeStatus = useBrandStripeStatus(brand?.id ?? null);
const chipInPayoutReady = useMemo(
  () => isChipInPayoutReady(brand, chipInStripeStatus.data?.status),
  [brand, chipInStripeStatus.data?.status],
);
```
- In `baseProps` (lines 567-578, `renderStepBody`), add `chipInPayoutReady,`. It flows through the `{...baseProps}` spread to `RsvpStep5Setup` at line 590 (other steps ignore the extra optional prop).

### 2.2 Edit-published parity — `mingla-business/src/components/event/EditPublishedScreen.tsx` (§4)

---

## 3. The three visual states of the callout (`RsvpStep5Setup.tsx`)

`RsvpStep5Setup` renders the contribution cluster at lines 269-312; the target callout is lines 300-309. The component signature (line 159) currently destructures `{ draft, updateDraft, brandDefaultCurrency }` — add `chipInPayoutReady`.

**Rendering rule (inside the existing `contributionOn ? (…) : null` block, replacing lines 300-309):**

```tsx
{chipInPayoutReady ? (
  /* READY — positive confirmation (ORCH-1335). */
  <View style={styles.readyCallout} testID="rsvp-contribution-ready-callout">
    <View style={styles.readyHeadingRow}>
      <Icon name="check" size={16} color={semantic.success} />
      <Text style={styles.readyHeading}>Payouts are on</Text>
    </View>
    <Text style={styles.readySub}>
      Guests can chip in the moment you publish — no extra setup needed.
    </Text>
  </View>
) : (
  /* NOT READY / UNKNOWN — today's neutral nudge, copy UNCHANGED. */
  <View style={styles.connectCallout} testID="rsvp-contribution-connect-callout">
    <Text style={styles.connectHeading}>Connect your bank to collect contributions</Text>
    <Text style={styles.connectSub}>
      Guests can chip in once your payouts are set up. If your bank isn't connected yet,
      you'll be prompted to finish setup when you publish.
    </Text>
  </View>
)}
```

- **(a) NOT ready** (`chipInPayoutReady === false`) → the current nudge, EXACT copy + `styles.connectCallout` (amber) unchanged. testID `rsvp-contribution-connect-callout` kept.
- **(b) READY** (`chipInPayoutReady === true`) → positive confirmation. **Copy (locked):** heading `Payouts are on`; sub `Guests can chip in the moment you publish — no extra setup needed.` Reassuring, present-tense-true ("Payouts are on"), scopes chip-in to "the moment you publish" (no promise of money before publish). testID `rsvp-contribution-ready-callout`.
- **(c) UNKNOWN / loading** (`chipInPayoutReady` undefined or false while the hook resolves) → **renders the NEUTRAL nudge** (falls into the `: (…)` branch). **Justification for nudge-over-nothing:** (1) it can never flash a false positive — the cardinal rule; a false "Payouts are on" is worse than a spurious nudge; (2) it is today's exact behavior, so zero regression risk for the unconnected majority who actually need the nudge; (3) the nudge copy is soft ("If your bank isn't connected yet…"), so a connected brand seeing it for ~one network round-trip is harmless and self-corrects to positive; (4) no layout pop-in (nothing→something). The positive NEVER renders before confirmation.

### 3.1 Imports + styles (`RsvpStep5Setup.tsx`)
- Import edit (lines 19-26): add `semantic,` to the `designSystem` import (between `radius as radiusTokens,` and `spacing,`).
- Add `import { Icon } from "../ui/Icon";` (Icon lives at `src/components/ui/Icon.tsx`; the `check` icon exists — `Icon.tsx:131` `check: () => <Path d="M5 13l4 4L19 7" />`; props `name`/`size`/`color` per `IconProps` lines 99-107).
- Add to the `StyleSheet.create` block (after `connectSub`, line 441). Mirrors the amber `connectCallout` (lines 422-441) with the kit's green success tokens:
```ts
readyCallout: {
  padding: spacing.md,
  borderRadius: radiusTokens.lg,
  overflow: "hidden",
  marginTop: spacing.sm,
  backgroundColor: semantic.successTint,     // rgba(34, 197, 94, 0.18) — designSystem token
  borderWidth: 1,
  borderColor: "rgba(34, 197, 94, 0.45)",    // mirrors connectCallout's amber 0.45 border-alpha convention
},
readyHeadingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
readyHeading: {
  fontSize: typography.bodySm.fontSize,
  fontWeight: "600",
  color: textTokens.primary,
},
readySub: {
  fontSize: typography.caption.fontSize,
  lineHeight: typography.caption.lineHeight * 1.35,
  color: textTokens.secondary,
  marginTop: spacing.xxs,
},
```

**Tokens (concrete):** `semantic.success = "#22c55e"`, `semantic.successTint = "rgba(34, 197, 94, 0.18)"` (`src/constants/designSystem.ts:298-300`); `text.primary = "rgba(255,255,255,0.96)"`, `text.secondary = "rgba(255,255,255,0.72)"` (lines 310-311); the callout sits on `canvas.discover = "#0c0e12"` (line, near 295). No new raw hex beyond the kit's existing convention (the border-alpha rgba mirrors the shipped `connectCallout`).

**AA / accessibility:** I-38 (IconChrome ≥44×44) and I-39 (interactive Pressable needs `accessibilityLabel`) — `INVARIANT_REGISTRY.md:4109/4129` — do NOT apply: the callout is a static `View`/`Text` (not a `Pressable`/`IconChrome`), and the `check` icon is decorative (its meaning is carried by the adjacent "Payouts are on" text). Text contrast: `text.primary` (0.96) and `text.secondary` (0.72) white over `successTint` (0.18) composited on `#0c0e12` ≈ white-on-near-black → ≥ 12:1 (well above AA 4.5:1) — proven by parity with the already-shipped amber nudge which uses the identical text tokens over an identical-alpha tint. The `#22c55e` icon on `#0c0e12` ≈ 6:1 (above AA graphical 3:1). No AA regression.

---

## 4. Edit-published parity (SHARED body)

`RsvpStep5Setup` is reused by the edit-published RSVP flow: `EditPublishedScreen.tsx:1325` renders `<RsvpStep5Setup {...stepBodyProps} />` for the `"rsvp-setup"` section (mounted only when `rsvpMode`, `editPublishedSections.ts:23`). The edit path DOES have a live bank-gate too (`EditPublishedScreen.tsx:824` handles the `biz_update_live_rsvp` bank-gate rejection), so the banner MUST be readiness-aware here as well.

**Problem:** `EditPublishedScreen` does NOT currently hold the `Brand` object — it only has `liveEvent.brandId` and calls `useCurrentBrandRole(liveEvent?.brandId ?? null)` (line 377). `stepBodyProps` (lines 1282-1298) supplies `brandDefaultCurrency: liveEvent.currency ?? null` but no `brand`.

**Fix — supply the two readiness signals from the brandId:**
- Add imports: `import { useBrand } from "../../hooks/useBrands";` (single-brand query, `useBrands.ts:316`, returns `Brand | null` with `paymentProvider` + `paystackSubaccountCode`), `import { useBrandStripeStatus } from "../../hooks/useBrandStripeStatus";`, `import { isChipInPayoutReady } from "../../utils/chipInPayoutReadiness";`.
- At component top-level (after line 377), gated to `rsvpMode` so ticketed edits make no extra queries (both hooks accept `null` → disabled; `useMemo` already imported):
```ts
// ORCH-1335 — chip-in payout readiness for the RSVP edit path (same banner as create).
const chipInBrandId = rsvpMode ? (liveEvent?.brandId ?? null) : null;
const chipInBrandQuery = useBrand(chipInBrandId);
const chipInStripeStatus = useBrandStripeStatus(chipInBrandId);
const chipInPayoutReady = useMemo(
  () => isChipInPayoutReady(chipInBrandQuery.data ?? null, chipInStripeStatus.data?.status),
  [chipInBrandQuery.data, chipInStripeStatus.data?.status],
);
```
- In `stepBodyProps` (lines 1282-1298), add `chipInPayoutReady,`. It flows to `RsvpStep5Setup` via the spread at line 1325 (other sections ignore the extra optional prop).

Both paths now supply an identically-computed signal via the same `isChipInPayoutReady` util (create: `brand` prop; edit: `useBrand(brandId)`), each with the fresh Stripe hook. Symmetric.

---

## 5. Regression test plan (Step-0.5 CLOSE gate)

RTL (`@testing-library/react-native`) is NOT in the default install — it lives in the gitignored `.orch1118-testdeps/` overlay and runs only under per-ORCH render configs (`jest.config.cjs:11-38` ignore-lists each render test). So the **CI-enforced** CLOSE gate is the pure-logic pair (runs under default `jest.config.cjs`); the RTL render test is the runtime proof under a worktree-local config.

### 5.a Implementor — CI-enforced fails-on-revert (default `jest.config.cjs`)
**File 1 — predicate permutations:** `mingla-business/src/utils/__tests__/chipInPayoutReadiness.test.ts`
- `isChipInPayoutReady({ paymentProvider: "stripe" }, "active")` → `true`
- `…("stripe", "onboarding" | "restricted" | "not_connected")` → `false` (each)
- `…("stripe", undefined)` (loading) → `false` — no false-positive while resolving
- `…({ paymentProvider: undefined }, "active")` → `true` (default rail is Stripe)
- `…({ paymentProvider: "paystack", paystackSubaccountCode: "ACCT_x" }, "not_connected")` → `true`
- `…({ paymentProvider: "paystack", paystackSubaccountCode: undefined | "" | "  " }, "active")` → `false` — Paystack rail ignores Stripe status; blank subaccount = not ready
- `…(null, "active")` → `false`
Fails-on-revert: weakening the predicate to always-true, dropping the Paystack branch, or trusting cache instead of the passed fresh status flips these.

**File 2 — banner-swap source-structure guard (invariant enforcement):** `mingla-business/src/components/rsvp/__tests__/RsvpStep5Setup.chipInBanner.test.ts` (reads source via `fs.readFileSync` — the repo pattern used by `EditPublishedScreen.coverPersistence.test.tsx`). Asserts on `RsvpStep5Setup.tsx` source:
- contains the nudge heading `Connect your bank to collect contributions` AND `testID="rsvp-contribution-connect-callout"`;
- contains the positive heading `Payouts are on` AND `testID="rsvp-contribution-ready-callout"`;
- references `chipInPayoutReady` in a conditional gating the callouts (assert the substring `chipInPayoutReady ?` is present — the callout is NOT unconditional).
Fails-on-revert: hardcoding the nudge / deleting the prop removes `chipInPayoutReady` + the positive testID/copy → assertions fail. Runs in CI (a `.test.ts`, no RTL).

**File 3 (happy-path RTL render) — implementor authors the connected/unconnected cases; see 5.b for the shared file + config.**

### 5.b Tester — adversarial (different axis) + RTL runtime proof
**RTL render file:** `mingla-business/src/components/rsvp/__tests__/RsvpStep5Setup.orch1335.render.test.tsx` + worktree-local config `mingla-business/jest.orch1335.render.cjs` (clone `jest.orch1143.render.cjs`: RN preset + `.orch1118-testdeps` RTL overlay; `testMatch` → this file). **Append** the filename to `jest.config.cjs` `testPathIgnorePatterns` (one additive line, mirroring the existing entries) so it does not run under the default node/ts-jest config. Mock `../ui/Icon` to emit `testID={`icon-${name}`}` (repo pattern). Render `RsvpStep5Setup` with a draft where `rsvpContributionEnabled: true` (so the callout mounts) + `brandDefaultCurrency: "USD"`:
- **(happy, implementor)** `chipInPayoutReady={true}` → `getByText("Payouts are on")` present; `queryByText("Connect your bank to collect contributions")` is `null`; `queryByTestId("rsvp-contribution-connect-callout")` is `null`.
- **(happy, implementor)** `chipInPayoutReady={false}` → nudge present; `queryByTestId("rsvp-contribution-ready-callout")` is `null`.
- **(adversarial, tester — loading/stale-cache race)** `chipInPayoutReady={undefined}` (prop omitted, i.e. hook still resolving) → nudge present, positive callout ABSENT — proves no false-positive flash while readiness is unresolved.

**Adversarial predicate axis (tester, extends File 1 or a sibling `.tester.test.ts`):** attacks the readiness SOURCE (different axis from the render swap):
- Paystack with `paystackSubaccountCode` null/empty while Stripe status is `"active"` → still `false` (Paystack rail must not borrow Stripe readiness) → nudge.
- Stripe `"onboarding"` and `"restricted"` → `false` → nudge, NOT confirmation (a restricted/onboarding brand must never see "Payouts are on").
- Stale-cache: passing a stale-`active` cached `brand.stripeStatus` is impossible to reach the positive because the predicate only reads the FRESH `freshStripeStatus` argument — assert the util never consults a brand-level Stripe status field.

Fails-on-revert: the RTL swap test fails at runtime if the component ignores the prop; the adversarial predicate cases fail if the OR logic is weakened.

**Runtime note:** business-web preview parity is automatic (same component tree via react-native-web); per memory, authed biz-web runtime is not drivable in QA, so the web claim is capped at source + native-sim render proof.

---

## 6. DRAFT invariant (pre-staged — flips ACTIVE at CLOSE)

Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` at IMPLEMENT (DRAFT), flip ACTIVE at CLOSE:

### I-PROPOSED-1335-CHIP-IN-BANK-BANNER-PAYOUT-AWARE (DRAFT — flips ACTIVE at ORCH-1335 CLOSE)
- **Rule:** In `mingla-business`, `RsvpStep5Setup` (the RSVP chip-in authoring step, shared by the create wizard AND the edit-published RSVP flow) MUST NOT render the "Connect your bank to collect contributions" nudge unconditionally. When contributions are enabled it renders exactly ONE of two callouts, selected by the `chipInPayoutReady` prop: `false`/`undefined` → the neutral connect nudge (`testID="rsvp-contribution-connect-callout"`, copy unchanged); `true` → the positive "Payouts are on" confirmation (`testID="rsvp-contribution-ready-callout"`). `chipInPayoutReady` is computed ONLY via `isChipInPayoutReady(brand, freshStripeStatus)` — provider-aware: Stripe `status === "active"` from the FRESH `useBrandStripeStatus` hook, OR Paystack `paystackSubaccountCode` present — mirroring `pg_brand_can_collect`. It MUST NEVER derive the positive state from the stale `brands.stripe_*` cache and MUST default to the nudge while readiness is unresolved (no false-positive). The publish/edit hard gate (`pg_brand_can_collect`) is untouched.
- **Enforcement:** append-only CI pair under the default `jest.config.cjs`: `src/utils/__tests__/chipInPayoutReadiness.test.ts` (predicate permutations) + `src/components/rsvp/__tests__/RsvpStep5Setup.chipInBanner.test.ts` (source-structure: both callout copies + testIDs + the `chipInPayoutReady`-gated conditional present, nudge not unconditional). Optional strict-grep `.github/scripts/strict-grep/orch-1335-chip-in-bank-banner-payout-aware.mjs` (requires `chipInPayoutReady` + both testIDs in `RsvpStep5Setup.tsx`, bans an unconditional connect-callout). RTL runtime proof: `RsvpStep5Setup.orch1335.render.test.tsx` under `jest.orch1335.render.cjs`.
- **Fails-on-revert:** hardcoding the nudge / dropping the prop removes `chipInPayoutReady` + the positive testID/copy → the source-structure test fails; weakening the predicate to always-true or dropping the Paystack / fresh-Stripe rules fails the predicate permutations; the RTL swap test fails at runtime.
- **Established:** DRAFT 2026-07-10 at ORCH-1335 SPEC (flips ACTIVE at CLOSE).

---

## 7. File-change manifest (implementor — one pass)

| File | Change |
|---|---|
| `mingla-business/src/utils/chipInPayoutReadiness.ts` | **NEW** — `isChipInPayoutReady(brand, freshStripeStatus)` (§1.1). |
| `mingla-business/src/components/event/types.ts` | Add `chipInPayoutReady?: boolean;` to `StepBodyProps` (after line 80; documented as RSVP-chip-in-only, safe-ignored by other steps). |
| `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx` | Import `semantic` + `Icon` (§3.1); destructure `chipInPayoutReady` (line 159); replace lines 300-309 with the ternary swap (§3); add 4 styles after line 441 (§3.1). |
| `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx` | Import `useBrandStripeStatus` + `isChipInPayoutReady`; add hook + `useMemo` (§2.1); add `chipInPayoutReady` to `baseProps` (lines 567-578). |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | Import `useBrand` + `useBrandStripeStatus` + `isChipInPayoutReady`; add rsvpMode-gated hooks + `useMemo` after line 377 (§4); add `chipInPayoutReady` to `stepBodyProps` (lines 1282-1298). |
| `mingla-business/src/utils/__tests__/chipInPayoutReadiness.test.ts` | **NEW** — predicate permutations (§5.a File 1). |
| `mingla-business/src/components/rsvp/__tests__/RsvpStep5Setup.chipInBanner.test.ts` | **NEW** — source-structure banner-swap guard (§5.a File 2). |
| `mingla-business/src/components/rsvp/__tests__/RsvpStep5Setup.orch1335.render.test.tsx` | **NEW** — RTL swap proof (§5.b). |
| `mingla-business/jest.orch1335.render.cjs` | **NEW** — worktree-local render config (clone `jest.orch1143.render.cjs`). |
| `mingla-business/jest.config.cjs` | APPEND `RsvpStep5Setup\\.orch1335\\.render\\.test\\.tsx$` to `testPathIgnorePatterns` (one additive line). |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Add DRAFT invariant (§6) at IMPLEMENT. |

**Gates before CLOSE:** `npx tsc --noEmit` (business) green; `npx jest chipInPayoutReadiness.test RsvpStep5Setup.chipInBanner.test` green; `npx jest --config jest.orch1335.render.cjs --runInBand` green; prove fails-on-revert (git stash the RsvpStep5Setup + predicate edits → source-structure + predicate + render tests fail). Do NOT touch `pg_brand_can_collect` / publish RPCs / `RsvpChipInPanel`.
