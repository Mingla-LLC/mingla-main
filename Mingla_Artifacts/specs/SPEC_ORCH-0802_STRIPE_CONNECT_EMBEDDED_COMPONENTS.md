# SPEC — ORCH-0802: Stripe Connect Embedded Components routing + Detach UI

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** [INVESTIGATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md](../reports/INVESTIGATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md)
**Operator-selected path:** Option 1 (Status quo + targeted polish), confirmed 2026-05-12.
**Stripe docs verified:** https://docs.stripe.com/connect/supported-embedded-components (2026-05-12)

---

## 1. Scope

ORCH-0802 codifies the architectural decision NOT to migrate to Stripe's RN SDK in this cycle, and closes the small gaps that surfaced during investigation. Three deliverables only:

1. **Promote `I-PROPOSED-O` from DRAFT to ACTIVE** with the explicit routing rule for Stripe Embedded Components: Path B (Mingla-hosted web page) for any GA Web JS component we need; native RN custom UI for surfaces where Stripe has no Embedded Component; native RN SDK Path A is FORBIDDEN until all three RN Preview components reach GA.
2. **Add the missing Detach button + confirmation dialog** on the brand Payments tab. The `useBrandStripeDetach` hook and `brandStripeDetachService` already exist (109 LOC, fully implemented) but have no UI surface invoking them. Brand admins currently cannot detach their Stripe account from the app.
3. **Strict-grep gate** enforcing the I-PROPOSED-O ACTIVE rule.

Wave 4 part 2 of the ORCH-0801 brand-page campaign. Total estimated effort: 1-2 days.

## 2. Non-goals

- **NO migration to Stripe's RN SDK.** Three components in Preview status + 8% replaceable surface area = poor cost/benefit. Re-evaluate when Account Onboarding reaches GA on RN.
- **NO new edge functions.** No `brand-stripe-account-session`. No new Stripe API surface. Account Sessions API stays out of the codebase this cycle.
- **NO changes to ORCH-0804 Tax surface.** The Tax & registrations CTA, the `brand-stripe-tax-dashboard-link` edge function, and the `STRIPE_SECRET_KEY` usage from hotfix PR #85 all stay as-is.
- **NO refactor of existing Path B onboarding.** `app/connect-onboarding.tsx`, `BrandOnboardView.tsx`, `BrandStripeCountryPicker.tsx`, `app/stripe-onboarding-return.tsx` stay as-is.
- **NO changes to BrandSwitcherSheet.** It is brand-entity switching, not Stripe-account switching — explicitly dropped from ORCH-0802 scope per investigation HIDDEN-FLAW-3.
- **NO migration of the refund flow** (`RefundSheet.tsx`) — Stripe's Web-only Payment Details + Disputes components target a different abstraction (payment-level Stripe refunds) than Mingla's `refund-order` RPC (order-level refunds with reverse_transfer).
- **NO changes to KYC remediation card, balance tiles, deadline banner, bank section, orphaned refunds** — all stay custom; RN SDK has no equivalents.

## 3. Assumptions

- The `useBrandStripeDetach` hook + `brandStripeDetachService` are production-grade as written. Investigation did not deep-verify their behavior; SPEC §6 includes a confirmation Phase 0 read to verify before implementor wires them up.
- The `brand-stripe-detach` edge function works as documented in B2a Path C SPEC §6 + DEC-121. ORCH-0802 does not modify it.
- Brand admins (rank ≥ brand_admin per DEC-122 / I-PROPOSED-T) are the appropriate gate for the Detach action. Confirm with operator if a higher rank should be required.

---

## 4. Database layer

**No DB changes.**

---

## 5. Edge function layer

**No edge function changes.** The existing `brand-stripe-detach` (deployed, version current per Mingla-dev) is wired through the existing service.

---

## 6. Service / hook / component layer

### 6.1 Re-read + verify the existing detach surface (implementor Phase 0)

