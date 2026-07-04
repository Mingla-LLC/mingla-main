# IMPLEMENTATION — ORCH-1298 [chip-in-receipt-emails]

Built to `Mingla_Artifacts/specs/SPEC_ORCH-1298_CHIP_IN_RECEIPT_EMAILS.md` §8 (allowlist only),
grounded in `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1298_CHIP_IN_RECEIPT_EMAILS.md`.
Worktree `~/Desktop/mingla-orchs/ORCH-1298-[chip-in-receipt-emails]/` on branch
`ORCH-1298-chip-in-receipt-emails` (rebased on origin/main).

Status: **implemented and self-verified** (runnable gates green + fails-on-revert proven on both
runnable artifacts). The SQL contract tests are the tester's live-fire artifact (hand-run post-apply,
per repo convention). Migration NOT applied, no edge deploy — orchestrator-owned.

---

## 1. Summary (plain English)

When a voluntary chip-in gift clears, both sides now get a gift-framed receipt. The **guest** gets a
thank-you email ("Thanks for chipping in — your $25 gift to Rooftop Sessions is in") plus an in-app +
push note if they're logged in; an anonymous guest gets the email. The **host** (brand team) gets a
business-app push + in-app "Ada chipped in $25 to Rooftop Sessions" and, when the brand has a contact
email on file, one email too. It fires exactly once, works on both Stripe and Paystack, is
currency-correct, and a replayed webhook sends nothing new. No money math, paid-flip, or chip-in UI
was touched.

The whole thing is a single pure-SQL enqueue on the non-replay branch of `finalize_rsvp_contribution`
(the one RPC both payment rails call), drained by the existing META-ORCH-1161 v2 outbox pipeline.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | How satisfied | Verify | Status |
|----|-----------|---------------|--------|--------|
| SC-1 | Stripe paid → 1 guest `buyer_contribution_receipt` row keyed `…:guest` | migration enqueue (1) | SQL T-1 | ✓ (structural; live-fire at TEST) |
| SC-2 | 1 host row per owner/admin/finance keyed `…:host:{uid}` + 1 `…:host_email` if contact set | migration enqueue (2)+(3) | SQL T-2 | ✓ |
| SC-3 | Dual-rail (Paystack) identical | one shared RPC, provider-agnostic | SQL T-3 | ✓ |
| SC-4 | Guest email gift-framed, currency-correct, no tax/invoice; COALESCE account email | template case + `fmtAmount` + auth.users COALESCE | Deno T-6 (PASS) + SQL T-1/T-5 | ✓ (copy verified now) |
| SC-5 | Host push → business app; in-app row per member; host email when contact set | `business.`-prefix + fan-out + email leg | Deno T-7 (PASS) + SQL T-2 | ✓ (routing verified now) |
| SC-6 | Replay returns `idempotent_replay:true`, zero new rows | enqueue on non-replay branch + ON CONFLICT DO NOTHING | SQL T-4 | ✓ |
| SC-7 | No money/UI regression; paid-flip byte-identical | finalize body reproduced verbatim, additive-only (0 lines removed) | function diff below | ✓ |

Runnable-now proof: Deno unit test 6/6 PASS (T-6 copy + T-7 routing), strict-grep gate 7/7 self-test +
real PASS, existing shared-template test 5/5 + push-routing 4/4 (no regression). SQL T-1..T-8 are
hand-run against the linked remote AFTER apply.

---

## 3. Files changed (6 — all inside §8 allowlist)

| File | Type | Δ |
|------|------|---|
| `supabase/migrations/20261223000000_orch_1298_chip_in_receipt_enqueue.sql` | NEW | +213 |
| `supabase/functions/_shared/notifyTemplates.ts` | EDIT (2 cases before `default`) | +46 |
| `supabase/migrations/__tests__/orch_1298_chip_in_receipt_enqueue.test.sql` | NEW (T-1..T-5, T-8) | +268 |
| `supabase/functions/_shared/__tests__/orch_1298_contribution_receipt_templates.test.ts` | NEW (T-6, T-7) | +118 |
| `.github/scripts/strict-grep/i-proposed-1298-chip-in-receipt-enqueue.mjs` | NEW gate (self-test 7/7) | +230 |
| `.github/workflows/strict-grep-mingla-business.yml` | EDIT (registry line + job) | +14 |

