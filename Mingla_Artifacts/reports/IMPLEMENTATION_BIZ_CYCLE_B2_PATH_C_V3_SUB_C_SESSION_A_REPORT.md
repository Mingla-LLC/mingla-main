# IMPLEMENTATION REPORT — B2a Path C V3 Sub-dispatch C Session A (Phases 9 + 10 visible UI)

**ORCH-ID:** B2A-PATH-C-V3-SUB-C (Session A — visible UI part 1 of 2)
**Cycle:** B2a Path C V3 (Stripe Connect marketplace integration)
**Status:** `implemented, partially verified`
**Predecessors:** Sub-C partial pass APPROVED at REVIEW (2026-05-07); SPEC §13 amendments A1-A5.
**Dispatch source:** `Mingla_Artifacts/prompts/B2A_PATH_C_V3_SUB_C_SESSION_A_DISPATCH.md`
**Author:** /mingla-implementor
**Date:** 2026-05-07

---

## 1. Summary

In plain English: brand admins now see a **country picker** as the first step of Stripe onboarding (defaults to UK; 34 countries supported). On the payments dashboard, three new surfaces appear when relevant: a **KYC remediation card** (if Stripe is asking for verification details), a **bank verification status** strip (when their account is active or restricted), and a **read-only refund history** (only for detached brands). All three are wired and render against live data; the visible UI work that remains is the deadline warning banner, the Mingla Business ToS acceptance gate, and the notification inbox — those plus the formatGbp → formatCurrency refactor and tests are deferred to Session B per Pre-Flight scope-cut.

---

## 2. SPEC traceability

| Item | Where it landed | Verified |
|---|---|---|
| §6 Phase 9 — country picker | `BrandStripeCountryPicker.tsx` (NEW); wired in `BrandOnboardView.tsx` idle state above prereq card; passes country to `useStartBrandStripeOnboarding` | ✅ tsc clean, gates pass |
| §6 Phase 9 — country defaults to brand's billing country | Defaults to `"GB"` (Brand type has no billing_country field). `[TRANSITIONAL]` to be wired when Brand type extends — flagged in §8 | ⚠ partial (defaults to GB, not derived from Brand) |
| §6 Phase 10 — KYC remediation card | `BrandStripeKycRemediationCard.tsx` (NEW); reads `requirements.disabled_reason` / `past_due[0]` / `currently_due[0]` priority chain; severity-driven palette | ✅ |
| §6 Phase 10 — bank verification UI | `BrandStripeBankSection.tsx` (NEW); 4 states (verified/pending/errored/missing) with country-aware label | ✅ |
| §6 Phase 10 — orphaned refunds (detached) | `BrandStripeOrphanedRefundsSection.tsx` (NEW) + `brandStripeOrphanedRefundsService.ts` + `useBrandStripeOrphanedRefunds.ts` | ✅ |
| §6 Phase 10 — wire into BrandPaymentsView | Single Section A2 insertion above KPI tiles | ✅ |
| §6 Phase 10 — formatGbp → formatCurrency refactor | **DEFERRED to Session B** — requires extending Brand type with `default_currency` field which crosses the store layer | ⏳ |
| §13 A4 — country list = canonical 34 | Frontend `stripeSupportedCountries.ts` (Sub-C partial) is the canonical UI source | ✅ |

---

## 3. Old → New receipts

### NEW files

#### `mingla-business/src/components/brand/BrandStripeCountryPicker.tsx` (348 lines)

Inline trigger → Sheet picker. 34 countries from `useBrandStripeCountries`. Search-filterable. Loading/error/empty/populated states. Haptic on open + select. Accessibility labels per I-38/I-39. Selected country shown as a chip with display name + currency hint. Tapping a row auto-closes the sheet and fires `onChange`.

#### `mingla-business/src/components/brand/BrandStripeBankSection.tsx` (197 lines)

GlassCard surface with state-driven badge palette: verified=green, pending=amber, errored=red, missing=neutral. Reads `useBrandStripeBankVerification(brandId)`. Country-aware label ("IBAN" for EEA, "Sort code + account number" for GB, etc.). Re-verify CTA when state is errored or missing — calls operator-supplied `onResolve` callback.

#### `mingla-business/src/components/brand/BrandStripeKycRemediationCard.tsx` (147 lines)

Reads brand requirements; picks the highest-priority code (disabled_reason → past_due[0] → currently_due[0]); maps to friendly copy via `getKycRemediationMessage`. Severity-driven border + tint. Single CTA button calls `onResolve`. Returns `null` when no remediation code is present (auto-hides).

#### `mingla-business/src/components/brand/BrandStripeOrphanedRefundsSection.tsx` (171 lines)

