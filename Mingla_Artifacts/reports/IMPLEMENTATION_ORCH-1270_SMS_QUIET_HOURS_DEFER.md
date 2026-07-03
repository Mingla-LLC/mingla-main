# IMPLEMENTATION — ORCH-1270 [SMS quiet-hours DEFER + honest campaign status]

Author: mingla-implementor. Worktree: `~/Desktop/mingla-orchs/1270-[sms-quiet-hours-defer]/`
on branch `1270-sms-quiet-hours-defer`. Built to SPEC §5–§9 (binding). NOT deployed / NOT
merged (orchestrator does that at CLOSE).

---

## 1. Layman outcome

A late-night SMS blast no longer lies. Out-of-hours recipients are now **held and
auto-re-sent** when their local morning window opens (never double-texted), the campaign
only says **"sent"** once a text actually went out (otherwise it honestly shows "scheduled"
while it waits, or "failed" if nobody was reachable), and the composer is wired to warn +
offer "schedule for the next window" before a blind send. The #1 safety property — **no
recipient is ever texted twice** — is enforced three ways (in-loop skip + upsert + a DB
unique index) and was proven end-to-end against a real Postgres 17.

Two spec-design issues were found and are flagged for forensics (see §5); neither harms the
user, and RC-1's defer makes any "Send now" safe regardless.

---

## 2. What changed, per file

### Backend (single source of truth)

**`supabase/migrations/20261203000000_orch_1270_sms_quiet_hours_defer.sql`** (NEW) — forward-only,
additive, idempotent, `BEGIN…COMMIT` with apply-time `DO $$ RAISE EXCEPTION` probes (Phase-A style):
- §6.1 re-adds the full `marketing_messages_status_check` (same anonymous name) + `'deferred'`.
- §6.2 adds `next_attempt_at timestamptz` + `attempt_count integer NOT NULL DEFAULT 0` (+ COMMENTs).
- §6.3 `mkt_finalize_campaign(uuid) RETURNS text` implementing the §5.2 ordered table
  (`deferred>0 → scheduled + scheduled_for=MIN(next_attempt_at); delivered>0 → sent; preview>0 →
  sent; else → failed`). `SECURITY INVOKER`, `search_path` pinned, `REVOKE ALL FROM PUBLIC` +
  `GRANT EXECUTE TO service_role` (mirrors `mkt_claim_campaigns`).
- §6.4 read-only `DO $$` duplicate guards (RAISE, no DELETE) preceding each UNIQUE index, then
  `uq_mkt_msg_campaign_phone`, `uq_mkt_msg_campaign_email`, and `idx_mkt_msg_deferred_due`.
- Apply-time probes assert the enum value, columns, function, grant matrix (service_role yes /
  authenticated no), and all 3 indexes.

**`supabase/functions/marketing-send/index.ts`** (MODIFIED):
- Added constants `MAX_DEFER_AGE_MS`, `MAX_DEFER_ATTEMPTS`, `MIN_DEFER_INTERVAL_MS` and the
  exported `SMS_TERMINAL_STATUSES` list near `QUIET_HOURS`.
- Added the exported pure helper `decideSmsDisposition(phone, countryCode, now, existing)`
  implementing §5.1 rules 2–4 exactly (rule 1 lives in the loop).
- `DispatchOutcome` → `{ delivered, deferred, failed, preview_skipped }` (§5.1).
- Rewrote the `sendSms` per-recipient loop: SELECT the existing row → terminal-skip guard →
  `decideSmsDisposition` → `fail`/`defer` UPSERT (no provider call) / `send` path with an UPSERT
  queued row; all SMS writes `.upsert(row, { onConflict: "campaign_id,recipient_phone" })`.
- Serve loop: replaced the RC-2 inline `status='sent'` campaign UPDATE with
  `await supabase.rpc("mkt_finalize_campaign", { p_campaign_id })` (+ error throw). Thrown-error
  catch block UNCHANGED.

### Business (shared RN → iOS / Android / business-web parity)

- **`mingla-business/src/types/marketing.ts`** — added `'deferred'` to the `MessageStatus` union
  ONLY (`CampaignStatus` unchanged).
- **`mingla-business/src/utils/marketing/smsSendWindow.ts`** (NEW) — `SMS_QUIET_HOURS`,
  `SUPPORTED_SMS_ZONES` (8 zones), `isAnyMarketInSendWindow`, `nextGlobalSendWindowOpen` per §5.3.
