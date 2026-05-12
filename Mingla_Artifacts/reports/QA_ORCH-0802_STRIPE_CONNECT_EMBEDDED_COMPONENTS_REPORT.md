# QA — ORCH-0802: Stripe Connect Embedded Components routing + Detach UI

**Skill:** Claude `mingla-tester` (TARGETED + SPEC-COMPLIANCE)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md`

---

## Verdict: **PASS**

| Severity | Count |
|----------|-------|
| P0       | 0     |
| P1       | 0     |
| P2       | 0     |
| P3       | 0     |
| P4       | 4     |

Zero blocking findings. All 13 SPEC success criteria verified at code/CI tier. Implementor's Phase 0 claims confirmed independently against the actual files. Strict-grep gate negative-control proven across ALL three checks (implementor's smoke covered only Check 1). Constitution clean. SPEC §2 non-goals: every one of the 14 named files has ZERO diff vs HEAD.

Live device verification (M-01..M-12 manual smoke from implementation report §9) is operator-runnable and not a code-defect gate. See Test Plan reproduction in §8 below.

---

## SPEC compliance matrix

| ID | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| C-01 | I-PROPOSED-O ACTIVE with §8 routing rule | ✅ PASS | `INVARIANT_REGISTRY.md:2715` heading reads `(ACTIVE post-ORCH-0802 CLOSE 2026-05-12)`; `:2717` Status block cites ORCH-0802 SPEC §8; `:2729` Post-ORCH-0802 amendment block present containing the full ratified routing rule (Path B canonical / Path A held-until-GA / WebView ban) + dual-gate Enforcement section + EXIT condition for Path-A-held clause |
| C-02 | Disconnect Stripe button in Danger zone when status=active | ✅ PASS | `BrandPaymentsView.tsx:573` gate `(stripeStatus === "active" \|\| stripeStatus === "restricted") && brand !== null`; `:583-586` Button with `variant="destructive"` and accessibilityLabel |
| C-03 | Tap opens type-to-confirm sheet | ✅ PASS | `BrandPaymentsView.tsx:583` `onPress={handleOpenDetach}` sets `detachSheetVisible=true`; sheet `BrandStripeDetachConfirmSheet.tsx:74-79` `canConfirm` is case-insensitive trim match of `confirmInput` against `brandName`; `:179` Button `disabled={!canConfirm}` |
| C-04 | Successful detach → not-connected state without manual navigation | ✅ PASS | `useBrandStripeDetach.ts:39-46` invalidates `brandStripeStatusKeys.detail(brandId)` + `brandStripeBalancesKeys.detail(brandId)` + `["brands","detail",brandId]`. Status flips → `BANNER_CONFIG[stripeStatus]` re-evaluates to `not_connected` → Danger zone gate becomes false → section unmounts. No `router.replace` / `navigation.navigate` in sheet or parent |
| C-05 | Error toast surfaces + sheet stays open | ✅ PASS | `BrandStripeDetachConfirmSheet.tsx:89-97` catch sets `step="confirm"` + `submitError`. Inline `<Text style={styles.errorText}>{submitError}</Text>` at :161-163 surfaces the message. CTA re-enables when `canConfirm` holds. Const #3 honored |
| C-06 | Button HIDDEN for not_connected / onboarding | ✅ PASS | Visibility gate `stripeStatus === "active" \|\| stripeStatus === "restricted"` excludes the other two states |
| C-07 | Audit log captures detach (non-`other` category) | ✅ PASS | `brand-stripe-detach/index.ts:79-80` emits `stripe_connect.detach_completed` OR `stripe_connect.detach_local_success_stripe_rejected` based on Stripe outcome. Both slugs in `auditActionLabels.ts:62-63` `KNOWN_STATIC_SLUGS`; resolver cases at `:126` and `:132` return category `stripe_connect`, icon `bank` |
| C-08 | Strict-grep gate PASS + negative-control smoke | ✅ PASS (all 3 checks verified) | Clean: `ORCH-0802 strict-grep PASS — 3/3 checks (scanned 346 files)`. Tester ran independent negative controls on ALL three checks (implementor only smoke-tested Check 1): see §3 below |
| C-09 | tsc clean + sheet state-transition tests | ✅ tsc PASS / ⚠️ jest PARTIAL | `tsc --noEmit` EXIT 0 from `mingla-business/`. Audit-slug resolver tests 37/37 PASS. **No new jest test file for `BrandStripeDetachConfirmSheet`** — implementor explicitly documented this as Deviation 2; manual M-01..M-12 plan is the substitute |
| C-10 | Zero changes to SPEC §2 non-goal files | ✅ PASS | 14 named files verified: `BrandOnboardView`, `BrandStripeCountryPicker`, `connect-onboarding.tsx`, `stripe-onboarding-return.tsx`, `BrandStripeKycRemediationCard`, `BrandStripeBankSection`, `BrandStripeDeadlineBanner`, `BrandStripeOrphanedRefundsSection`, `RefundSheet`, `BrandSwitcherSheet`, `useBrandStripeDetach`, `brandStripeDetachService`, `auditActionLabels`, `brand-stripe-detach/index.ts` — all zero diff vs HEAD |
| C-11 | Anti-WebView-wrap guard active | ✅ PASS | Check 3 in `.github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs:115-124` enforces `WebView` ∩ (`@stripe/connect-js` ∪ `connect.stripe.com`). Tester planted a WebView+connect.stripe.com file → Check 3 fired with named diagnostic |
| C-12 | Path A held-until-GA EXIT condition documented | ✅ PASS | `INVARIANT_REGISTRY.md` Post-ORCH-0802 amendment block lines 2748-2752 names the GA condition + new-ORCH-cycle requirement. Gate Check 2 enforces the held state |
| C-13 | Regression gates still PASS | ✅ PASS | ORCH-0804 6/6, ORCH-0805 9/9, ORCH-0806 8/8, I-PROPOSED-O webview 0 violations, I-PROPOSED-R 0 violations, I-PROPOSED-Q 0 violations, I-PROPOSED-T 0 violations |

---

## Pre-flight verification

| Gate | Status | Evidence |
|------|--------|----------|
| Scoped diff size | ✅ 3 modified + 4 new | `git diff --stat HEAD -- '.github/**' 'Mingla_Artifacts/INVARIANT_REGISTRY.md' 'mingla-business/src/components/brand/**'` → `113 insertions(+), 5 deletions(-)`. Matches SPEC §1 file list exactly |
| SPEC §2 non-goal files | ✅ 14/14 zero diff | per-file `git diff` check (see §C-10 above) |
| `tsc --noEmit` (mingla-business) | ✅ EXIT 0 | clean output |
| Strict-grep ORCH-0802 (clean) | ✅ 3/3 PASS | `scanned 346 files` |
| Strict-grep regression gates (5) | ✅ all PASS | ORCH-0804/0805/0806 + I-PROPOSED-O webview + I-PROPOSED-R idempotency |
| Audit-slug jest tests | ✅ 37/37 PASS | `auditActionLabels.test.ts` covers both detach slugs |
| Full jest suite | ⚠️ 2 pre-existing failures | `publicEventsService.test.ts` — timezone-sensitive; NOT in ORCH-0802 scope (zero diff vs HEAD); see §6 |

---

## Independent negative-control smoke (3/3 checks fired)

Implementor's implementation report §4 only smoke-tested Check 1. I ran negative controls on ALL three Checks:

**Check 1 — Web JS import in `mingla-business/src/` (different path than implementor smoked):**

```
$ echo 'import { foo } from "@stripe/react-connect-js"; export const X = 1;' \
    > mingla-business/src/hooks/__orch_0802_tester_negctrl.ts