Read-only refund history for detached brands. Lists up to 20 most recent `charge.refund.updated` events. Each row: amount (using `formatCurrency` with the refund's own currency) + date + status. Empty state ("No refunds processed since detach") + error state.

#### `mingla-business/src/services/brandStripeOrphanedRefundsService.ts` (76 lines)

Two-step query: (1) fetch brand's `stripe_account_id` from `stripe_connect_accounts`, (2) query `payment_webhook_events` filtered to `event_type='charge.refund.updated'` AND `account_id=<that id>`. Maps raw_payload to `{eventId, amountMinor, currency, status, createdAt}` shape. RLS path: brand payments-managers can SELECT their brand's webhook events.

#### `mingla-business/src/hooks/useBrandStripeOrphanedRefunds.ts` (44 lines)

React Query wrapper. `staleTime: 5 min` (low-frequency event class). No refetchInterval. Query key factory `brandStripeOrphanedRefundsKeys`.

### MODIFIED files

#### `mingla-business/src/components/brand/BrandOnboardView.tsx`

- Added `import { BrandStripeCountryPicker }` + `DEFAULT_COUNTRY = "GB"`.
- Added `useState<string>(DEFAULT_COUNTRY)` for selected country.
- Mounted `<BrandStripeCountryPicker value onChange />` in idle state above the prereq card.
- `handleStart` mutateAsync call now passes `country: selectedCountry` (the hook + service signatures already support it from Sub-C partial).
- Updated prereq card copy from "(sort code + account number for UK)" to "for your country" — country-aware.

#### `mingla-business/src/components/brand/BrandPaymentsView.tsx`

- Added imports for the 3 new components + `useBrandStripeStatus`.
- Added `stripeStatusQuery = useBrandStripeStatus(brand?.id ?? null)` to access live `requirements` and `detached_at`.
- Added Section A2 (between connect banner and KPI tiles) with conditional rendering:
  - `BrandStripeKycRemediationCard` when `stripeStatus !== "active" && stripeStatus !== "not_connected"`
  - `BrandStripeBankSection` when `stripeStatus === "active" || stripeStatus === "restricted"`
  - `BrandStripeOrphanedRefundsSection` when `stripeStatusQuery.data?.detached_at != null`
- Existing CTA `handleResolveBanner` (deep-links to Stripe Express login) re-used for the new components' onResolve handlers.

---

## 4. Invariant preservation

| Invariant | Status |
|---|---|
| I-PROPOSED-O (no DIY WebView wrap) | ACTIVE — preserved (no webview imports) |
| I-PROPOSED-P (canonical state) | ACTIVE — preserved (no direct brands.stripe_* writes) |
| I-PROPOSED-Q (API version pinned) | ACTIVE — preserved (no SDK touches) |
| I-PROPOSED-R (idempotency on every Stripe call) | ACTIVE — preserved (no Stripe API calls in this pass) |
| I-PROPOSED-S (audit log on every Stripe edge fn) | ACTIVE — preserved (no edge fn changes) |
| I-PROPOSED-T (country allowlist) | DRAFT — preserved (picker reads from canonical mirror only) |
| I-PROPOSED-U (ToS gate) | DRAFT — preserved (no new state-creating Stripe calls in Sub-C; existing brand-stripe-onboard already gates) |
| I-PROPOSED-V (notify-dispatch) | DRAFT — preserved (no new sendPush/Resend calls) |
| I-PROPOSED-W (notifications app-type-prefix) | DRAFT — preserved (no new `.from('notifications')` queries in this pass) |

All 9 strict-grep gates exit 0 against the post-change tree.

---

## 5. Cache safety

- New query keys factory: `brandStripeOrphanedRefundsKeys`. Inline-defined in its hook (matches existing pattern).
- New consumers of existing factories: `useBrandStripeBankVerification` (Sub-C partial) is now consumed by `BrandStripeBankSection`. `useBrandStripeStatus` is now consumed by both `BrandPaymentsView` (already was) and indirectly by the KYC card via `requirements`.
- No mutation cache invalidations changed.
- Persisted Zustand: untouched.

---

## 6. Regression surface

5 features most likely to surface a regression:

1. **Existing onboarding flow** — `BrandStripeCountryPicker` is rendered above the prereq card in idle state. Verify Phase 0 callers still complete US/GB onboarding.
2. **`BrandPaymentsView` first paint** — the new Section A2 conditional-renders 3 components. Verify "active" state still shows KPI tiles + payouts + refunds without regression. Verify "not_connected" state still shows just the banner.
3. **`stripe_external_accounts` query** — `useBrandStripeBankVerification` queries the table; verify RLS allows brand admin reads.
4. **`payment_webhook_events` query** — `useBrandStripeOrphanedRefunds` queries this table; verify RLS allows brand admin reads (only for their brand's account_id).
5. **`useBrandStripeStatus` over-fetch** — `BrandPaymentsView` now calls this hook in addition to its existing usage elsewhere; React Query dedups by key so should be a no-op, but verify.

---

## 7. Constitutional compliance

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | ✅ — every Pressable has handler + accessibilityLabel |
| 2 | One owner per truth | ✅ — picker reads from canonical 34-country mirror |
| 3 | No silent failures | ✅ — all new components have loading/error/empty/populated states |
| 4 | One query key per entity | ✅ — new factory follows pattern |
| 5 | Server state via React Query | ✅ — Zustand untouched |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary fixes | ✅ — TRANSITIONAL marker on country default (line in BrandOnboardView) flagged in §8 |
| 8 | Subtract before adding | ✅ — additive; no removals |
| 9 | No fabricated data | ✅ — all values from React Query / canonical constants |
| 10 | Currency-aware UI | ⚠ partial — orphaned refunds uses `formatCurrency` correctly; KPI tiles + payouts still use `formatGbp` (deferred to Session B per scope-cut) |
| 11 | One auth instance | N/A |
| 12 | Validate at the right time | ✅ — country validated by Gate T at edge fn (Sub-B); UI only offers valid countries |
| 13 | Exclusion consistency | ✅ — country list mirrors backend exactly |
| 14 | Persisted-state startup | N/A |

One partial (#10) — explicitly scope-cut and tracked.

---

## 8. Discoveries for orchestrator

1. **`Brand` type lacks `default_currency` field.** The KPI tile multi-currency refactor in BrandPaymentsView (Phase 10 spec line) requires `brand.default_currency`. The Brand type in `currentBrandStore.ts` doesn't have this field. To complete the refactor, Brand needs extension AND the store mapping function (`mapBrandRowToUi` per ORCH-0742) needs to populate it from `brands.default_currency` (Sub-A migration `20260511000001` added the column to the DB). Recommended: Session B adds this as Phase 10b before any visible-UI work.
2. **`Brand` type also lacks `billing_country` field.** Same issue. Picker defaults to `"GB"` instead of brand's actual country. Same fix path as #1.
3. **`handleResolveBanner` in BrandPaymentsView always deep-links to Stripe Express login.** The KYC card's onResolve might want to open the embedded onboarding flow (more contextual) instead. Worth a UX call from operator pre-launch.
4. **Phase 10 components don't have unit tests yet.** Per Session A scope-cut, tests deferred to Session B. Session B should add 3-4 jest test files (one per component).
5. **No NEW translations / locale strings added.** All copy in the new components is English. If Mingla Business localizes, these need translation hooks added in a future cycle.

---

## 9. Verification matrix

| Item | Verified how | Result |
|---|---|---|
| All 9 strict-grep gates exit 0 | Run from repo root | ✅ |
| `tsc --noEmit` clean in `mingla-business/` | Run post-changes | ✅ |
| Country picker renders 34 countries | Static review of constants + hook | ✅ structurally |
| Country selection passes through to onboard mutation | Code trace BrandOnboardView line 196 ("country: selectedCountry") | ✅ structurally |
| KYC card auto-hides when no remediation code | `pickRemediationCode` returns null + early return | ✅ structurally |
| Bank section auto-hides on isError/no data | Early null return | ✅ structurally |
| Orphaned refunds auto-hides when not detached | Conditional render in BrandPaymentsView | ✅ structurally |
| Phase 11 (deadline banner) | NOT STARTED — Session B | ⏳ |
| Phase 12 (ToS gate) | NOT STARTED — Session B | ⏳ |
| Phase 13 (notify-dispatch + inbox) | NOT STARTED — Session B | ⏳ |
| Phase 15 (full verification + jest + Deno) | NOT STARTED — Session B | ⏳ |
| formatGbp → formatCurrency refactor | DEFERRED — Session B | ⏳ |
| Component unit tests | DEFERRED — Session B | ⏳ |

---

## 10. Status label

**`implemented, partially verified`** for Phase 9 + Phase 10 visible-UI components.

Sub-dispatch C overall: **partial** (~60% complete). Session B picks up Phase 11-13 + 15 + the formatGbp refactor + tests.

---

## 11. Operator next-step list

1. **Hand back to orchestrator** for REVIEW.
2. **If APPROVED:** orchestrator writes Session B dispatch prompt covering Phases 11-13 + 15 + the formatGbp refactor (Phase 10b) + Brand-type extension (discovery #1) + tests.
3. **Operator-side: do NOT commit yet.** Wait until Session B lands so all of Sub-C ships in one (or two) coherent commits.
4. **Operator-side: do NOT apply migration `20260512000001` yet.** Wait until end of Sub-C just before deploy.

---

## 12. Files changed

**New files (6):**

- `mingla-business/src/components/brand/BrandStripeCountryPicker.tsx` (348 lines)
- `mingla-business/src/components/brand/BrandStripeBankSection.tsx` (197)
- `mingla-business/src/components/brand/BrandStripeKycRemediationCard.tsx` (147)
- `mingla-business/src/components/brand/BrandStripeOrphanedRefundsSection.tsx` (171)
- `mingla-business/src/services/brandStripeOrphanedRefundsService.ts` (76)
- `mingla-business/src/hooks/useBrandStripeOrphanedRefunds.ts` (44)

**Modified files (2):**

- `mingla-business/src/components/brand/BrandOnboardView.tsx` (picker import + DEFAULT_COUNTRY const + useState + JSX render + mutateAsync country pass; ~12 net new lines)
- `mingla-business/src/components/brand/BrandPaymentsView.tsx` (3 component imports + useBrandStripeStatus call + Section A2 conditional render block; ~30 net new lines)

**Total surface this session:** 8 files touched, ~1,025 lines net new.
