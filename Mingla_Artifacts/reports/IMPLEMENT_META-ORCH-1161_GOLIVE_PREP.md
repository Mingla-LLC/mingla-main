# IMPLEMENT — META-ORCH-1161 go-live-prep (DEC-191 marketing opt-out model + US quiet-hours recipient TZ)

**Status:** implemented and verified (source + behavioral tests; remote assumptions probed read-only). Not deployed/merged.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[golive-prep]/` on branch `ORCH-1161-golive-prep`.
**Date:** 2026-06-20.

---

## 1. Summary

Two Seth-approved go-live changes:

- **CHANGE 1 — marketing is now ENROLLED-BY-DEFAULT (opt-out), consistent across `can_send` + the prefs UI + `marketing-send`.** Before, marketing was opt-IN on the `can_send` side (required an explicit `enabled=true` pref) and the prefs marketing chips defaulted OFF — contradicting "everyone who signs up/checks out consents to marketing." Now `can_send` is default-ON for marketing categories (deny only on an explicit `enabled=false` pref OR a `channel_suppressions` row), the prefs marketing chips render ON by default, and toggling a marketing email/sms chip OFF writes a `channel_suppressions(scope='marketing')` row via a new SECURITY DEFINER RPC — the SINGLE source of truth honored by BOTH `can_send` AND `marketing-send`/`marketingAudience`. Opt back in removes the suppression.
- **CHANGE 2 — US marketing SMS quiet-hours now use the recipient's actual timezone** (derived from the NANP area code), not a fixed Eastern anchor. A West-Coast +1 at 5 AM local is now correctly blocked while it is 8 AM Eastern. NG window unchanged (8 AM–8 PM WAT). Unknown area code → conservative deny.

Texting stays OFF (no kill-switch flipped). `channel_suppressions` remains the single marketing-opt-out authority (no parallel authority created). No money-seam touch.

---

## 2. SPEC success-criteria coverage

| Criterion | How verified | Status |
|---|---|---|
| SC-1 `can_send` marketing default-ON (no pref + no suppression → true) | Deno behavioral truth-table test + migration anti-drift anchor | ✓ |
| SC-2 marketing opt-out via channel_suppressions (marketing\|all) → can_send false | Deno behavioral test (user_id-keyed, contact-keyed, scope=all) | ✓ |
| SC-3 transactional behavior unchanged; a marketing STOP never blocks transactional | Deno behavioral test | ✓ |
| SC-4 prefs marketing chips default ON | matrix core test (`buildNotificationMatrix` → marketing email/sms ON) | ✓ |
| SC-5 marketing email/sms toggle OFF writes a channel_suppressions row (not a prefs row) | matrix routing test (`resolveToggleAction` → `marketing_suppression`); hook calls `setMarketingSuppression` RPC | ✓ |
| SC-6 marketing-send/audience honors the suppression (round-trip) | `marketingAudience` already reads channel_suppressions(sms marketing\|all); RPC writes contact-keyed rows so the contact-keyed resolver excludes the user; can_send honors user_id\|contact | ✓ (audience path pre-existing + RPC writes the matching contact key) |
| SC-7 US quiet-hours use recipient TZ (West-Coast 5 AM blocked while 8 AM ET) | Deno quiet-hours test (415 Pacific blocked, 212 Eastern allowed, same instant) | ✓ |
| SC-8 SMS stays text-dark | No kill-switch (`SMS_LIVE_ENABLED_*`) touched | ✓ |
| SC-9 single source of truth = channel_suppressions | RPC + matrix read channel_suppressions; no parallel authority | ✓ |
| SC-10 migrations monotonic + REVOKE/GRANT discipline | prefix `20261113000000` > max `20261112000002`; REVOKE PUBLIC/anon + GRANT authenticated on both fns | ✓ |

---

## 3. Files changed

**New (4):**
- `supabase/migrations/20261113000000_orch_1161_golive_marketing_optout.sql` (+~190) — CREATE OR REPLACE `can_send` (marketing default-ON) + new RPC `set_marketing_suppression(text, boolean)`.
- `supabase/migrations/__tests__/orch_1161_golive_can_send_marketing_optout.test.ts` (+~190) — can_send behavioral + anti-drift test (5 tests).
- `supabase/functions/marketing-send/quiet-hours-tz.test.ts` (+~120) — quiet-hours recipient-TZ test (6 tests).
- `app-mobile/src/components/profile/__tests__/notificationPrefsMatrix.orch1161.golive.test.ts` (+~150) — prefs routing + default-ON matrix test (5 tests).

**Modified (8):**
- `app-mobile/src/components/profile/notificationPrefsMatrix.ts` (~+90) — marketing default-ON; `MarketingSuppressionRow`; `buildNotificationMatrix` 3rd arg `suppressions`; `isMarketingSuppressibleChannel`; `resolveToggleAction` (discriminated write action).
- `app-mobile/src/services/notificationPrefsService.ts` (~+45) — fetch the user's marketing channel_suppressions; `setMarketingSuppression` RPC wrapper.
- `app-mobile/src/hooks/useNotificationPrefs.ts` (~+70) — route toggles via `resolveToggleAction`; optimistic update of the prefs OR suppressions slice; pass suppressions into the matrix builder; `ToggleChannelArgs.isTransactional`.
- `app-mobile/src/components/profile/AccountSettings.tsx` (~+5) — thread `row.isTransactional` into the toggle.
- `supabase/functions/marketing-send/index.ts` (~+95) — `US_AREACODE_TZ` NANP map; `resolveRecipientTz`; `isWithinQuietHours(phone, country, now)`; call site passes the phone.
- `app-mobile/src/components/profile/__tests__/notificationPrefsMatrix.orch1161.test.ts` (~+12) — `[TEST-MOD-APPROVED META-ORCH-1161]` the superseded "marketing default OFF" subtest inverted to the DEC-191 default-ON contract.
- `.github/workflows/supabase-migrations-and-stripe-deno.yml` (+~7) — register the 2 new Deno tests (+`--allow-read`).
- `app-mobile/scripts/ci/orch-1161-notif-prefs-matrix-check.mjs` (~+8) — run the new golive matrix test alongside the happy-path test.

---

## 4. Data-model changes applied

None to tables/columns/constraints/indexes/RLS (additive function-only migration). Two functions:
- `public.can_send(uuid, text, text, text)` — CREATE OR REPLACE (signature unchanged → no DROP). REVOKE PUBLIC/anon, GRANT authenticated.
- `public.set_marketing_suppression(text, boolean)` — NEW SECURITY DEFINER. REVOKE PUBLIC/anon, GRANT authenticated. Resolves caller email (auth.users.email → verified auth.identities fallback, ORCH-1111 pattern) + phone (auth.users.phone, normalized to `+E.164`); inserts (opt-out) / deletes (opt-in) channel_suppressions(scope='marketing'). Opt-in delete touches ONLY scope='marketing' rows (never a scope='all' STOP / bounce / complaint).

**Read-only remote probe (MCP, 2026-06-20):** `auth.users.phone`=present, `auth.users.email`=present, `public.channel_suppressions`=present, `channel_suppressions_uniq_idx`=present, `can_send`=present. The migration applies cleanly (CREATE OR REPLACE on existing can_send; ON CONFLICT DO NOTHING is constraint-agnostic).

---

## 5. Edge functions touched

- `marketing-send` — quiet-hours recipient-TZ fix. `verify_jwt` to preserve: per `supabase/config.toml` (dual-path: cron service-role + user-JWT ownership check; do NOT change). No new env. **Redeploy from MERGED main** after merge.
- `record-consent`, `notify-dispatch`, `twilio-inbound-sms`, `self-serve-unsubscribe`, `marketingAudience` consumers — NOT changed, but `can_send` is a shared chokepoint: every edge fn that calls `can_send` (notify-dispatch v2 + outbox drain) gets the new marketing-default-ON behavior automatically once the migration is applied — no redeploy strictly required for them, but redeploy notify-dispatch + marketing-send from merged main to be safe.

---

## 6. Regression tests added

| Test | Path | Tests | fails-on-revert |
|---|---|---|---|
| can_send marketing default-ON + suppression | `supabase/migrations/__tests__/orch_1161_golive_can_send_marketing_optout.test.ts` | 5 | **verified** — deleting the unified default-ON pref-gate (restoring the old off-by-default marketing branch) fails the anti-drift anchor |
| prefs default-ON + suppression routing | `app-mobile/src/components/profile/__tests__/notificationPrefsMatrix.orch1161.golive.test.ts` | 5 | **verified** — deleting the marketing branch of `isMarketingSuppressibleChannel` → 3 of 5 fail |
| quiet-hours recipient TZ | `supabase/functions/marketing-send/quiet-hours-tz.test.ts` | 6 | **verified** — reverting the US branch of `resolveRecipientTz` to a fixed `America/New_York` → anti-drift anchor fails |

`fails-on-revert verified at` working-tree commit (pre-commit; backups restored after each proof). All three green after restore. Existing tests still green: matrix happy (8), matrix adversarial (4), marketing-send (13), marketingAudience sms-suppression (2).

---

## 7. Old → New receipts

### can_send (migration)
- **Before:** marketing (is_transactional=false) required an explicit `notification_channel_prefs.enabled=true` (off-by-default); transactional default-ON.
- **Now:** BOTH default-ON; the only pref that opts a channel out is an explicit `enabled=false`; suppression gate unchanged.
- **Why:** DEC-191 — marketing enrolled-by-default. **Lines:** ~10 changed in the fn body + comment/COMMENT.

### notificationPrefsMatrix.ts
- **Before:** `defaultChannelEnabled` returned `isTransactional` (marketing OFF); a marketing toggle wrote a `notification_channel_prefs` row.
- **Now:** default-ON for all; marketing email/sms cells read from a new `suppressions` arg (OFF iff suppressed); `resolveToggleAction` routes marketing email/sms to a `marketing_suppression` write, everything else to the prefs upsert.
- **Why:** chips reflect auto-enroll; channel_suppressions is the single opt-out authority. **Lines:** ~90.

### notificationPrefsService.ts + useNotificationPrefs.ts
- **Before:** fetched categories + prefs; toggle always upserted `notification_channel_prefs`.
- **Now:** also fetches the user's marketing channel_suppressions; toggle dispatches per `resolveToggleAction` (suppression RPC for marketing email/sms); optimistic update flips the correct cache slice.
- **Why:** RLS — authenticated cannot write channel_suppressions directly, so the RPC is the only correct path. **Lines:** ~115.

### marketing-send/index.ts
- **Before:** `isWithinQuietHours(countryCode, now)` used a fixed `America/New_York` for ALL US numbers.
- **Now:** `isWithinQuietHours(phone, countryCode, now)` derives the IANA zone from the NANP area code (`US_AREACODE_TZ` + `resolveRecipientTz`); unknown area code → deny.
- **Why:** TCPA/FCC quiet-hours are recipient-local; the Eastern anchor risked a 5 AM-local text. **Lines:** ~95.

---

## 8. Cross-surface impact

| Surface | Affected? | What / parity |
|---|---|---|
| Consumer iOS | YES | prefs marketing chips default ON, toggle writes suppression. Path: `app-mobile/...`. Parity automatic (shared RN core). **Needs OTA.** |
| Consumer Android | YES | same as iOS, shared code, automatic parity. **Needs OTA.** |
| Buyer/anon Web | NO | no prefs matrix; checkout opt-in (orch-0847) untouched. |
| Business iOS / Android | NO | no consumer prefs matrix; quiet-hours is server-side. |
| Admin Web (adjacent) | NO | — |
| Business Web preview (adjacent) | NO | — |
| Backend (all surfaces) | YES | `can_send` (shared chokepoint) + `marketing-send` quiet-hours. Applies to every send path once migrated. |

Parity is automatic (single shared consumer RN core + single backend chokepoint). No manual multi-surface duplication.

---

## 9. Smoke result

No device/sim run (consumer prefs UI; gates run instead). Verified: 11 Deno tests (CI shape, `--allow-read`) + 13 Node matrix tests via the CI wrapper + adversarial(4) + marketing-send(13) + marketingAudience(2), all green. `deno check` clean on marketing-send. Zero new TS errors in touched files. Remote assumptions probed read-only. **UNVERIFIED on device:** the actual chip-tap → RPC → suppression round-trip on a physical phone (tester to drive).

---

## 10. Known issues / deferred

- The `marketingAudience` resolver excludes a suppressed user by CONTACT (the RPC writes a contact-keyed row when the caller has an email/phone on file). A consumer with NO email and NO phone on `auth.users` gets only a user_id-keyed suppression — honored by `can_send` (push/inapp/email/sms for that user) but NOT by the contact-keyed `marketingAudience` blast (which keys off `orders.buyer_email`). In practice a buyer in the audience HAS a buyer_email, so this gap is theoretical for the blast path. Flagged, not blocking.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

1. **Apply the migration** (from this worktree, after monotonicity re-check):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1161-[golive-prep]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   (worktree is not `supabase link`ed in this session — link or run from the anchor after merge. Remote-only drift check could not run here; run `supabase migration list --linked` from a linked checkout before push.)
2. **Redeploy edge functions from MERGED main** (NOT the worktree): `marketing-send` (quiet-hours fix), and `notify-dispatch` (picks up the new can_send behavior). `verify_jwt` per existing `config.toml` — do not change.
3. **OTA the consumer app** (`app-mobile`) dev channel for the prefs-UI change (pure-JS → `eas update`, per-platform).
4. SMS go-live still gated on the §8 TCPA legal sign-off + kill-switch flip — NOT part of this ORCH.

---

## 12. Discoveries for orchestrator

- The CI test runners (`supabase-migrations-and-stripe-deno.yml`, the app-mobile matrix wrapper) use EXPLICIT file lists, not glob discovery — any future ORCH-1161 test MUST be registered or it silently never runs in CI. I registered all 3 new tests.
- `record-consent` already writes a `scope='marketing'` consent row on grant (DEC-186) — no change needed; the default-ON + suppression model is the enrollment mechanism, consent_records is the audit trail. Confirmed, no per-user enabled=true rows written for signups.
- COMMS ledger: no BLOCK/WARN entry addressed to mingla-implementor / META-ORCH-1161 / ALL touches this lane (notification prefs / marketing-send / can_send). The active WARN initiatives (RSVP/experience public-page standardization, ORCH-1142 notif-read-delete) touch different files. No ack write needed; no new cross-ORCH discovery to log.
