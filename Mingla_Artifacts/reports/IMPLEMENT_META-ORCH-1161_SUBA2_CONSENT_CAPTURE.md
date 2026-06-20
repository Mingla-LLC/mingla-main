# IMPLEMENTATION — META-ORCH-1161 Sub-A.2 — Consent Capture

**ORCH:** META-ORCH-1161 Sub-A.2 (consent-capture slice)
**Phase:** mingla-implementor (single bounded pass)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[consent-surface]/` on `ORCH-1161-consent-surface`
**Date:** 2026-06-20
**Status:** implemented and verified (unit + gates + DB probe); device/runtime UNVERIFIED (no sim/device run — see §9)

---

## 1. Summary

The bundled-mandatory consent gate (DEC-186) is now wired on both consent-capture
surfaces. A consumer cannot finish phone-OTP signup, and an anonymous buyer cannot
reach payment, without checking ONE mandatory "I agree to all terms and conditions"
box. Checking it writes a verbatim `consent_records` audit trail (transactional +
marketing, per channel) carrying the EXACT §1b disclosure string, the buyer country,
a server-computed IP hash (web), and the pinned disclosure version. The thin-slice
notification-category seed was corrected to match DEC-185 (the closed SMS-eligible
set). S1 (the consumer notification-preferences matrix) is explicitly OUT of this
slice and remains backlog.

---

## 2. SPEC success-criteria coverage

| SC | Criterion (dispatch /goal + SPEC §8.6 / DESIGN S2/S3) | Status | Evidence |
|---|---|---|---|
| SC-1 | Consumer OTP consent box uses §1a bundled label; underlined "terms and conditions" opens the §2 T&C view; cannot proceed until checked (gate kept) | ✓ | `OnboardingFlow.tsx` consent block + i18n keys; CTA gate `!isPhoneValid() \|\| !smsConsentChecked` unchanged (L2143) |
| SC-2 | On consumer grant, write `consent_records` (transactional + marketing; source='onboarding'; disclosure=§1b verbatim; channels email+sms; country from phone; ip_hash null on native) | ✓ | `OnboardingFlow.handleVerifyOtp` → `recordConsent({source:'onboarding', disclosureText: CONSENT_DISCLOSURE_TEXT, ...})`; edge fn fans out both scopes × {sms,email} |
| SC-3 | Checkout: name+email+phone REQUIRED with validation/error states | ✓ | Already present (`validate()` requires all three; `styles.required`/`errorText`); confirmed, kept |
| SC-4 | Checkout marketing checkbox replaced with underlined "I agree to all terms and conditions" → §2 T&C sheet | ✓ | `buyer.tsx` consent block + `ConsentTermsSheet.tsx` |
| SC-5 | Pay/Continue GREYED OUT until checked AND fields valid | ✓ | `isContinueDisabled({fieldsValid, termsAccepted, submitting})`; regression test + fails-on-revert |
| SC-6 | On finalize, write `consent_records` (both scopes; source='checkout'; disclosure=§1b verbatim; country_code from buyer country; ip_hash of request IP) | ✓ | `buyer.handleContinue` → `recordConsent({source:'checkout', countryCode: phoneCountry, ...})`; edge fn computes ip_hash from `x-forwarded-for` |
| SC-7 | Capture buyer country at checkout | ✓ | Derived from `phoneCountry` ISO (DESIGN §S3.6 — no extra field) → `country_code` |
| SC-8 | Shared T&C sheet rendering §2 body verbatim, reused | ✓ | `ConsentTermsSheet.tsx` (checkout); consumer reuses full-screen `LegalBrowser` per DESIGN §S2.2; §2 body verbatim in `consentDisclosure.ts` (both apps) |
| SC-9 | Seed-correction migration (monotonic 20261110000005): +sms to refund_issued & order_cancelled, +email to payout_paid; idempotent UPDATE WHERE key= | ✓ | `20261110000005_orch_1161_seed_corrections.sql`; DB probe confirmed target rows |
| SC-10 | consent_records writer: shared service-role helper both surfaces call; dedupe on (contact,channel,scope,source) within a short window | ✓ | `record-consent` edge fn (verify_jwt=false); 5-min dedupe window |
| SC-11 | §1b disclosure recorded VERBATIM (no paraphrase) | ✓ | `CONSENT_DISCLOSURE_TEXT` constant (both apps) = §1b string char-for-char; test asserts `toBe(CONSENT_DISCLOSURE_TEXT)` |
| SC-12 | Bundled-mandatory per DEC-186 (no compliant split); SMS kill-switch unaffected | ✓ | ONE checkbox gates both surfaces; no marketing-split UI; no SMS send touched |

---

## 3. Files changed

**New (8):**
- `supabase/migrations/20261110000005_orch_1161_seed_corrections.sql` (+34)
- `supabase/functions/record-consent/index.ts` (+232)
- `mingla-business/src/constants/consentDisclosure.ts` (+112)
- `app-mobile/src/constants/consentDisclosure.ts` (+112, byte-mirrored)
- `mingla-business/src/services/consentService.ts` (+72)
- `app-mobile/src/services/consentService.ts` (+62)
- `mingla-business/src/components/checkout/ConsentTermsSheet.tsx` (+112)
- `mingla-business/src/components/checkout/checkoutConsentGate.ts` (+20)
- `mingla-business/src/services/__tests__/consentService.orch1161.test.ts` (+150, test)

**Modified (6):**
- `mingla-business/app/checkout/[eventId]/buyer.tsx` (~+95 / −25)
- `mingla-business/src/components/checkout/CartContext.tsx` (+12)
- `app-mobile/src/components/OnboardingFlow.tsx` (~+45 / −20)
- `app-mobile/src/i18n/locales/en/onboarding.json` (+4 keys, ~2 changed)
- `supabase/config.toml` (+6, `[functions.record-consent] verify_jwt=false`)
- `Mingla_Artifacts/specs/...` + `Mingla_Artifacts/design/ORCH-1161/` (carried canonical docs)

---

## 4. Data-model changes applied

No new tables/columns (the Sub-A thin slice already shipped `consent_records` etc.).
ONE data correction migration (`20261110000005`): idempotent `UPDATE` of three
`notification_categories.default_channels` arrays via guarded `array_append`. No
DDL, no RLS change, no SECURITY DEFINER (so no GRANT/REVOKE needed).

DB read-only probe (pre-handoff, Migration & Deploy Handoff requirement):
```
buyer_order_cancelled : {inapp,push,email}   → migration adds 'sms'  ✓
buyer_refund_issued   : {inapp,push,email}   → migration adds 'sms'  ✓
payout_paid           : {inapp,push,sms}     → migration adds 'email' ✓
```
The `WHERE NOT (... = ANY(default_channels))` guard means it cannot abort or
double-append against existing remote rows — safe + idempotent.

---

## 5. Edge functions touched

| Function | Change | verify_jwt to preserve |
|---|---|---|
| `record-consent` (NEW) | Shared consent writer; service-role insert of `consent_records` (both scopes × {sms,email}); server-side ip_hash; 5-min dedupe | **false** (anon-tolerant: checkout buyer is anon) |

No other edge function was touched. The money seam (`ticket-checkout-create`,
`stripeWebhookRouter`) was deliberately NOT entangled — consent writes via the
dedicated `record-consent` call from the buyer surface at the Continue tap
(before either the free or paid finalize path), keeping the money logic untouched.

---

## 6. Regression tests added

- `mingla-business/src/services/__tests__/consentService.orch1161.test.ts` (3 tests, all PASS).
- **fails-on-revert verified at `2f63604b6`** (worktree HEAD pre-commit), by TRUE LINE DELETION:
  - Deleted `disclosureText: input.disclosureText` in `consentService.ts` → the
    "VERBATIM" test FAILED; restored → PASS.
  - Deleted the `!params.termsAccepted` term in `checkoutConsentGate.ts` → the
    "DISABLED until checked" test FAILED; restored → PASS.
- Passing run:
  ```
  PASS src/services/__tests__/consentService.orch1161.test.ts
    ✓ records the EXACT §1b disclosure VERBATIM with source='checkout' + both contacts
    ✓ returns ok=false (does NOT throw) when the edge fn errors — checkout must not deadlock
    ✓ Pay/Continue is DISABLED until the bundled consent box is checked
  Tests: 3 passed, 3 total
  ```

---

## 7. Old → New receipts

### mingla-business/app/checkout/[eventId]/buyer.tsx
**Before:** an optional "Email me about this organiser's future events" marketing
checkbox (`marketingOptIn`); Pay disabled only on `!validation.isValid || submitting`.
**Now:** ONE mandatory "I agree to [terms and conditions]…" checkbox (`termsAccepted`,
underlined link → `ConsentTermsSheet`); Pay disabled until `isContinueDisabled`
(fields valid AND box checked); a disabled-tap-with-unchecked-box surfaces a red
helper + box flash (no dead tap); on Continue with the box checked, `recordConsent`
writes the audit (both scopes, country from phone ISO) before finalize; checking the
box also sets `marketingOptIn=true` (DEC-186 bundling) so the downstream payment
payload still carries the grant.
**Why:** SC-4/5/6/7/12 + DEC-186.
**Lines:** ~+95 / −25.

### mingla-business/src/components/checkout/CartContext.tsx
**Before:** `BuyerDetails` had `marketingOptIn` only.
**Now:** added optional `termsAccepted` (the bundled-consent signal) + default false.
Kept `marketingOptIn` (rides with `termsAccepted`) to avoid a cross-file rename
beyond the allowlist (trip/experience checkout + payment finalize + persistence +
native flow all read `marketingOptIn`).
**Why:** SC-5; scope discipline (additive, not a risky rename).
**Lines:** +12.

### app-mobile/src/components/OnboardingFlow.tsx (+ en/onboarding.json)
**Before:** phone-substep consent copy = SMS-only language with two links (ToS +
Privacy); no consent record written.
**Now:** §1a bundled label with ONE underlined "terms and conditions" link →
full-screen `LegalBrowser`; on OTP verify success, `recordConsent({source:'onboarding'})`
writes both scopes with the §1b verbatim disclosure (non-blocking).
**Why:** SC-1/2/12.
**Lines:** ~+45 / −20 (+4 i18n keys).

### supabase/migrations/20261110000005_…
**Before:** seed rows for refund_issued/order_cancelled lacked `sms`; payout_paid
lacked `email`.
**Now:** corrected to the DEC-185 matrix via idempotent guarded UPDATEs.
**Why:** SC-9.
**Lines:** +34.

---

## 8. Cross-surface impact table

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Consumer iOS (`app-mobile`) | YES | OTP consent box copy + T&C link + consent record on verify | shared RN → auto |
| Consumer Android (`app-mobile`) | YES | same | auto (shared) |
| Buyer/anon Web (`mingla-business` checkout) | YES | required fields gate + bundled T&C sheet + Pay gating + consent record | web-specific (manual) |
| Business iOS (`mingla-business`) | NO | no business-side consent surface in this slice | — |
| Business Android | NO | same | — |
| Admin Web | NO | no consent surface | — |
| Business Web preview (adjacent) | INCIDENTAL | the buyer checkout renders on web-phone; `ConsentTermsSheet` built on the cross-platform `Modal` primitive | covered by the same code |

No glass introduced → `ANDROID_GLASS_USES_OPAQUE_FALLBACK` not triggered (DESIGN §7).

---

## 9. Smoke result

NOT run on sim/device this pass (logic + contract + DB-probe verification only).
**UNVERIFIED, needs manual device testing:**
- Consumer: phone substep shows the new bundled label + underlined T&C link opening
  the legal view; box gates "Send code"; after OTP verify, a `consent_records` row
  pair (transactional+marketing, source='onboarding') exists for the phone.
- Checkout (web-phone + wide web): required-field errors; the underlined link opens
  `ConsentTermsSheet`; "I agree" footer checks the box + closes; Pay greys out until
  checked; disabled-Pay tap (box unchecked) shows the red helper + box flash; on
  Continue, a `consent_records` pair (source='checkout', country_code set, ip_hash
  non-null) is written.

---

## 10. Known issues / deferred (remaining backlog — OUT of this slice)

- **S1 — consumer notification-preferences matrix** (`AccountSettings.tsx` per-category×channel) — later slice.
- **Marketing-site pages `/unsubscribe` + `/sms-terms`** (COPY §5.1) — referenced by the §1b URLs; must be built so the links resolve (the `/unsubscribe` write depends on `channel_suppressions`). Deferred per the dispatch.
- **Sub-B** marketing SMS leg; **Sub-C** moments (reminders cron, purchase push, refund/order/reservation notify wiring).
- **`marketingOptIn`→`termsAccepted` full rename** intentionally NOT done (blast radius beyond the allowlist: trip/experience buyer+payment, persistence, native flow, order store). `termsAccepted` added additively; `marketingOptIn` rides with it. Flagged for a future consolidation ORCH.
- **Disclosure versioning store** (DESIGN OQ-4) — `DISCLOSURE_VERSION` is sent + recorded, but no server-side versioned-text table yet (the verbatim text is recorded per-row, which satisfies the legal burden today).
- **Strict-grep / type baseline:** repo-wide strict-grep gates have pre-existing failures (expo-export-stderr setup, GBP in rsvp preview, etc.) and `noImplicitAny` warnings on the PhoneInput callbacks exist on baseline; NONE flag the files this slice touched (verified by stash-compare).

---

## 11. Operator action required

1. **Apply the migration** (after REVIEW, from MERGED main per the 1161 hazard note — apply via Supabase Management API; MCP read-only / CLI drift-wedged). If applying via CLI from the worktree:
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1161-[consent-surface]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Monotonic above remote head `20261110000004`; no drift; idempotent (safe to re-run).
2. **Deploy the edge function** from MERGED `main` (NOT the worktree — clobber risk, COMMS-0015/0018):
   - `record-consent` — `verify_jwt = false`.
   No secrets required (uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, already set).
3. **OTA** (after merge): business buyer-web deploys from `main` with `[deploy]`; consumer/business per-platform `eas update`.
4. **Device QA** the §9 UNVERIFIED items.

---

## 12. Discoveries for Orchestrator

- **DISC-1161-A2-SEED-LAG:** the shipped thin-slice seed (`20261110000001`) did NOT match the DEC-185 matrix for three rows (refund_issued/order_cancelled missing `sms`; payout_paid missing `email`). This slice's migration corrects it, but it means the live `notification_categories` seed was briefly out of parity with the closed SMS-eligible set — worth a note when the `I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE-CATEGORIES` strict-grep gate is flipped ACTIVE at CLOSE (the gate must assert the CORRECTED seed).
- **OQ-2 resolved:** `consent_records.source` has NO CHECK constraint (only a comment), so `source='onboarding'` is accepted with no migration needed (no enum widening required).
- **Comms ledger:** COMMS-0040/0041 (RSVP/experience public-page standardization) are WARN/ALL — this slice touches the CHECKOUT flow + onboarding, NOT the public RSVP/experience page bodies, so no structural conflict (acked, no action).
