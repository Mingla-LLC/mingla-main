# TEST — META-ORCH-1161 Sub-A.2 — Consent Capture

**ORCH:** META-ORCH-1161 Sub-A.2 (consent-capture slice)
**Phase:** mingla-tester (adversarial gate)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[consent-surface]/` on `ORCH-1161-consent-surface`
**Commit under test:** `8b119de47`
**Date:** 2026-06-20
**Mode:** SPEC-COMPLIANCE + SECURITY + adversarial regression. Sim-gate EXEMPT for backend/SQL/edge-fn paths; the one UI/runtime finding (P1 below) is a source-provable wiring defect (a control that CANNOT fire), which caps the verdict regardless of sim.

---

## 1. Verdict

**FAIL** — P0: 0 · **P1: 1** · P2: 3 · P3: 0 · P4: 2

The legal core is excellent: the verbatim disclosure is byte-identical across both apps and the COPY authority, the dual-scope fan-out is correct, the seed-correction migration applies cleanly above remote head and yields the DEC-185 matrix, and the money seam is untouched. **But the checkout disabled-Pay "Please agree to continue" feedback is unreachable dead code** — the implementor's report and DESIGN §S3.4 both claim a tap on the greyed Pay surfaces a red flash + helper; the `Button` swallows the tap when disabled, so it is a silent dead tap (Constitution Rule 1 + behavioral-contract violation). That is an unaccepted P1 → FAIL → REWORK. Everything else is PASS-grade and re-tests fast once the dead-tap is fixed.

---

## 2. SC-by-SC matrix

| SC | Criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | Consumer OTP consent box uses §1a bundled label; underlined "terms and conditions" → §2 view; CTA gated | **PASS** | `OnboardingFlow.tsx` L2173 CTA `disabled: !isPhoneValid() \|\| !smsConsentChecked` (matches DESIGN §S3.2); label parts = byte-mirror of business constant (verified) |
| SC-2 | Consumer grant writes consent_records (txn+mktg; source='onboarding'; §1b verbatim; email+sms; country from phone; ip_hash null native) | **PASS (source + schema-on-real-PG)** | `handleVerifyOtp` L1412 → `recordConsent({source:'onboarding', disclosureText:CONSENT_DISCLOSURE_TEXT, phone:buildE164(), email:authUser.email, countryCode:data.phoneCountryCode, userId})`; edge fn fans out both scopes × provided channels; live `consent_records` schema accepts every column written |
| SC-3 | Checkout name+email+phone REQUIRED with validation/error states | **PASS (source)** | `validate()` L166-191 — name≥min, email regex, phone `isValidE164`; all three feed `isValid`; per-field error strings render on touched |
| SC-4 | Checkout marketing checkbox replaced with underlined "I agree…" → §2 sheet | **PASS** | `buyer.tsx` L631-664 Pressable + `ConsentTermsSheet`; `marketingOptIn` checkbox removed |
| SC-5 | Pay/Continue GREYED until checked AND fields valid | **PASS (gate predicate)** | `isContinueDisabled` L18-19 `!fieldsValid \|\| !termsAccepted \|\| submitting`; bound at button L697; regression test + fails-on-revert |
| SC-5b | Disabled-Pay tap → flash + "Please agree to continue" (no silent dead tap) — DESIGN §S3.4 L311/335 | **FAIL (P1)** | The flash/helper is set ONLY in `handleContinue` L381 (`if(!termsAccepted)…`), reachable ONLY when the button is ENABLED (requires termsAccepted=true) → contradiction; `Button` sets `onPress={interactive?…:undefined}` + `disabled` → disabled tap fires nothing. `consentHintVisible`/`checkboxBoxFlash`/the hint Text are unreachable dead code. |
| SC-6 | Checkout finalize writes consent_records (both scopes; source='checkout'; §1b verbatim; country from buyer country; ip_hash of request IP) | **PASS (source + schema-on-real-PG)** | `handleContinue` L394 `recordConsent({source:'checkout', disclosureText:CONSENT_DISCLOSURE_TEXT, phone, email, countryCode:phoneCountry})`; edge fn L160-161 computes `ip_hash` from `x-forwarded-for`/`x-real-ip` via SHA-256 |
| SC-7 | Capture buyer country at checkout | **PASS** | `phoneCountry` ISO → `country_code` (edge fn uppercases) |
| SC-8 | Shared T&C sheet renders §2 body verbatim, reused | **PASS** | `ConsentTermsSheet.tsx` (checkout); consumer reuses full-screen `LegalBrowser`; §2 body byte-identical across both apps (6558 chars, verified) |
| SC-9 | Seed-correction migration 20261110000005 (monotonic above 000004; +sms refund/cancel, +email payout; idempotent) | **PASS (applied vs real PG, rolled back)** | Order verified (remote head=20261110000004); transactional apply → `buyer_refund_issued`+`buyer_order_cancelled`={…,sms}, `payout_paid`={…,email}; re-run no-op (idempotent); guarded `NOT (… = ANY(default_channels))` |
| SC-10 | consent_records writer: shared service-role helper both surfaces call; dedupe on (contact,channel,scope,source) window | **PASS (source)** | `record-consent` edge fn (verify_jwt=false); 5-min dedupe query-then-insert; both apps' `consentService.ts` call it |
| SC-11 | §1b disclosure recorded VERBATIM | **PASS (byte-proven)** | `CONSENT_DISCLOSURE_TEXT` == COPY §1b == app-mobile mirror, all 1071 chars, char-for-char (python byte-compare) |
| SC-12 | Bundled-mandatory per DEC-186; SMS kill-switch unaffected | **PASS** | ONE checkbox both surfaces; no marketing-split; no SMS send path touched |

---

## 3. Findings

### P1-1 — Disabled-Pay "Please agree to continue" feedback is unreachable dead code (Constitution Rule 1 + DESIGN §S3.4 contract violation)
- **Evidence:** `mingla-business/app/checkout/[eventId]/buyer.tsx` L381 is the ONLY site that sets `setConsentHintVisible(true)`; it lives in `handleContinue` behind `if (!termsAccepted)`. `handleContinue` is invoked ONLY via the Pay button `onPress` (L691). The Pay button uses the shared `Button` (`src/components/ui/Button.tsx` L296/299: `onPress={interactive ? handlePress : undefined}`, `disabled={disabled||loading}`), and is `disabled` whenever `!termsAccepted` (via `isContinueDisabled`). Therefore: box unchecked → button disabled → tap does nothing → hint never shows; box checked → button enabled → `!termsAccepted` is false → hint never shows. The `consentHintVisible` Text (L665-668), the `checkboxBoxFlash` style (L873), and the helper are all unreachable.
- **Impact:** A buyer who fills all fields but misses the consent box taps the greyed Pay and gets ZERO feedback — a silent dead tap. DESIGN §S3.4 (L311) and the state table (L335) explicitly require "border flashes red 400ms + helper 'Please agree to continue.'" on that tap. The implementor report (§7, §9) claims this fires; it does not. This is the exact failure mode the dispatch flagged (verification point #3) and a Constitution Rule 1 auto-P0-class issue (graded P1 as it is a missing affordance on a still-visibly-disabled control, not a crash/data-loss).
- **Required fix:** Make the disabled-Pay tap reachable. Either (a) keep the Button visually disabled but route taps to a handler that runs the field-touch + `setConsentHintVisible(true)` + scroll-into-view + flash (e.g. wrap the bottom bar in a `Pressable` overlay that, when `isContinueDisabled`, calls a `showConsentHint()` instead of `handleContinue`), or (b) keep the Button enabled and move the gate inside `handleContinue` (validate → show errors → if `!termsAccepted` show hint+flush, return), matching the DESIGN-specified anti-dead-tap pattern. Mirror the onboarding pattern only if onboarding also adopts tap-to-reveal (onboarding currently passes per §S3.2 which only requires surfacing the existing phone error).
- **Retest:** Maestro/device: fill name/email/phone, leave box unchecked, tap Pay → assert the helper "Please agree to continue." renders + the checkbox border flashes. Add a render test that simulates a disabled-Pay tap and asserts `consentHintVisible` becomes true.

### P2-1 — record-consent is an OPEN write endpoint (anon, no contact-ownership proof) → audit-log pollution / forged-consent rows / cost-spam
- **Evidence:** `supabase/functions/record-consent/index.ts` runs `verify_jwt=false` and inserts `consent_records` for ANY `phone`/`email`/`countryCode`/`source` in the body with no proof the caller controls that contact (no OTP/session binding). The 5-min dedupe is per identical `(contact,channel,scope,source)` tuple, so an attacker rotating distinct fabricated contacts bypasses it entirely.
- **Impact (BOUNDED — assessed):** It CANNOT amplify into sends to a victim — `can_send()` (`20261110000002…sql` L23-100, the single send chokepoint) reads `notification_categories` + `notification_channel_prefs` + `channel_suppressions` and **does NOT read `consent_records` at all**. So a poisoned consent row grants no SMS/email capability (no TCPA send harm). The realized harm is (1) legal-record integrity — an attacker can fabricate "contact X consented" rows polluting the burden-of-proof artifact, and (2) table/cost spam (unbounded row insertion). Fabricated `user_id` is rejected (FK to `auth.users`, proven on real PG); anon `user_id=null` rows are accepted (the legit path).
- **Required fix (hardening, not a launch blocker by itself):** add a basic abuse control — per-IP rate limit on `record-consent`, and/or only accept a write when the same request also presents a fresh checkout/OTP token tying the caller to the contact. At minimum, log+alert on burst volume. Document the accepted residual if shipping as-is.
- **Retest:** call the deployed fn 50× with rotating fake emails → confirm rate-limit/no unbounded insert.

### P2-2 — Live edge round-trip NOT proven (record-consent not deployed; migration not applied)
- **Evidence:** `mcp__supabase__list_edge_functions` → `record-consent` absent from deployed list; `supabase_migrations.schema_migrations` head = `20261110000004` (000005 not applied). Both are expected pre-merge, but it means the dual-scope write was verified at the SOURCE + against the real table schema/constraints (a representative anon insert succeeds, rolled back) — NOT as a deployed end-to-end round-trip.
- **Impact:** SC-2 / SC-6 are PASS-by-mechanism, not PASS-by-live-round-trip. A deploy-time regression (env var, CORS, payload shape) would not be caught by this gate.
- **Required fix:** none in code; operator must deploy `record-consent` from MERGED main + apply `20261110000005`, then a one-shot live POST should be confirmed at CLOSE (assert a txn+mktg row pair lands with the verbatim text + country + ip_hash).
- **Retest:** after deploy, POST a grant and `select … from consent_records where contact=… order by created_at desc limit 4`.

### P2-3 — SMS-eligible strict-grep gate not yet present on-branch (DISC-1161-A2-SEED-LAG)
- **Evidence:** `.github/scripts/strict-grep/` has `i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs` but NO `i-proposed-1161-sms-only-for-policy-eligible-categories.mjs`. The SPEC marks it I-PROPOSED (flip ACTIVE at CLOSE).
- **Impact:** The closed-SMS-eligible-set invariant is not yet enforced. Per the dispatch (DISC-1161-A2-SEED-LAG), when this gate is flipped ACTIVE at CLOSE it MUST assert the CORRECTED (post-000005) seed — i.e. `buyer_refund_issued`, `buyer_order_cancelled` include `sms` and `payout_paid` includes `email`. If the gate is authored against the pre-000005 seed it will be wrong.
- **Required fix:** at CLOSE, author the gate to assert the post-correction matrix (these three rows + the rest of the §5.2 SMS rows) and run it against migrated state.
- **Retest:** run the gate after 000005 is applied; it must pass.

### P4-1 — Verbatim-disclosure discipline is exemplary (praise)
The §1b string, §2 body, §1a label parts, and `DISCLOSURE_VERSION` are byte-identical between `mingla-business` and `app-mobile` AND byte-identical to the COPY authority. The text is recorded per-row (legal artifact survives even without a versioned-text table). This is exactly right for a burden-of-proof artifact.

### P4-2 — Money seam cleanly NOT entangled (praise)
Consent writes via a dedicated `record-consent` call at the Continue tap, BEFORE the free/paid finalize, non-blocking on failure (logged, never swallowed → Constitution #3). `ticket-checkout-create` / `stripeWebhookRouter` untouched. `marketingOptIn` ridden additively rather than a risky cross-file rename.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out HEAD `8b119de47`; ran `mingla-business` jest.
- **Baseline:** `src/services/__tests__/consentService.orch1161.test.ts` → 3/3 PASS.
- **Revert A (gate):** true line-deletion of `!params.termsAccepted` in `checkoutConsentGate.ts` (`!fieldsValid || !termsAccepted || submitting` → `!fieldsValid || submitting`) → test **"Pay/Continue is DISABLED until the bundled consent box is checked" FAILED** (`expected true, received false`); restored → PASS.
- **Revert B (verbatim):** replaced `disclosureText: input.disclosureText` with a paraphrase in `consentService.ts` → test **"records the EXACT §1b disclosure VERBATIM…" FAILED**; restored → PASS.
- Final: 3/3 PASS, worktree restored clean (`git status` empty). Implementor fails-on-revert **independently confirmed at `8b119de47`**.

---

## 5. Adversarial test added (different angle)

- **Path:** `mingla-business/src/services/__tests__/consentDisclosureDrift.tester.orch1161.test.ts` (3 tests, PASS).
- **Angle (NOT covered by implementor):** the implementor's test proves the service PASSES the constant through; it CANNOT detect drift in the constant ITSELF (a paraphrase/truncation of `CONSENT_DISCLOSURE_TEXT` would still pass their pass-through check). This test PINS the constant to a FROZEN char-for-char snapshot of the COPY §1b legal authority (length 1071) + asserts every hard-required disclosure element + the exact terminal SMS-terms URL (no tail truncation) + §2 body legal entity/address.
- **fails-on-revert verified at `8b119de47`:** deleted the "Consent to texts is not a condition of any purchase. " sentence from `consentDisclosure.ts` → byte-identity + element-checklist assertions **FAILED**; restored → 3/3 PASS.
- **In-diff status:** the file is currently UNTRACKED on the branch. It MUST be committed on `ORCH-1161-consent-surface` so it appears in `git diff main...HEAD` for the closing PR (append-only; new file, no existing test modified). The implementor's happy-path test IS already in the diff.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | **FAIL** | P1-1: disabled-Pay tap gives no feedback; the specced flash/helper is unreachable |
| 2 | One owner per truth | PASS | `record-consent` is the single consent writer; disclosure constants single-source per app (byte-mirrored) |
| 3 | No silent failures | PASS | consent-write failure logged via `console.error`/`logger.onboarding`, surfaced in `RecordConsentResult.ok`, non-blocking by design |
| 4 | One query key per entity | N/A | no React Query key added |
| 5 | Server state server-side | PASS | consent state is server-written; no Zustand server cache |
| 6 | Logout clears everything | N/A | no new persisted client auth state |
| 7 | Label `[TRANSITIONAL]` | PASS | `marketingOptIn`-rides-with-`termsAccepted` documented as a deferred rename (report §10) |
| 8 | Subtract before adding | PASS | removed the old marketing checkbox; added the bundled one |
| 9 | No fabricated data | PASS | disclosure is the real authority text; country/ip derived, not faked |
| 10 | Currency-aware | N/A | no pricing touched |
| 11 | One auth instance | PASS | consumer reuses `supabase.auth.getUser()`; checkout anon |
| 12 | Validate at right time | PASS | field validation on touched; consent recorded at the affirmative act |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | no `_hasHydrated` gate involved |

---

## 7. Device / parity matrix

| Surface | Ships? | Verdict | Note |
|---|---|---|---|
| Consumer iOS (`app-mobile`) | YES | PASS (source) | onboarding gate + consent write; shared RN |
| Consumer Android | YES | PASS (source, auto) | shared RN with iOS |
| Buyer/anon Web (`mingla-business` checkout) | YES | **FAIL** | P1-1 dead-tap on the web/web-phone checkout (primary surface for this slice) |
| Business iOS / Android | NO | N/A | no business-side consent surface this slice |
| Admin Web | NO | N/A | no consent surface |
| Business Web preview (adjacent) | INCIDENTAL | inherits P1-1 | same `buyer.tsx` |

**Sim/device:** NOT driven this pass. Exempt for the backend/SQL/edge paths (migration verified vs real PG; schema/constraints verified live). The one UI finding (P1-1) is a source-provable wiring contradiction (a control that cannot fire) — sufficient to FAIL without a sim. A device retest is required to PASS SC-5b after the fix. **Operator physical-iPhone HITL: NOT requested this pass (verdict already FAIL on source).**
**Edge deploy state:** `record-consent` NOT deployed (pre-merge, expected). Migration `20261110000005` NOT applied (remote head `20261110000004`, expected).

---

## 8. Discoveries for Orchestrator

- **DISC-T-1161A2-1 (seed-key naming divergence, pre-existing, OUT of scope):** SPEC §5.2 line 242's "complete closed SMS-eligible set" enumerates keys like `buyer_event_reminder_24h`/`_2h`, `buyer_reservation_reminder_24h`/`_2h`, `waitlist_table_ready`, and omits `buyer_reservation_confirmed`. The LIVE seed uses single rows `buyer_event_reminder`, `buyer_reservation_reminder`, and includes `buyer_reservation_confirmed` (all sms-eligible). The three rows THIS migration touches (`buyer_refund_issued`/`buyer_order_cancelled`/`payout_paid`) match the SPEC §5.2 table rows exactly, so this slice is correct — but the broader seed-vs-SPEC key naming should be reconciled before the SMS-eligible strict-grep gate is finalized, or the gate's expected set will not match the live keys.
- **OQ-2 confirmed:** `consent_records.source` has NO CHECK constraint (only `action`/`channel`/`scope` are constrained) — `source='onboarding'`/`'checkout'` accepted with no enum widening (matches implementor §12).
- **No UNIQUE constraint** on `consent_records` → dedupe is purely the edge fn's query-then-insert (a concurrent double-tap race can still write duplicates; acceptable for an append-only audit log, noted).
- **COMMS-0040/0041** (RSVP/experience public-page standardization) — FYI per dispatch; this slice touches checkout + onboarding, not the public RSVP/experience page bodies. No conflict.

---

## 9. Routing

**FAIL → REWORK (mingla-implementor).** Single blocking item: **P1-1** — make the disabled-Pay tap surface the specced flash + "Please agree to continue." helper (DESIGN §S3.4 L311/335). Recommended to also commit the tester adversarial test on-branch (P2/process), address P2-1 hardening or document the accepted residual, and ensure the CLOSE-time SMS-eligible gate asserts the post-000005 seed (P2-3). NOT clear-to-close.