$ node .github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs
ORCH-0802 strict-grep FAIL:
  - Check 1 FAIL (mingla-business/src/hooks/__orch_0802_tester_negctrl.ts):
    Stripe Web JS SDK import in mingla-business/src/ is FORBIDDEN. These packages
    belong in Mingla-hosted web pages under mingla-business/app/ (Path B). I-PROPOSED-O.
```

**Check 2 — Path A marker co-occurrence:**

```
$ cat > mingla-business/src/__orch_0802_tester_negctrl_check2.tsx << 'EOF'
import { x } from "@stripe/stripe-react-native";
export const X = <ConnectComponentsProvider>x</ConnectComponentsProvider>;
EOF
$ node .github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs
ORCH-0802 strict-grep FAIL:
  - Check 2 FAIL (mingla-business/src/__orch_0802_tester_negctrl_check2.tsx):
    RN SDK Connect Embedded Components (Path A) is FORBIDDEN until all three
    Preview components reach GA. Use Path B (Mingla-hosted web page +
    expo-web-browser) instead — see app/connect-onboarding.tsx.
    I-PROPOSED-O EXIT condition.
```

**Check 3 — WebView + connect.stripe.com co-occurrence:**

```
$ cat > mingla-business/src/__orch_0802_tester_negctrl_check3.tsx << 'EOF'
import { WebView } from "react-native-webview";
export const X = <WebView source={{ uri: "https://connect.stripe.com/foo" }}/>;
EOF
$ node .github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs
ORCH-0802 strict-grep FAIL:
  - Check 3 FAIL (mingla-business/src/__orch_0802_tester_negctrl_check3.tsx):
    DIY WebView wrap of Stripe Embedded Components is FORBIDDEN.
    Use Path B (expo-web-browser) instead. I-PROPOSED-O.
