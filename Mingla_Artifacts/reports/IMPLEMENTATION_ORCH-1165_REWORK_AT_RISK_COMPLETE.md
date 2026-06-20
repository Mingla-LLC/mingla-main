# IMPLEMENTATION — ORCH-1165 REWORK [business keyboard "Done" bar — close the 9 remaining occlusion sites]

**Phase:** IMPLEMENT (mingla-implementor, business side) — rework per `SPEC_AMENDMENT_ORCH-1165_AT_RISK_COMPLETE.md` (A2/A4, sites #16–#24).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1165-[business-keyboard-done-bar]/` on branch `ORCH-1165-business-keyboard-done-bar`. Base impl @ `e41f68dee`, amendment @ `d5456df47`. NO rebase (per dispatch).
**Status:** implemented and verified (source-regex + gate + jest + fails-on-revert + typecheck-delta). On-device SC-3/SC-4 eyeball is the tester's pass (A6) — not in implementor scope.

---

## 1. Summary

Closed the 9 remaining keyboard-occlusion sites in the business app where the app-root 42pt "Done" accessory bar overlays a bespoke keyboard-avoidance value that bypasses `SmartScrollView`. Each fix adds exactly `+ 42` (or `keyboardVerticalOffset={42}`) to the **keyboard-OPEN branch only** — never the web branch, never the keyboard-closed branch — so there is no permanent dead gap when the keyboard is down. The proven P1 (Ari composer, ~8pt clearance < 42pt bar) is fixed; the 7 native checkout forms and the newly-found Paystack bank-picker modal are fixed for guaranteed clearance.

## 2. SPEC success-criteria coverage (amendment A5)

| SC | Criterion | How verified | Result |
|----|-----------|--------------|--------|
| SC-3.1 | Ari composer fully visible above bar (the P1 must now PASS) | `+42` added to `keyboardHeight + spacing.sm` keyboard-open branch (`AriChatScreen.tsx:329`); source-regex test asserts keyed-on-open + web branch untouched | ✓ source-verified @ commit below; on-device Ari eyeball = tester (A6.2/A6.3) |
| SC-3.2 | Event checkout buyer + payment clear bar | `+42` in `keyboardHeight > 0` branch (`checkout/[eventId]/buyer.tsx:423`, `payment.tsx:629`) | ✓ source-verified; on-device = tester |
| SC-3.3 | Trip checkout buyer + **intake** + payment clear bar | `+42` (intake = the tight `spacing.xl` one at `:468`); buyer `:455`; payment plan-aware `:633` | ✓ source-verified; intake is must-drive (tester A6.4) |
| SC-3.4 | Experience checkout buyer + payment clear bar | `+42` in `keyboardHeight > 0` branch (`:362`, `:537`) | ✓ source-verified; on-device = tester |
| SC-3.5 | Paystack bank-picker modal reachable above bar | `keyboardVerticalOffset={42}` on the modal KAV (was implicit 0) (`BrandPaystackOnboardView.tsx:261`) | ✓ source-verified; on-device = tester (A6.1) |
| SC-7 | orch-0892 gate stays PASS | ran gate → EXIT 0, 840 files, 0 violations | ✓ |
| (amendment A8) | mount-coverage adversarial test extended + fails-on-revert | 9 new source-regex assertions added; reverting any patch FAILs the matching assertion | ✓ |

> SC-1/SC-2/SC-4/SC-5/SC-6 carry forward from base impl @ `e41f68dee` (this rework touches only the 9 newly-found sites + the test). SC-4a/SC-4b (sheet/Modal on-device) and the iOS Ari eyeball are tester directives (A6), not implementor-owned.

## 3. Files changed (10 total — all in A4 expanded allowlist)

| File | Δ | Patch |
|------|---|-------|
| `mingla-business/src/screens/ari/AriChatScreen.tsx` | +1/-1 | `keyboardHeight + spacing.sm` → `+ spacing.sm + 42` (kbd-open branch) |
| `mingla-business/app/checkout/[eventId]/buyer.tsx` | +1/-1 | `keyboardHeight + 140` → `+ 140 + 42` (`> 0` branch) |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | +1/-1 | same |
| `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` | +1/-1 | same |
| `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx` | +1/-1 | `keyboardHeight + spacing.xl` → `+ spacing.xl + 42` (kbd-open branch; the tight one) |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | +1/-1 | `keyboardHeight + (isPlanActive ? 260 : 140)` → `... + 42` (`> 0` branch) |
| `mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx` | +1/-1 | `keyboardHeight + 140` → `+ 140 + 42` (`> 0` branch) |
| `mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx` | +1/-1 | same |
| `mingla-business/src/components/brand/BrandPaystackOnboardView.tsx` | +1/-0 | add `keyboardVerticalOffset={42}` to the bank-picker modal KAV |
| `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_mount_coverage.test.ts` | +60/-0 | append-only describe block (C): 9 new source-regex assertions |

Total: 69 insertions, 8 deletions. NO file outside the allowlist touched.

## 4. Data-model changes applied

None. Pure-JS UI padding fix; no DB / edge / service / hook / migration.

## 5. Edge functions touched

None.

## 6. Regression tests added

**Path:** `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_mount_coverage.test.ts` (append-only; file already carried `[TEST-MOD-APPROVED ORCH-1165]`).
**New assertions (block C):**
- Ari: `+42` inside the keyboard-open `keyboardHeight + spacing.sm + 42` term; web branch NOT given +42.
- 5 identical-pattern checkout scrollviews (event buyer/payment, trip buyer, experience buyer/payment): `+42` strictly inside `keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 + 42 } : null`; keyboard-closed static padding stays `insets.bottom + 140`.
- Trip intake: `+42` inside the `keyboardHeight > 0 ? ... keyboardHeight + spacing.xl + 42` branch; closed branch stays `insets.bottom + 120`.
- Trip payment (plan-aware): `+42` inside `keyboardHeight + (isPlanActive ? 260 : 140) + 42`; closed static padding does NOT carry +42.
- BrandPaystackOnboardView: `keyboardVerticalOffset={42}` present, `={0}` absent.

**Run (after restore):** `Tests: 19 passed, 19 total` (both ORCH-1165 files: mount-coverage + clearance).

**fails-on-revert verified at `a2d1fdf6a`** by TRUE LINE-DELETION (not comment-out):
- Delete Ari `+ 42` → `Ari composer adds +42...` FAILS. Restore → PASS.
- Delete BrandPaystack `keyboardVerticalOffset={42}` line → `BrandPaystackOnboardView...` FAILS. Restore → PASS.
- Delete event-buyer `+ 42` → `app/checkout/[eventId]/buyer.tsx adds +42...` FAILS (and the other 4 `.each` rows stay PASS, proving per-site granularity). Restore → PASS.
- Delete intake `+ 42` → `trip checkout intake (tight spacing.xl)...` FAILS. Restore → PASS.

Representative captured runs:
```
# After deleting Ari +42 and BrandPaystack kbVO line:
✕ Ari composer adds +42 to the keyboard-open paddingBottom term only
✕ BrandPaystackOnboardView bank-picker KAV lifts with keyboardVerticalOffset={42}
Tests: 2 failed, 15 passed, 17 total
# After deleting event-buyer +42 and intake +42:
✕ app/checkout/[eventId]/buyer.tsx adds +42 only inside the keyboardHeight > 0 padding branch
✓ app/checkout-trip/[tripEventId]/buyer.tsx adds +42 ...   (per-site isolation proven)
✕ trip checkout intake (tight spacing.xl) adds +42 only when keyboard open
Tests: 2 failed, 15 passed, 17 total
# After restoring all → Tests: 19 passed, 19 total
```

## 7. Old → New receipts

### AriChatScreen.tsx (the DEFECT)
- **Before:** keyboard-open `paddingBottom = keyboardHeight + spacing.sm` (~8pt) — composer text sat under the 42pt Done bar (proven P1).
- **Now:** `keyboardHeight + spacing.sm + 42` — composer clears the bar. Web branch (`spacing.sm`) and keyboard-closed branch (`Math.max(insets.bottom, spacing.md) + BOTTOM_NAV_CLEARANCE_PX`) untouched.
- **Why:** SC-3.1 (Ari P1 must PASS). **Lines:** 1.

### 7 checkout forms (buyer/payment/intake across event/trip/experience)
- **Before:** keyboard-open padding = `keyboardHeight + 140` (or `spacing.xl` for intake, or `+ (isPlanActive ? 260 : 140)` for trip payment). 140pt usually clears but `scrollToEnd` can land a bottom field in the bar zone; intake's `spacing.xl` (<42) was genuinely tight.
- **Now:** `+ 42` added to the keyboard-open term only (closed branch keeps its static padding). The dock already hides on keyboard-open, so the extra 42pt is invisible when the keyboard is down.
- **Why:** SC-3.2/3.3/3.4 (guaranteed clearance + keyed-on-open contract). **Lines:** 1 each.

### BrandPaystackOnboardView.tsx (NEWLY FOUND)
- **Before:** bank-picker modal KAV had no `keyboardVerticalOffset` (defaults 0) → bottom-anchored sheet's bottom rows landed at the keyboard top, overlaid by the bar.
- **Now:** `keyboardVerticalOffset={42}` lifts the sheet so the bank-list bottom rows clear the bar. KAV only pads when the keyboard is up (keyboard-open implicit).
- **Why:** SC-3.5. **Lines:** 1 added.

## 8. Cross-surface impact

| Surface | Affected? | Note |
|---------|-----------|------|
| Consumer iOS | NO | `app-mobile/` not touched (separate leg) |
| Consumer Android | NO | same |
| Buyer/anon Web | NO | web branch of every ternary explicitly NOT patched; BrandPaystack is native modal |
| Business iOS | YES | all 9 sites; parity automatic (one RN codebase) |
| Business Android | YES | all 9 sites; parity automatic |
| Admin Web (adjacent) | NO | not touched |
| Business Web preview (adjacent) | NO | web branches untouched; checkout web path unaffected |

Parity across iOS/Android is automatic (shared RN source). No manual parity gap.

## 9. Smoke result

No sim/device drive in implementor scope this pass (A6 directives are tester-owned). Static verification: gate EXIT 0, jest 19/19 green, fails-on-revert proven by line-deletion, typecheck delta clean (§10). The A6 on-device matrix (Ari iOS eyeball, intake must-drive, Paystack modal, SC-4a/4b sheet+Modal) is the tester's pass.

## 10. Typecheck

Full `tsc --noEmit` over `mingla-business`. The only errors in touched files are 10 pre-existing `TS7006 implicitly any` errors in `checkout/[eventId]/buyer.tsx` (520–549) and `checkout-trip/[tripEventId]/buyer.tsx` (563–592) — JSX render-prop callbacks, far from my line-423/455 edits. **Confirmed pre-existing on base HEAD** (identical line numbers via `git stash` baseline run). My `+ 42` / `keyboardVerticalOffset={42}` changes introduce ZERO new TS errors (`number + number` stays `number`; `keyboardVerticalOffset` is a valid `number` prop on the keyboard-controller KAV).

## 11. Operator action required

None for the implementor phase. No migration, no edge deploy. Route to mingla-tester for the A5/A6 on-device matrix. At CLOSE: OTA business dev channel (pure-JS, no native rebuild).

## 12. Discoveries for Orchestrator

- 10 pre-existing `TS7006 implicit-any` errors in the two `buyer.tsx` checkout files (render-prop callbacks) exist on base HEAD — unrelated to ORCH-1165, NOT fixed here (out of scope). Flag for a future cleanup ORCH if a clean `tsc` is desired.
- COMMS ledger: no BLOCK open for ORCH-1165/this skill/ALL. WARN/ALL entries (COMMS-0040/0041 RSVP+experience public-page standardization, 0027/0011/0017 etc.) read and factored — zero overlap with the 9 keyboard-padding files. A10 reaffirms RSVP/experience public pages are DO-NOT-TOUCH; none were touched.