`git status` confirms ONLY these 6; nothing out of scope staged.

---

## 4. Data-model changes applied by the migration

- **Two seeded `notification_categories`** (idempotent `ON CONFLICT (key) DO UPDATE`):
  - `buyer_contribution_receipt` — section `Purchases`, transactional, urgency `normal`,
    channels `{inapp,push,email}`, `reach_once`. Unprefixed → consumer OneSignal app.
  - `business.rsvp_contribution_received` — section `Payments`, transactional, urgency `normal`,
    channels `{inapp,push,email}`, `reach_once`. `business.`-prefixed → business OneSignal app.
  - **Neither carries `sms`** (DC-3 / I-PROPOSED-1161 closed SMS set preserved).
- **`finalize_rsvp_contribution(uuid,text,text,text)`** — `CREATE OR REPLACE` (signature unchanged, no
  DROP). ORCH-1291 body reproduced VERBATIM (proven: 0 lines removed) + 5 new DECLARE locals + the
  exception-safe enqueue block on the non-replay branch + an updated `COMMENT`.
- **No schema ALTER, no RLS change, no new columns.** `brands.contact_email` and
  `brand_team_members(role,removed_at,accepted_at)` already exist (verified).

### The enqueue block (verbatim intent — after the `status='paid'` UPDATE, before the final RETURN)

Nested `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING … END` (fail-soft — a notification failure
never rolls back the paid finalize). Resolves `v_event_title`, `v_guest_label` (`COALESCE(NULLIF(btrim(
guest_name),''),'Someone')`), `v_guest_email` (`COALESCE(guest_email, (SELECT email FROM auth.users
WHERE id = user_id))`), builds `v_guest_payload` (`contribution_id/event_id/event_title/amount_cents/
currency`) and `v_host_payload` (`|| guest_name`), then:

1. **Guest** — one `INSERT INTO public.notification_outbox` `('buyer_contribution_receipt', user_id,
   v_guest_email, brand_id, v_guest_payload, 'chip_in_receipt:'||id||':guest')` `ON CONFLICT
   (idempotency_key) DO NOTHING`.
2. **Host push/in-app** — one row `SELECT`ed per `brand_team_members` where
   `removed_at IS NULL AND accepted_at IS NOT NULL AND role IN ('brand_owner','brand_admin',
   'finance_manager')`, `contact=NULL`, key `'chip_in_receipt:'||id||':host:'||user_id`, `ON CONFLICT …
   DO NOTHING`.
3. **Host email** — one row from `brands` where `contact_email IS NOT NULL AND btrim(contact_email)<>''`,
   `user_id=NULL`, key `'chip_in_receipt:'||id||':host_email'`, `ON CONFLICT … DO NOTHING`.

### Finalize reproduction faithfulness (for the orchestrator's md5-verify)

- The `CREATE OR REPLACE FUNCTION … $function$` span md5 (this migration): **`1e37b9ad550194d2c4a5e38f8dd87c1c`** (7018 chars).
- Diff `ORCH-1291 finalize body` → `ORCH-1298 finalize body`: **0 lines removed, 108 added** (the 5
  DECLARE locals + the enqueue block + comments). The money math, the `SELECT … FOR UPDATE`, the
  idempotent early-return, and the `UPDATE … SET status='paid'` are byte-identical.
- Note: the applied `pg_get_functiondef` will be Postgres-normalized (whitespace/quoting), so an
  md5 of the applied text won't equal the above raw-span md5 — verify by structural equality (the
  original body verbatim + the additive enqueue), not raw-string md5.

---