- **`ComposerReviewSheet.tsx`** — 3 additive optional props (`smsOutsideWindow`, `nextWindowLabel`,
  `onScheduleForNextWindow`); warning block (exact §5.3 copy) rendered only when
  `isSendNow && smsOutsideWindow === true`; secondary CTA `Pressable` (role=button, label, minHeight 44);
  reuses `styles.section` shape + `accent.border` (no new tokens).
- **`compose.tsx`** — imports the util; state `smsOutsideWindow`/`nextWindowIso`; `captureSmsSendWindow()`
  at both Send-now taps (footer + ⌘-shortcut); `handleScheduleForNextWindow()`; `nextWindowLabel`
  via the existing `scheduledLabel` locale format; passes the 3 props to `ComposerReviewSheet`.

### Tests + CI

- `supabase/functions/marketing-send/orch-1270-defer.test.ts` (NEW) — §8.1 items 1+2.
- `supabase/migrations/__tests__/orch_1270_finalize_campaign.test.sql` (NEW) — §8.1 item 3.
- `mingla-business/src/utils/__tests__/smsSendWindow.test.ts` (NEW) — §8.1 item 4 + §8.2 T-9 drift.
- `mingla-business/src/components/marketing/__tests__/orch_1270_review_sheet_warning.test.tsx` (NEW) — §8.1 item 5.
- `supabase/functions/marketing-send/index.test.ts` (MODIFIED, gated) — §8.1 item 6: added
  `[TEST-MOD-APPROVED ORCH-1270]` comment + extended the assertion to require `status: "deferred"`.
  Only the ~2-line quiet-hours block was touched.
- 3 strict-grep scripts `.github/scripts/strict-grep/i-proposed-1270-*.mjs` (NEW, each `--self-test`).
- `.github/workflows/supabase-migrations-and-stripe-deno.yml` — registered the 3 gates as a new
  `orch-1270-strict-grep` job, registered `orch-1270-defer.test.ts` in the notification-deno-tests
  array, and added `supabase/functions/marketing-send/**` + the gate glob to the trigger paths.

---

## 3. Test run output (actual)

- **`deno check` edge fn:** clean (0 errors).
- **Deno** (`index.test.ts` + `orch-1270-defer.test.ts`): **23 passed / 0 failed**. Full marketing-send
  batch incl. the two existing quiet-hours-tz files: **37 passed / 0 failed**.
- **SQL finalizer** (docker `postgres:17`, fixture + migration): migration applies clean, idempotent
  re-apply OK, **all 6 finalizer CASES PASS** (A deferred→scheduled, B deferred+delivered→scheduled rc=running,
  C failures→failed, D delivered→sent rc>0, E preview→sent, F empty→failed never-sent-with-0).
- **Double-send probe** (docker, against the real migration index): edge-fn-style
  `ON CONFLICT (campaign_id,recipient_phone)` upsert → exactly 1 row, deferred→queued; email null-phone
  rows coexist; a raw duplicate INSERT is rejected with `unique_violation`. **PASS.**
- **Business jest** (`smsSendWindow.test.ts` + `orch_1270_review_sheet_warning.test.tsx`): **12 passed / 0 failed**.
- **Strict-grep** (all 3): `--self-test` PASS + live-run PASS.
- **`tsc --noEmit` (business):** 727 errors — IDENTICAL to the origin/main baseline (stashed check). My
  4 touched/new business files produce **0** errors. No new type errors introduced.

---

## 4. Fails-on-revert proofs (each cites the revert point)

| Behavior | Revert applied | Result | Restored |
|---|---|---|---|
| RC-2 finalizer (SQL) | ran finalizer test WITHOUT the migration | `ERROR: column "next_attempt_at" ... does not exist` (psql exit 3) | n/a (migration present) |
| RC-1 defer (Deno + grep) | `status:"deferred"` → `status:"failed"` in the defer upsert | Deno: 2 anti-revert tests FAIL; grep `defers-not-fails`: exit 1 (2 findings) | ✅ restored |
| RC-2 no-empty-sent (grep) | finalizer RPC → inline `marketing_campaigns … status:"sent"` UPDATE | grep `no-empty-sent`: exit 1 (both conditions fire) | ✅ restored |
| RC-3 idempotency (grep) | self-test BAD_A (guard removed) + BAD_B (upsert removed) | each yields ≥1 failure; live SQL probe proves the unique index rejects duplicates | n/a (fixtures) |
| RC-3 composer copy (jest) | title copy `Outside texting hours right now` → `Heads up` | composer jest test FAILs | ✅ restored |
| T-9 drift (jest) | client `SMS_QUIET_HOURS.US.endHour` 21 → 22 | T-9 drift test FAILs | ✅ restored |