Before writing UI, the implementor MUST read:
- `mingla-business/src/hooks/useBrandStripeDetach.ts` (57 LOC)
- `mingla-business/src/services/brandStripeDetachService.ts` (52 LOC)

Confirm:
- Hook is a `useMutation` with `onSuccess` invalidating `status`, `balances`, `brand` query keys.
- Service throws on edge function error (matches I-PROPOSED-S audit-log discipline).
- The edge function returns `{ success: true }` on local soft-delete even when Stripe rejects the remote `accounts.del` call (so that ownership-of-funds situations don't strand the brand UI in a half-deleted state).

If any of these are NOT true, raise as a finding for the orchestrator and stop. Do not paper over.

### 6.2 New component: `BrandStripeDetachConfirmSheet.tsx`

**Path:** `mingla-business/src/components/brand/BrandStripeDetachConfirmSheet.tsx` (new file)

**Props interface:**
```ts
export interface BrandStripeDetachConfirmSheetProps {
  brandId: string;
  brandName: string;
  visible: boolean;
  onClose: () => void;
  onConfirmed: () => void; // fires after successful detach mutation
}
```

**All states:**
- `idle` — sheet open, confirmation copy visible, "Disconnect Stripe" CTA enabled.
- `submitting` — CTA disabled + spinner, "Disconnecting…" copy.
- `error` — toast surfaces error message (Constitution #3 — no silent failures), sheet stays open, CTA re-enabled.
- `success` — sheet closes via `onConfirmed`, parent invalidates queries.

**Copy (exact strings):**
- Title: "Disconnect Stripe from {brandName}?"
- Body paragraph 1: "Disconnecting stops {brandName} from selling tickets. Existing buyers keep their tickets. Refunds for completed sales remain visible under 'Past refunds.'"
- Body paragraph 2 (warning, amber): "You can reconnect later, but it requires re-onboarding from scratch including KYC verification."
- Confirm CTA: "Disconnect Stripe"
- Cancel CTA: "Keep connected"

**Confirmation gate:** the confirm CTA is enabled only when the brand admin types the brand name verbatim into a `TextInput` above the CTA (defensive UX — pattern lifted from GitHub's "type repo name to delete" + already used for destructive brand-delete in `BrandSwitcherSheet.tsx`).

**Haptics:** `Haptics.notificationAsync(Warning)` on sheet open; `Haptics.notificationAsync(Success)` on success; `Haptics.notificationAsync(Error)` on error.

**Accessibility:**
- Sheet has `accessibilityRole="alertdialog"`.
- Confirm CTA `accessibilityLabel="Disconnect Stripe from {brandName}"`.
- TextInput `accessibilityLabel="Type {brandName} to confirm"`.

**Constitutional compliance:**
- #3 (no silent failures): error toast on mutation failure.
- #9 (no fabricated data): brand name displayed in copy comes from props, not a placeholder.
- #11 (one auth instance): the existing detach mutation uses the existing supabase client; no new auth surface.

### 6.3 Modify `BrandPaymentsView.tsx`

**Path:** `mingla-business/src/components/brand/BrandPaymentsView.tsx`

Add a "Disconnect Stripe" surface at the bottom of the Payments tab, below all the existing sections (KYC card, KPI tiles, Recent Payouts, Recent Refunds, Tax & registrations CTA, Bank section).

**Visibility gate:** rendered only when `stripeStatus === "active"` OR `stripeStatus === "restricted"`. Hidden when `stripeStatus === "not_connected"` (nothing to disconnect) or `stripeStatus === "onboarding"` (would leave brand mid-onboarding without recovery path).

**UI:**
- Section title: "Danger zone" (uses existing `styles.sectionTitle`).
- Subtitle: "Disconnecting stops {brandName} from selling tickets."
- Single `Pressable` styled as a subtle outlined button (NOT a primary CTA color): "Disconnect Stripe".

**Tap handler:** opens the new `BrandStripeDetachConfirmSheet`. On `onConfirmed` callback, do NOT manually navigate — React Query cache invalidation will flip `stripeStatus` to `"not_connected"` and BrandPaymentsView re-renders into the not-connected state automatically.

**Audit log:** the existing edge function emits the audit slug (per B2a Path C). No client-side audit emission.

### 6.4 Auditing the new component

Add `stripe_connect.detach_initiated` to `mingla-business/src/utils/auditActionLabels.ts → KNOWN_STATIC_SLUGS` if not already present. Resolver case returns category `stripe_connect`, icon `bank`. (Implementor: grep `brand-stripe-detach/index.ts` for the actual emitted slug; align the resolver with whatever the edge function emits.)

---

## 7. Success criteria

1. **C-01** — `I-PROPOSED-O STRIPE_EMBEDDED_COMPONENTS_VIA_OFFICIAL_SDK_ONLY` exists in `Mingla_Artifacts/INVARIANT_REGISTRY.md` with status ACTIVE, with the exact routing rule from this SPEC §8.
2. **C-02** — A brand admin viewing the Payments tab while `stripeStatus === "active"` sees a "Disconnect Stripe" button in a "Danger zone" section below all other sections.
3. **C-03** — Tapping "Disconnect Stripe" opens a confirmation sheet that requires typing the brand name verbatim before the confirm CTA enables.
4. **C-04** — On successful detach, the Payments tab re-renders into the "not connected" state without an explicit navigation call.
5. **C-05** — On detach mutation error, an error toast surfaces and the sheet stays open with the confirm CTA re-enabled.
6. **C-06** — Detach button is HIDDEN when `stripeStatus === "not_connected"` or `stripeStatus === "onboarding"`.
7. **C-07** — Audit log captures the detach event with non-`other` category resolution (the edge function already emits; resolver covers it).
8. **C-08** — Strict-grep gate `orch-0802-stripe-embedded-components-routing` PASSES locally with a negative-control smoke that fails when a WebView wrap of `@stripe/connect-js` is introduced.
9. **C-09** — `tsc --noEmit` clean from `mingla-business/`. Jest tests for the new confirmation sheet (idle/submitting/error/success state transitions) all PASS.
10. **C-10** — Zero changes to existing Stripe surfaces (no diff to `BrandOnboardView`, `BrandStripeCountryPicker`, `connect-onboarding.tsx`, `stripe-onboarding-return.tsx`, `BrandStripeKycRemediationCard`, `BrandStripeBankSection`, `BrandStripeDeadlineBanner`, `BrandStripeOrphanedRefundsSection`, `BrandPaymentsView` Tax CTA section, `RefundSheet`, `BrandSwitcherSheet`).

---

## 8. Invariants

### Promoted DRAFT → ACTIVE at this close

**I-PROPOSED-O STRIPE_EMBEDDED_COMPONENTS_VIA_OFFICIAL_SDK_ONLY**

**Rule:** Stripe Connect Embedded Components in Mingla MUST be exposed via one of exactly two routes:

- **Path B (current canonical):** Mingla-hosted web page using Stripe's `@stripe/react-connect-js` (Web JS SDK) opened in the device's system browser via `expo-web-browser.openAuthSessionAsync`. Example: `app/connect-onboarding.tsx`.
- **Path A (held until GA):** Stripe's `@stripe/stripe-react-native` Embedded Components SDK rendered inline in the native app. CURRENTLY FORBIDDEN — all three RN components are Preview status as of 2026-05-12. Re-evaluate at the close of each subsequent quarter; re-enable when Account Onboarding reaches RN-side GA.

**FORBIDDEN regardless of path:** DIY-wrapping `@stripe/connect-js` (the bare Web JS SDK) inside `react-native-webview` or any other in-app WebView container. This pattern silently breaks deep linking, accessibility, audit-log capture, and HTTPS-relay return URLs.

**Why:** As of 2026-05-12, Stripe's RN SDK ships only 3 components (Account Onboarding, Payments, Payouts), all in Preview status. The other 30+ Connect Embedded Components are Web JS only. Path B is the documented Stripe-supported way to use Web JS components from an RN app and is what we already do for onboarding. DIY WebView wraps are a documented anti-pattern that breaks several invariants we care about.

**Enforcement:** Strict-grep gate `orch-0802-stripe-embedded-components-routing` at `.github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs`. Three checks:
1. NO file under `mingla-business/` imports `@stripe/connect-js` (the bare Web JS package) — Path B uses `@stripe/react-connect-js` inside a Mingla-hosted web page, not directly from RN code.
2. NO file under `mingla-business/` imports both `@stripe/stripe-react-native` AND `ConnectComponentsProvider` (the RN SDK Path A marker) — kept disabled until I-PROPOSED-O EXIT condition.
3. The string `WebView` does NOT appear in the same file as `@stripe/connect-js` or `connect.stripe.com` (anti-WebView-wrap guard).

**EXIT condition for the held-on-Path-A clause:** When all three RN SDK Embedded Components reach GA status (Account Onboarding, Payments, Payouts), register a new ORCH cycle to re-evaluate Path A adoption. Update this invariant text and the strict-grep Check 2 at that time.

**Source:** ORCH-0802 SPEC §8 + investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md`.

### Preserved (no impact)

| Invariant | How preserved |
|-----------|--------------|
| I-PROPOSED-BF STRIPE_TAX_ENABLED_ON_CHECKOUT | Tax CTA + edge fn untouched. |
| I-PROPOSED-T STRIPE_COUNTRY_FROM_CANONICAL_ALLOWLIST | Country picker untouched. |
| I-PROPOSED-R STRIPE_IDEMPOTENCY_KEY_ON_EVERY_CALL | No new Stripe API calls in this SPEC. |
| I-PROPOSED-S STRIPE_AUDIT_LOG_ON_EVERY_EDGE_FN | No new edge functions. |
| I-PROPOSED-Q STRIPE_API_VERSION_PINNED | No new Stripe API surface. |
| Constitution #3 (no silent failures) | Error toast on detach mutation failure. |
| Constitution #9 (no fabricated data) | Brand name in confirmation copy is from props. |

---

## 9. Strict-grep CI gate

**New file:** `.github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs`

**Three checks** as documented in §8 invariant Enforcement block.

**Registration:** add a new job in `.github/workflows/strict-grep-mingla-business.yml` directly below `orch-0804-stripe-tax-enabled-on-checkout`. Job name: `orch-0802-stripe-embedded-components-routing`. Display name: `"ORCH-0802: Stripe Embedded Components routing (I-PROPOSED-O)"`.

**Negative control:** introducing `<WebView source={{ uri: 'https://connect.stripe.com/...' }}/>` inside any `mingla-business/` file must fire Check 3 with a named-literal diagnostic. Restoring the file returns gate to PASS.

---

## 10. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Detach button visible when status=active | brand has Stripe active | "Disconnect Stripe" button in Danger zone section | Component |
| T-02 | Detach button hidden when status=not_connected | brand has no Stripe | Danger zone section NOT rendered | Component |
| T-03 | Detach button hidden when status=onboarding | brand mid-onboarding | Danger zone section NOT rendered | Component |
| T-04 | Confirm CTA disabled until brand name typed | sheet open, empty input | CTA disabled | Component |
| T-05 | Confirm CTA enabled when brand name typed exactly | sheet open, input = brandName | CTA enabled | Component |
| T-06 | Confirm CTA stays disabled if input ≠ brandName | sheet open, input = "wrong" | CTA disabled | Component |
| T-07 | Successful detach closes sheet + UI re-renders | confirm tap, edge fn returns success | sheet closes, BrandPaymentsView shows not-connected state | Hook + Component |
| T-08 | Failed detach surfaces error toast | confirm tap, edge fn returns 500 | error toast, sheet stays open, CTA re-enabled | Hook + Component |
| T-09 | Audit log captures detach event | confirm tap, success | edge fn-emitted `stripe_connect.*` slug appears in `brand_audit_logs` with non-other category | Edge fn + Audit |
| T-10 | Strict-grep PASS in clean state | repo at HEAD | gate exits 0 | CI |
| T-11 | Strict-grep negative control (WebView wrap) | introduce WebView+connect.stripe.com in any mingla-business file | Check 3 fires with named diagnostic | CI |
| T-12 | tsc clean | mingla-business/ | EXIT 0 | CI |
| T-13 | Jest BrandStripeDetachConfirmSheet | new test file | covers idle/submitting/error/success transitions | CI |

---

## 11. Implementation order

1. **Phase 0 — Re-read existing detach surface** per §6.1. Confirm hook + service behavior. If unexpected, raise to orchestrator.
2. **Write strict-grep gate** at `.github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs`. Verify with negative-control smoke before any other code change.
3. **Write `BrandStripeDetachConfirmSheet.tsx`** per §6.2. Include jest tests for state transitions.
4. **Modify `BrandPaymentsView.tsx`** per §6.3 — add the Danger zone section + sheet hook-up.
5. **Update `auditActionLabels.ts`** if the detach slug is not already in the resolver.
6. **Promote I-PROPOSED-O DRAFT → ACTIVE** in `Mingla_Artifacts/INVARIANT_REGISTRY.md` using the §8 text exactly.
7. **Register the strict-grep job** in `.github/workflows/strict-grep-mingla-business.yml`.
8. **Local gates:** `npx tsc --noEmit` from `mingla-business/`, `npx jest brandStripeDetach`, run the new strict-grep gate + negative control.
9. **Write implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md` with old→new receipts.

---

## 12. Regression prevention

- **Strict-grep gate** prevents reintroducing the WebView-wrap anti-pattern and prevents accidental Path A adoption while RN components are Preview.
- **Protective comment** at the top of `_shared/stripe.ts` is already in place documenting I-PROPOSED-O DRAFT. Update to reference the ACTIVE status post-close.
- **EXIT condition documented** so a future investigator knows when to revisit Path A adoption (when all 3 RN SDK Embedded Components hit GA).

---

## 13. Hard guards for implementor

- **Stay scoped.** Only the files named in §6 + §9. No other product code changes.
- **No `supabase db push`.** This SPEC has no migrations.
- **No edge function deploys.** This SPEC has no edge function changes.
- **No new Stripe API calls.** This SPEC reuses the existing detach edge function.
- **Do not migrate to RN SDK.** ORCH-0802 explicitly does NOT adopt Path A.
- **Do not touch existing Stripe surfaces** listed in §2 non-goals.
- **Do not flip I-PROPOSED-O to ACTIVE** until all C-01 to C-13 success criteria are verified locally — the operator runs the implementor's final gate.

---

## 14. Expected implementor output

**File:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md`

Standard implementation report. Specifically must include:

- Old→new receipts for `BrandPaymentsView.tsx`, new `BrandStripeDetachConfirmSheet.tsx`, `INVARIANT_REGISTRY.md`, new strict-grep script, workflow yml.
- Per-criterion C-01..C-13 verification table.
- Jest output for the new component tests.
- Strict-grep PASS output with negative-control evidence.
- Confirmation that NO files in the §2 non-goals list were modified.

---

## Confidence

HIGH on:
- Path A is the wrong move today (RN SDK Preview status verified live)
- Detach button is a real missing UX gap (investigation HIDDEN-FLAW-2)
- I-PROPOSED-O is the right invariant to ratify

MEDIUM on:
- Whether the existing detach hook/service actually returns `{ success: true }` consistently (deferred verification to implementor Phase 0)

LOW concerns: none.

---

**End of SPEC.**