## 5. Edge functions touched

None edited directly. The copy switch lives in the shared module `_shared/notifyTemplates.ts`, which is
BUNDLED by `notify-dispatch`. **Orchestrator must re-deploy `notify-dispatch`** (verify_jwt to preserve:
its current value — do NOT change it) so the new `renderCategoryMessage` cases ship. `notify-outbox-drain`
and the adapters are unchanged (no redeploy needed for them, though a redeploy is harmless).

---

## 6. Regression tests added + fails-on-revert

- **Deno unit** `supabase/functions/_shared/__tests__/orch_1298_contribution_receipt_templates.test.ts`
  — 6 tests, all PASS (T-6 guest+host gift copy currency-aware & no tax/invoice/VAT; T-7 host→business
  / guest→consumer routing).
- **SQL contract** `supabase/migrations/__tests__/orch_1298_chip_in_receipt_enqueue.test.sql` — T-1
  (guest enqueue), T-2 (host fan-out 3 + email, scanner excluded), T-3 (Paystack/NGN dual-rail), T-4
  (adversarial replay → 0 new rows), T-5 (logged-in null-guest_email COALESCE), T-8 (fail-soft). Each
  `BEGIN…ROLLBACK`, hand-run post-apply.
- **Strict-grep gate** `i-proposed-1298-chip-in-receipt-enqueue.mjs` — 3-arm static guard (enqueue+keys
  idempotent / both categories seeded no-sms / both template cases no tax-invoice), self-test 7/7 PASS.

**Fails-on-revert — PROVEN by true line deletion (both runnable artifacts):**

