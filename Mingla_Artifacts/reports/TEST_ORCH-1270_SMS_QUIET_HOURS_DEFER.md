# TEST — ORCH-1270 [SMS quiet-hours DEFER + honest status + double-send guards]

Author: mingla-tester (adversarial QA gatekeeper). Worktree:
`~/Desktop/mingla-orchs/1270-[sms-quiet-hours-defer]/` on branch `1270-sms-quiet-hours-defer`
(HEAD under test `a485c3fc9`; tester commit `acab94b04`).

## VERDICT: CONDITIONAL PASS

All six specified behaviors (RC-1 defer, RC-2 honest status, termination bounds,
TZ boundaries, email non-regression, composer note) are PROVEN correct with real
runtime evidence — Deno unit tests against the ACTUAL shipped `decideSmsDisposition`,
and SQL fired against a real Postgres 17 with the real migration applied. The
double-send backbone (unique index + upsert + terminal-skip) holds under normal
cron re-invocation and rejects duplicate rows at the DB level.

**Condition:** one MEDIUM, LATENT double-send hole survives (F-DS-1 below): the
post-send terminal `marketing_messages` UPDATEs are error-unchecked, so a lost
terminal update (a DB error that returns rather than throws) after a SUCCESSFUL
adapter send leaves a non-terminal `'queued'` orphan; if a deferred sibling
re-parks the campaign to `scheduled`, cron re-picks and re-dispatches that
recipient — a second text. This does not break the specified normal-operation
behavior and cannot fire while SMS is dark (`SMS_LIVE_ENABLED_*` off), but it
contradicts the implementation report's absolute "no recipient is EVER texted
twice" claim and should be hardened before SMS goes live.

Live-fire cap (honored, per `feedback_biz_web_authed_runtime_unreachable_cap_claims`):
real Twilio and the authed biz-web send path cannot be driven here. Ceiling reached =
source + Deno unit (real exported fn) + SQL-fire on real Postgres. Adapter-dispatch
claims are PASS-BY-MECHANISM (no real Twilio send asserted).

---

## Per-angle evidence

### Angle 1 — Double-send (HIGHEST priority)

**1a — Two sequential passes, mixed-tz audience, mock adapter (idempotency).**
Covered by the implementor's Deno two-pass test (re-verified green). I did NOT
re-run it as my own; instead I attacked different layers (1b/1c/D-1 on real DB,
plus the fault-path F-DS-1).

**1b — Direct duplicate insert on real Postgres 17 → REJECTED.**
`docker postgres:17` + base schema + REAL migration `20261203000000`. A second
`INSERT (campaign_id, recipient_phone) = (c, '+14155550000')` raises
`unique_violation`. Actual: `ADV-1b PASS: duplicate (campaign_id, recipient_phone) rejected`.

**1c — NON-partial index (deviation D-1) is safe.** Actual output:
- `ADV-1c(i) PASS: 2 email rows (NULL phone, distinct emails) coexist` — NULLs distinct, no false collision.
- `ADV-1c(ii) PASS: duplicate (campaign_id, recipient_email) rejected`.
- `ADV-1c(iii) PASS: distinct-phone NULL-email rows coexist` — email index does not false-collide on NULL.
- `D-1 PASS: ON CONFLICT (campaign_id, recipient_phone) inferable by NON-partial index; 1 row; created_at preserved`.

**D-1 deviation was FORCED, not a weakening.** I recreated the index as PARTIAL
(the SPEC §6.4 original form) and re-ran the mandated upsert:
`PARTIAL_RESULT: SQLSTATE=42P10 (ON CONFLICT cannot infer partial index) — D-1 deviation FORCED`.
So the non-partial index was the only way to keep the upsert working; it still
rejects true duplicates (1b/1c(ii)) and preserves `created_at` across the conflict
update (termination age accrues — proven, D-1 PASS).

**F-DS-1 (MEDIUM, LATENT) — see Defects.** On the real DB I proved the enabling
step: a `queued` orphan + a `deferred` sibling → `mkt_finalize_campaign` re-parks
the campaign to `scheduled` (`LOST-UPDATE PROBE: ... RE-PARKED to scheduled (re-pickable)`).
`queued` is NOT in `SMS_TERMINAL_STATUSES`, so the re-pick re-runs
`decideSmsDisposition` → in-window → `send` → a second adapter call to a recipient
who was already texted.