All reverts were restored; the final full suite is green (§3).

---

## 5. Spec deviations & findings (justified)

**D-1 — Unique indexes made NON-partial (empirically required for the upsert to work).**
SPEC §6.4 wrote `uq_mkt_msg_campaign_phone`/`_email` as PARTIAL (`WHERE recipient_* IS NOT NULL`).
PostgREST `.upsert(row, { onConflict: "campaign_id,recipient_phone" })` (which §6.4 also mandates)
emits `ON CONFLICT (campaign_id, recipient_phone)` with **no predicate**, and Postgres 17 CANNOT
infer a partial unique index without its predicate — it errors `42P10` on every SMS write (verified
in a docker `postgres:17` harness: partial index → 42P10; non-partial → succeeds). A NON-partial
unique index IS inferable and, because Postgres treats NULLs as DISTINCT by default, still permits
unlimited NULL-phone (email) / NULL-email (SMS) rows per campaign — **functionally identical** to the
partial index for the double-send guarantee. Index names + the migration probe + the tester's direct
duplicate-INSERT check are all preserved. This was the only way to keep the #1 correctness property
(the upsert) working while honoring the rest of §6.4 verbatim.

**D-2 — `sendEmail` return-shape adaptation (forced by §5.1, behavior-neutral).** §5.1 mandates
`DispatchOutcome` become `{ delivered, deferred, failed, preview_skipped }`, and `sendEmail` returns a
`DispatchOutcome`. Its final `return` line was adapted to `{ delivered: sent, deferred: 0, failed: 0,
preview_skipped }`. Email SEND logic, audience, gating, and DB writes are 100% unchanged; the counts
feed only the JSON response body (the finalizer recomputes truth from `marketing_messages`). This is a
type-conformance edit the spec transitively requires, not a change to the DO-NOT-TOUCH email path's behavior.