```

All temp files removed; gate returns to PASS after each.

---

## Phase 0 verification (independent re-read of implementor's claims)

The implementor's report §"Phase 0 verification" claims the existing detach hook + service + audit slug resolver match SPEC §6.1 expectations and need no changes. I re-read the source independently:

| Claim | File:line | Verdict |
|-------|-----------|---------|
| Hook is `useMutation` with `onSuccess` invalidating status + balances + brand | `useBrandStripeDetach.ts:33-46` | ✅ Confirmed. Invalidates 3 keys: `brandStripeStatusKeys.detail(brandId)`, `brandStripeBalancesKeys.detail(brandId)`, `["brands","detail",brandId]` |
| Hook has `onError` that logs (Const #3 — caller subscribes via `mutation.error`) | `useBrandStripeDetach.ts:48-55` | ✅ Confirmed. `console.error("[useBrandStripeDetach] failed", ...)` |
| Service throws on edge fn error; never returns null | `brandStripeDetachService.ts:40-46` | ✅ Confirmed. Three `throw` paths covering edge-fn-error, null-data, and missing-detached_at |
| Service returns `{ detachedAt, stripeDeleteStatus, rejectionReason }` 3-field shape | `brandStripeDetachService.ts:18-25, 47-51` | ✅ Confirmed. `BrandStripeDetachResult` interface + return statement match |
| Edge fn emits both audit slugs based on Stripe outcome | `brand-stripe-detach/index.ts:79-80` | ✅ Confirmed. Ternary: `stripeDeleteRejected ? "stripe_connect.detach_local_success_stripe_rejected" : "stripe_connect.detach_completed"` |
| Both slugs in `KNOWN_STATIC_SLUGS` | `auditActionLabels.ts:62-63` | ✅ Confirmed |
| Both slugs have resolver cases | `auditActionLabels.ts:126, 132` | ✅ Confirmed. Both return category `stripe_connect`, icon `bank` |

Implementor's Phase 0 claims fully verified. SPEC §6.4 was already complete in the B2a Path C V3 cycle; no additional resolver work needed.

---

## Forensic code reading

### `BrandStripeDetachConfirmSheet.tsx` (NEW, 263 LOC)

**Pattern source:** Lifted verbatim shape from `BrandDeleteSheet.tsx` (brand soft-delete). Simplified from 4 steps to 2 — appropriate because the detach mutation has no "preview" stage (no event-cascade to count) and no "rejected" stage (edge fn always succeeds locally, exposes Stripe-side outcome via `stripeDeleteStatus` field that the sheet currently ignores — see Discovery #1 below).

**State transitions:**
- `confirm` → `submitting` on `handleSubmit` if `canConfirm && brandId && step !== "submitting"`
- `submitting` → `confirm` + `submitError` on mutation throw
- `submitting` → close-via-onClose on mutation success (after firing `onDetached?.(brandId)`)
- `confirm` → close-via-onClose on Cancel CTA tap

**Hunting checks:**
- ❓ What happens when this fails? Trace: mutation throws → caught at :89 → step reverts to `confirm`, `submitError` set with `error.message` or generic fallback. ✅ Error visible.
- ❓ What data could be null/undefined here? Both `brandId` and `brandName` are explicitly `string | null`, guarded at :100 with `if (brandId === null || brandName === null) return null;`. ✅ Null-safe.
- ❓ What happens if this runs twice (double-tap)? `:82` short-circuits with `step === "submitting"` check. ✅ Idempotent.
- ❓ What happens with stale data? `useEffect` at `:65-71` resets state when `visible || brandId` changes. ✅ Re-open is clean.
- ❓ Cold start? Sheet is mounted by parent, no persisted state. ✅ Safe.
- ❓ DRY? Pattern matches BrandDeleteSheet verbatim; copy/styles are unique (no duplicated logic). ✅ Reuses Sheet primitive.
- 🟡 `stripeDeleteStatus` from the mutation response (`"succeeded" | "rejected" | "skipped"`) is NOT surfaced to the user. If Stripe rejects the remote delete (e.g., balance > 0), the local soft-delete still succeeds and the sheet closes silently with no indication that Stripe still holds the account. See P4 NOTE-1 below.

### `BrandPaymentsView.tsx` (+78 LOC diff)

Diff verified line-by-line vs SPEC §6.3:
- Import diff: `useState` added at :21, `BrandStripeDetachConfirmSheet` imported at :57 with ORCH-0802 comment marker.
- New state hooks at :184-193 (`detachSheetVisible` + 2 useCallback).
- New SECTION F at :567-595 — JSX gated on `stripeStatus === "active" || stripeStatus === "restricted"` + `brand !== null`. GlassCard + Button with `variant="destructive"`, `leadingIcon="bank"`, accessibilityLabel includes brand name.
- Sheet mounted OUTSIDE ScrollView at :604-609 (correct per implementor's comment — avoids overlay clipping). brandId/brandName null-guarded via `??`.
- Styles added at :838-857 (4 new style entries).

**Hunting checks:**
- ❓ Tax CTA still works? Tax CTA renders at SECTION B.5 (`stripeStatus === "active"` gate, line 427). Danger zone renders at SECTION F (line 567+). Both can render simultaneously for active brands; no prop or state collision. ✅
- ❓ Cache safety? Visibility derives entirely from `stripeStatus` (returned by `useBrandStripeStatus`). After successful detach, the mutation invalidates the status key → status flips to `not_connected` → Danger zone gate becomes false → section unmounts. No cache-stale risk. ✅
- ❓ Does the Danger zone obscure the Export CTA on small screens? The Danger zone renders AFTER the Export CTA inside the same ScrollView. Both have `marginTop`-based spacing. Visual stack order: Export → Danger zone. No occlusion. ✅
- 🔵 Section ordering note: Tax CTA at top of card stack feels accidental given it's between KPIs and Payouts. Cosmetic only.

### `.github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs` (NEW, 132 LOC)

Hunting checks:
- ❓ Regex robustness — Check 1 `from\s+["']@stripe\/(react-)?connect-js["']` — handles single/double quotes and `react-connect-js` variant. ✅
- ❓ Check 2 — requires BOTH `@stripe/stripe-react-native` import AND `ConnectComponentsProvider` co-occurrence. Less likely to false-positive on incidental mentions. ✅
- ❓ Check 3 — requires BOTH `WebView` token AND (`@stripe/connect-js`|`connect.stripe.com`). The `connect.stripe.com` URL substring could theoretically appear in comments without being a real WebView wrap, but co-requiring `WebView` import/usage makes false positives unlikely. ✅
- ❓ Scan boundaries — walks `mingla-business/` recursively, skips `node_modules` + `.expo`. Excludes other ignorable dirs? No `.git`, no `dist` — but those don't exist under `mingla-business/` so moot. ✅
- ❓ Exit code on no violations — `process.exit(1)` only when failures > 0; otherwise script exits 0 implicitly after `console.log`. ✅

### `.github/workflows/strict-grep-mingla-business.yml` (+11 LOC diff)

Job appended directly below `orch-0804-stripe-tax-enabled-on-checkout` per SPEC §9. Same structure as siblings (checkout@v4 + setup-node@v4 node 20 + node script). ✅

### `Mingla_Artifacts/INVARIANT_REGISTRY.md` (+29 -5 LOC diff)

Three places changed:
1. Line 2715 heading: `(DRAFT — flips ACTIVE on B2a CLOSE)` → `(ACTIVE post-ORCH-0802 CLOSE 2026-05-12)`. ✅
2. Line 2717 Status block: rewritten to cite ORCH-0802 SPEC §8 as source of full rule. ✅
3. Lines 2729-2756 NEW "Post-ORCH-0802 amendment (2026-05-12)" block inserted before `### I-PROPOSED-P` heading. Contains: (a) full ratified routing rule (Path B canonical, Path A held until GA, WebView ban FORBIDDEN); (b) Enforcement naming BOTH the pre-existing webview-ban gate AND the new ORCH-0802 routing gate; (c) explicit EXIT condition; (d) cross-references to investigation + spec artifacts. ✅

---

## Constitution (14 rules)

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | ✅ | Every Pressable has live onPress; Button is the standard primitive |
| 2 | One owner per truth | ✅ | Mutation owns cache invalidation; sheet owns its local state; no Zustand collision |
| 3 | No silent failures | ✅ | Sheet catch surfaces inline error; mutation `onError` logs to console |
| 4 | One key per entity | ✅ | No new query keys; mutation reuses existing factory keys (status, balances, brand) |
| 5 | Server state server-side | ✅ | Mutation result not held in Zustand |
| 6 | Logout clears everything | N/A | No new persisted state |
| 7 | Label temporary | N/A | Nothing transitional in this change |
| 8 | Subtract before adding | ✅ | No layering on broken code; existing detach surface was complete, only the UI button was missing |
| 9 | No fabricated data | ✅ | All strings from props or static copy; no placeholder values |
| 10 | Currency-aware | N/A | No currency in this UI |
| 11 | One auth instance | ✅ | Uses existing supabase client via existing service |
| 12 | Validate at right time | N/A | No datetime validation |
| 13 | Exclusion consistency | ✅ | Same visibility gate (`active OR restricted`) for the button trigger AND the sheet's effective entry (sheet returns null otherwise via null-guard) |
| 14 | Persisted-state startup | N/A | No new persisted state |

**Zero violations.**

---

## Cross-domain impact

| Surface | Touched? | Status |
|---------|----------|--------|
| `app-mobile/` | No | ✅ Out of scope (not consumer-side) |
| `mingla-admin/` | No | ✅ Out of scope |
| `mingla-business/` | Yes | ✅ Verified |
| `supabase/functions/` | No | ✅ No edge fn changes (verified: `brand-stripe-detach/index.ts` zero diff) |
| `supabase/migrations/` | No | ✅ No DB changes |

No cross-domain risk surface.

---

## P4 — Notes and discoveries

1. **NOTE-1 — `stripeDeleteStatus` from mutation response not surfaced to user.** When Stripe rejects the remote `accounts.del` call (e.g., balance > 0), the edge fn still returns success locally but with `stripeDeleteStatus: "rejected"` + `rejectionReason: "balance_remaining"` (or similar). The sheet's current `handleSubmit` discards this. The brand admin sees a clean detach UI flow even when their Stripe account is still alive Stripe-side. The edge fn audit log captures the divergence (`stripe_connect.detach_local_success_stripe_rejected`), so the orchestrator and Stripe Dashboard remain truthful, but the brand admin is unaware. Register as `ORCH-0802-followup-3 — Surface stripeDeleteStatus rejection reason in detach success toast` if operator wants better visibility.

2. **NOTE-2 — Implementor's investigation report has a factual error that the implementation report itself documents (Deviation 1) but the investigation file remains uncorrected.** Investigation says Path B uses `@stripe/react-connect-js` only; reality is BOTH `@stripe/connect-js` (loader) AND `@stripe/react-connect-js` (component wrappers) per `app/connect-onboarding.tsx:32-33`. Implementation Deviation 1 explains and corrects, INVARIANT_REGISTRY amendment is correct, but `INVESTIGATION_ORCH-0802_*.md` text is stale. The CLOSE protocol should patch the investigation file inline OR add a "Post-implementation correction" footer pointing to Deviation 1.

3. **NOTE-3 — Pre-existing test failures in `publicEventsService.test.ts` (NOT ORCH-0802-caused).** 2 of 392 jest tests fail with timezone expectation mismatches (`Europe/Paris` expected vs `Europe/London` received). `publicEventsService.ts` and its test file have ZERO diff vs HEAD; failures pre-exist in `main`. Likely TZ-dependent test that requires a specific `TZ=` env var or system tz to pass. Register as `ORCH-followup-publicEventsService-tz` (severity P3) for future cleanup.

4. **NOTE-4 — Overlapping CI coverage between `i-proposed-o-stripe-no-webview-wrap` and `orch-0802-stripe-embedded-components-routing` Check 3.** Both gates enforce the WebView-ban portion of I-PROPOSED-O. Intentional belt-and-braces per implementor; adds ~10s of CI time per PR. Consolidation candidate for a future cleanup ORCH if operator prefers leaner CI; not a defect.

---

## Manual test plan (operator-runnable on iOS sim + Android emu + Web)

Implementation report §9 (M-01..M-12) is the canonical plan. I re-validated each step against the actual code paths and confirm they exercise the correct UI states. The plan is sound. Run on a brand whose Stripe Connect account is active to exercise the full flow; repeat with a `not_connected` and `onboarding` brand to verify the gate hides the section.

This QA does **not** include live device runs because the change is pure React Native UI using only the existing Sheet primitive (same Sheet that `BrandDeleteSheet.tsx` uses in production today). Per the canonical-tester-platform-parity rule, runtime device verification is requested from the operator as a pre-OTA gate, not silently absorbed as CONDITIONAL PASS — explicit ask in the Next Handoff below.

---

## Sign-off

Code-tier verification: **PASS** across all 13 SPEC success criteria. Implementor's report claims independently verified. Strict-grep gate proven on all 3 checks (implementor smoked only 1). Constitution clean. SPEC §2 non-goals: 14/14 files with zero diff. Regression: zero gate failures in 5 related Stripe gates.

Hand to orchestrator for CLOSE. CLOSE protocol should: (1) flip I-PROPOSED-O to ACTIVE in WORLD_MAP / coverage docs (already in INVARIANT_REGISTRY); (2) append DEC entry codifying no-RN-SDK-migration-this-cycle decision with the all-three-RN-components-GA EXIT condition; (3) queue the four P4 follow-ups; (4) patch the INVESTIGATION file's Path B import description per NOTE-2; (5) ready for EAS OTA after operator-runnable M-01..M-12 manual smoke (no migration to apply, no edge fn to deploy).

---

**End of QA report.**