### Angle 2 — Timezone boundary (against the REAL exported `decideSmsDisposition`)

16 boundary tests, imported from the shipped `index.ts` (the implementor's test
RE-IMPLEMENTS the logic — this closes that gap). Actual: **16 passed / 0 failed**.
- US EDT: hour 07 → DEFER, hour 08 → SEND, hour 20 → SEND, hour 21 → DEFER (endHour exclusive).
- US EST (winter, offset not hard-coded to summer): hour 07 → DEFER, hour 08 → SEND.
- NG: hour 19 → SEND, hour 20 → DEFER (NG window is 8–20). NG WAT midnight (23:00Z) →
  DEFER with `next_attempt_at` exactly +8h = 07:00Z = **08:00 WAT** (asserted UTC hour == 7).
- Unrecognized US area code (500) → `fail(unknown_timezone)`; +44/null country → `fail(unknown_timezone)` — NOT infinite defer.
- US DST spring-forward instant (2026-03-08T07:00Z) → no throw, valid action.

### Angle 3 — Termination (exact boundaries, real fn)

- `attempt_count 29` → attempt 30, `30 !> 30` → DEFER (still retryable).
- `attempt_count 30` → attempt 31, `31 > 30` → `fail(quiet_hours_unreachable)`.
- age `23h59m` → DEFER; age `24h01m` → `fail(quiet_hours_unreachable)`.
Once every recipient is terminal (`deferred = 0`), the finalizer no longer re-parks
to `scheduled` (proven by CASE C/F below) → the campaign reaches a terminal state and
does not loop in `scheduled` forever.

### Angle 4 — RC-2 honesty (finalizer count matrix, real Postgres)

Implementor finalizer test re-run green: **CASE A–F ALL PASS** (A deferred→scheduled rc=0
scheduled_for=MIN(next_attempt) sent_at NULL; B deferred+delivered→scheduled rc=running;
C failures→failed; D delivered→sent rc>0; E preview→sent; F empty→failed, **never
sent-with-0**). My additional probe: a `queued`-only campaign →
`QUEUED-ONLY finalize → status=failed` (queued counts in no bucket → ELSE=failed, rc=0),
so the never-`sent`-with-0 invariant holds even for an orphaned in-flight row.

### Angle 5 — Email regression

`mkt_finalize_campaign` is channel-agnostic and preserves email semantics: CASE D
(`delivered>0 → sent`, rc=delivered — identical to old `sent+preview` with preview=0)
and CASE E (`preview_skipped → sent`, rc=preview — identical to old). Source review:
`sendEmail` never calls `decideSmsDisposition` and only writes
`queued/sent/failed/preview_skipped` — **no email row can be `deferred`**. The D-2
return-shape change (`{delivered:sent, deferred:0, failed:0, preview_skipped}`) feeds
only the JSON response body; the finalizer recomputes truth. PASS.

### Angle 6 — Composer

Source + jest (source-contract; RTL deps not committed). The F-1 fix turned the
originally-dead conditional warning into an ALWAYS-ON informational note for an SMS
send-now (`smsInfoNote={channel === "sms"}`). Verified: note renders on
`isSendNow && smsInfoNote === true`; exact "How SMS timing works" copy; secondary CTA
`onScheduleForNextWindow` wired in `compose.tsx` to `scheduleMutation.mutate({...,
scheduled_for: nextGlobalSendWindowOpen(now)})`; WCAG ≥44 px + button role/label.
jest: **10 passed / 0 failed**. (F-1's zone-set spec-design issue is documented in the
impl report and does not affect the shipped always-on note.)

---

## Test run output (actual)

- Deno, full `marketing-send/` suite (incl. my 16 boundary tests, importing the real fn): **53 passed / 0 failed**.
- Business jest (`smsSendWindow.test.ts` + `orch_1270_review_sheet_warning.test.tsx`): **10 passed / 0 failed**.
- Real Postgres 17 (docker): base + REAL migration applies clean; idempotent RE-APPLY clean (`COMMIT`, no error);
  implementor finalizer CASE A–F **ALL PASS**; tester double-send attacks (1b/1c/D-1) **ALL PASS**; partial-index → **42P10**.
- `deno check` on the tester boundary test: clean.