**F-1 (SPEC-DESIGN, flagged for forensics — RC-3 warning can never fire).** With `SUPPORTED_SMS_ZONES`
spanning Hawaii (UTC-10) through Lagos (UTC+1), the union of the per-market windows covers **all 24 UTC
hours** (Hawaii 18:00→07:00 UTC ∪ Lagos 07:00→19:00 UTC = 24 h), so `isAnyMarketInSendWindow` returns
`true` for **every instant** (verified summer + winter). Therefore `smsOutsideWindow = !isAnyMarketInSendWindow`
is always false and the composer warning + "Schedule for …" affordance never actually render;
`nextGlobalSendWindowOpen` always returns ~now. This is a **spec-design flaw in §5.3's zone set**, not an
implementation bug — I built RC-3 exactly as specified (no redesign, per the hard guards). The plumbing is
correct and fully tested with explicit props; it will light up the moment forensics narrows the zone scope
(e.g. to the audience's actual markets, or excluding HI/AK). **No user harm:** RC-1's defer makes a blind
"Send now" safe anyway. The util test asserts the ACTUAL behavior (the spec's "04:39 UTC → false" example is
incorrect for this zone set — at 04:39 UTC Hawaii is 18:39 and Anchorage 20:39, both in-window).

**Routing note (strict-grep + tests).** §7 named `supabase-migrations-and-stripe-deno.yml` for the
edge/migration gates; that workflow had no strict-grep runner and did not watch `marketing-send`. I added an
`orch-1270-strict-grep` job + the `marketing-send/**` trigger path there (honoring §7's routing) and
registered the Deno defer test in its notification-deno-tests array so both actually enforce in CI. All 3
§7 invariants are edge/migration (none composer), so nothing was added to `strict-grep-mingla-business.yml`;
the composer regression guard is the source-contract jest test. The SQL finalizer `.test.sql` follows the
existing hand-run/verification convention (the migrations-apply job + my migration's apply-time probes are
the CI-enforced migration check). The composer render test is a SOURCE-CONTRACT test because
`@testing-library/react-native` + `react-test-renderer` are not committed deps (per
`feedback_biz_web_authed_runtime_unreachable_cap_claims` — source-contract is the honest ceiling).

---

## 6. Scope adherence

Edited ONLY §9 allowlist files. DO-NOT-TOUCH set untouched: `smsAdapter.ts`, the cron/`mkt_claim_campaigns`
migration, `sendEmail` logic (only the type-forced return shape — D-2), `marketingAudience.ts`,
`useScheduleCampaign.ts`/`marketingCampaignService.ts`, RCS/MMS/email-preview, consumer/admin/buyer-web.
Migration NOT applied, edge fn NOT deployed, NOT merged.

**Double-send guarantee: IN PLACE and proven** — in-loop terminal-skip guard + `.upsert(onConflict:
campaign_id,recipient_phone)` + the DB unique index, verified end-to-end (§3 double-send probe).

---

## 7. Commits on the branch

`git log --oneline origin/main..HEAD`:

```
68eccb06c ORCH-1270: SMS quiet-hours DEFER + honest campaign status + double-send guards
```

(A follow-up commit amends this report with the hash above; run `git log --oneline` for the
authoritative final list.)

---

## 8. F-1 fix — dead conditional warning → always-on informational note

**Finding.** F-1 (§5) was a real dead-code defect, not just a spec-design note: the composer's
RC-3 pre-send warning was gated on `!isAnyMarketInSendWindow(now)`, which is **always false**
(SUPPORTED_SMS_ZONES span Honolulu UTC-10 … Lagos UTC+1, unioning to all 24 UTC hours), so the
warning + "Schedule for …" affordance NEVER rendered. Rather than redesign the zone set, the
honest fix keeps the genuinely-useful information but stops pretending it's conditional: the note
is now **always shown** for an SMS "Send now", framed as neutral info (off-hours recipients are
held and auto-sent in their next window — nothing is lost), with the still-useful "Schedule for
the next window" secondary CTA retained.

**What changed (composer-only; backend RC-1/RC-2/RC-3 untouched):**

- **`mingla-business/src/utils/marketing/smsSendWindow.ts`** — removed the dead
  `isAnyMarketInSendWindow` predicate (no remaining caller). Kept `nextGlobalSendWindowOpen`
  (labels + drives the CTA), `SMS_QUIET_HOURS`, and `SUPPORTED_SMS_ZONES` (T-9 drift guard).
  Header comment rewritten to document the F-1 removal.
- **`mingla-business/src/components/marketing/ComposerReviewSheet.tsx`** — prop
  `smsOutsideWindow?` → `smsInfoNote?`; derived predicate `showOutsideWindowWarning`
  (`isSendNow && smsOutsideWindow`) → `showSmsInfoNote` (`isSendNow && smsInfoNote === true`).
  Copy changed to the approved neutral **"How SMS timing works"** title + body ("Texts only send
  during each recipient's local hours (8 AM–9 PM). Anyone outside that window right now is
  automatically held and sent in their next morning window — nothing is lost. You can also
  schedule the whole blast for {label}."). Styles `warning*` → neutral `info*` (border swapped
  from `accent.border` to `glass.border.profileBase` so it no longer reads as an alarm). The
  "Schedule for {label}" secondary CTA (role=button, ≥44 px) is unchanged.
- **`mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`** — dropped the
  `isAnyMarketInSendWindow` import and the `smsOutsideWindow` state; `captureSmsSendWindow()` now
  only captures `nextWindowIso` (for the CTA label). The review sheet is passed
  `smsInfoNote={channel === "sms"}` (always-on for SMS send-now) instead of the old conditional.
- **Tests updated** — `orch_1270_review_sheet_warning.test.tsx` now asserts the always-on note,
  the new prop/predicate names, the exact new copy, the wired CTA, the 44 px target, AND that the
  dead `isAnyMarketInSendWindow`/`smsOutsideWindow` symbols are gone. `smsSendWindow.test.ts`
  dropped the `isAnyMarketInSendWindow` always-true assertions; kept `nextGlobalSendWindowOpen`
  behavior, `SUPPORTED_SMS_ZONES`, and the **T-9 drift guard** (all still fail-on-revert).

**Guards honored.** Edited only the 3 source files + 2 test files in the F-1 allowlist. Backend
edge function, migration, `marketing.ts` types, and strict-grep scripts untouched (verified no
strict-grep script references the changed copy/symbols). No broken conditional reintroduced — the
note is intentionally always-on for SMS send-now.

**Test output (actual, from the worktree):**
- `jest smsSendWindow.test.ts orch_1270_review_sheet_warning.test.tsx --runInBand` → **10 passed / 0 failed** (2 suites).
- `tsc --noEmit` (business) → **727 errors, identical to the origin/main baseline** (§3); **0** in the 3 touched files.
- Fails-on-revert re-proven: mangling the "How SMS timing works" title → copy test FAILS; drifting client `SMS_QUIET_HOURS.US.endHour` 21→22 → T-9 drift test FAILS. Both restored; suite green.

**F-1 fix commit:** `__F1_COMMIT__`