1. Deleted the enqueue block from the migration → strict-grep gate **FAILS** (exit 1, "migration is
   missing the chip_in_receipt enqueue"); restored → PASS (exit 0).
2. Deleted the guest `case "buyer_contribution_receipt"` from `notifyTemplates.ts` → Deno **FAILS**
   (2 guest tests fail as the switch falls to `default`); restored → 6/6 PASS.
   Both files verified byte-identical after restore (`diff -q` clean).

`fails-on-revert verified on the working tree at branch HEAD prior to commit` (baseline = SPEC commit
`7080350d9`). SQL T-1/T-4 are the paired live-fire guard the tester runs post-apply (revert of the
enqueue → T-1 0 guest rows; revert of the `status='paid'` early-return → T-4 replay reports
`idempotent_replay:false`).

---

## 7. Old → New receipts

### `supabase/migrations/…_orch_1298_chip_in_receipt_enqueue.sql` (NEW)
- **Before:** a paid chip-in flipped `status='paid'` and enqueued nothing — no receipt for anyone.
- **Now:** the same paid-flip additionally enqueues one guest receipt + host push/in-app (per member)
  + host email (when contact set), exception-safe, idempotent, both rails.
- **Why:** SC-1..SC-7; Seth's ask ("receipt for both guest and host").
- **Lines:** +213 (of which the finalize reproduction is verbatim + 108 additive).

### `supabase/functions/_shared/notifyTemplates.ts` (EDIT)
- **Before:** `renderCategoryMessage` had no case for the two new keys → they'd hit the generic `default`
  (bare `payload.title/body`, no amount, no gift voice).
- **Now:** two `case` branches render currency-aware, gift-framed push+email copy (guest thank-you;
  host "you got a gift"), NO tax/invoice/VAT language.
- **Why:** SC-4, SC-5; §4.4 copy.
- **Lines:** +46.

---

## 8. Cross-surface impact

| Surface | Affected? | What changes | Parity |
|---------|-----------|--------------|--------|
| Consumer iOS | Indirect | logged-in guest gets in-app+push+email "thanks" | automatic (server) |
| Consumer Android | Indirect | same | automatic |
| Buyer/anon Web | Indirect | anon guest gets the gift email (email only) | automatic |
| Business iOS | Indirect | host gets business push + in-app "{guest} chipped in {amount}" | automatic |
| Business Android | Indirect | same | automatic |
| Admin Web | No | not a recipient | — |
| Business Web preview | No | no preview surface change | — |

All reached via the shared SQL RPC + v2 pipeline — no per-surface app code, parity automatic. NO native
build / OTA (respects COMMS-0063: business fixes ship via native build only — this ships nothing to the
app; it's backend + edge copy).

---

## 9. Smoke / verification run

- Deno `orch_1298_contribution_receipt_templates.test.ts`: 6 passed / 0 failed.
- Deno `meta_orch_1161_subc_templates.test.ts` (imports the edited module): 5 passed / 0 failed (no regression).
- Deno `meta_orch_1074_push_routing.test.ts` (`--allow-env --allow-net`): 4 passed / 0 failed.
- `deno check supabase/functions/_shared/notifyTemplates.ts`: clean.
- strict-grep `i-proposed-1298-chip-in-receipt-enqueue.mjs`: self-test 7/7 + real PASS; fails-on-revert PASS.
- Drift check: remote `supabase_migrations.schema_migrations` head = `20261222000000` (= local frontier);
  no remote-only version; mine `20261223000000` is strictly greater — clean in-order apply, no `--include-all`.

---

## 10. Known issues / deferred

- **Smoke & Rhythm (`1ce63bf4-1a33-4309-ab0b-ec23343e3569`) has NO `contact_email`** (read-only checked:
  `has_contact_email=false`, default_currency USD). So on that brand the **host EMAIL leg is skipped
  fail-soft** — the host still gets push + in-app. **For Seth's host-email test, set a `contact_email`
  on that brand first (or use a brand that has one).**
- No refund/cancellation receipts (explicit non-goal — ORCH-1298-B fast-follow).
- `fmtAmount` uses a fixed `en-US` locale for grouping (currency itself is honored) — investigation D-2,
  non-blocking.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required (orchestrator / Seth — post-REVIEW)

1. **Apply the migration** (in-order, no `--include-all`):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1298-[chip-in-receipt-emails]" && /Users/sethogieva/bin/supabase db push --linked
   ```
2. **Re-deploy `notify-dispatch`** (bundles `_shared/notifyTemplates.ts`; preserve its `verify_jwt`):
   ```bash
   supabase functions deploy notify-dispatch --project-ref gqnoajqerqhnvulmnyvv
   ```
   Verify with one curl (expect a structured 4xx/JSON, not a 5xx bundle error).
3. **Run the SQL contract tests** against the linked remote:
   ```bash
   cat supabase/migrations/__tests__/orch_1298_chip_in_receipt_enqueue.test.sql | /Users/sethogieva/bin/supabase db remote sql --linked
   ```
   Expect T-1..T-5, T-8 all `PASS` NOTICEs (esp. T-1 guest row + T-4 replay 0-new).
4. Tester live-fires a real chip-in on BOTH rails (Stripe + Paystack/NGN); confirms guest email + host
   push/in-app arrive exactly once + a replayed webhook re-sends nothing. For the host EMAIL leg, ensure
   the test brand has a `contact_email`.

---

## 12. Discoveries for orchestrator

- **D-1 (from investigation, re-flagged):** seeded `payout_paid` category is `{inapp,push,sms}` and NOT
  `business.`-prefixed — a trap if ever migrated to the v2 push path (would target consumer). Not in
  ORCH-1298 scope; register for META-ORCH-1161 hygiene.
- **COMMS ledger:** scanned. No BLOCK+OPEN row targets this skill / ORCH-1298 / ALL. COMMS-0052 is
  RESOLVED; COMMS-0063 (WARN/ALL, business-OTA-bricks) factored — this ORCH ships NOTHING to the app
  (backend + edge copy), so it does not touch the OTA hazard. No new ledger entry warranted.
- **Host-email parity note (SPEC OQ#1, Seth-resolved YES):** this adds a host email beyond the
  ticket-sale host path (which is push+in-app only). Implemented as an additive fail-soft leg.