## Tester-authored adversarial tests + fails-on-revert (Step 0.5 SATISFIED)

Two NEW files, committed on the branch (`acab94b04`), different angle than the implementor's:

1. `supabase/functions/marketing-send/orch-1270-tester-boundaries.test.ts` — imports
   the **REAL exported** `decideSmsDisposition` (implementor re-implements it) and drives
   exact tz-flip + termination boundaries.
   **Fails-on-revert (proven):** transiently flipped the RC-1 defer branch to terminal
   fail (in `decideSmsDisposition`, the final `return { action: "defer", ... }` →
   `return { action: "fail", reason: "quiet_hours_unreachable" }`). Result: **7 DEFER
   assertions FAILED** (9 passed / 7 failed). Product code restored via `git checkout`
   (verified `git diff` empty).

2. `supabase/migrations/__tests__/orch_1270_tester_double_send.test.sql` — direct attack
   on the real unique indexes + D-1 upsert.
   **Fails-on-revert (proven):** `DROP INDEX public.uq_mkt_msg_campaign_phone` then re-run
   → the duplicate insert is ACCEPTED → `ERROR: ADV-1b FAIL: duplicate (campaign,phone)
   ACCEPTED — double-send index broken`, **psql exit 3**.

---

## Defects

### F-DS-1 — MEDIUM (LATENT) — double-send via lost terminal UPDATE + deferred sibling

**Where:** `supabase/functions/marketing-send/index.ts` — the post-send terminal
`marketing_messages` UPDATEs at ~lines 961–971 (`status:'sent'`), ~972–983
(`failed`/`preview_skipped`), and the email twins ~561–579. Each is
`await supabase.from("marketing_messages").update({...}).eq("id", messageId)` with the
returned `{ error }` **discarded** (unlike the upsert/insert calls above them, which
check and throw).

**Failure scenario (concrete):**
1. Recipient A is in-window → row upserted `queued` → `smsAdapter.send()` returns
   `sent` (**text #1 delivered**) → the `.update({status:'sent'})` returns a
   PostgREST/DB error (e.g. statement timeout / serialization / transient) — which
   supabase-js surfaces as `{ error }`, NOT a throw. Error is unchecked; `delivered++`
   runs anyway; the row stays `'queued'`.
2. Recipient B in the same campaign is out-of-window → `'deferred'`.
3. `mkt_finalize_campaign`: `delivered` counts only `sent/delivered/opened/clicked`
   (A is `queued`, uncounted) → `deferred>0` → campaign re-parked to `'scheduled'`
   with a future `scheduled_for` (**proven on real DB: LOST-UPDATE PROBE**).
4. Cron re-picks. A's row is `'queued'` → NOT in `SMS_TERMINAL_STATUSES` → not
   skipped → `decideSmsDisposition` → in-window → `send` → **text #2 to A**.

The three double-send guards do not close this: the unique index/upsert prevent a
second ROW (same row is updated in place), and the terminal-skip guard does not fire
on `'queued'`. R-4 (crash-before-finalize) does NOT cover this — here finalize DOES
run and re-parks the campaign.

**Severity rationale:** MEDIUM/latent — requires (a) SMS live (`SMS_LIVE_ENABLED_*`
on; currently dark), (b) a terminal UPDATE that errors without throwing, precisely
after a successful adapter send, and (c) ≥1 deferred sibling in the same campaign.
Low probability, but the consequence is the exact #1 property under test (a customer
texted twice) plus a `delivered` count that overcounts.

**Suggested hardening (not applied — product code is read-only for QA):** check the
error on the post-send terminal UPDATEs and throw on failure (which strands the
campaign in `sending`, matching the accepted R-4 crash mode and preventing re-pick),
or treat a pre-existing `queued` row as in-flight/terminal in the loop guard. One
of these should land before `SMS_LIVE_ENABLED_*` is flipped on.

## Notes / scope

- Concurrency (two overlapping invocations claimed once) relies on the unchanged,
  DO-NOT-TOUCH `mkt_claim_campaigns` (`scheduled→sending` atomic claim); not re-tested
  here (out of scope for ORCH-1270).
- Migration is additive/idempotent and applies + re-applies clean on real Postgres 17;
  all apply-time probes pass.
- No product code was modified by QA; only two test files were added and committed.
