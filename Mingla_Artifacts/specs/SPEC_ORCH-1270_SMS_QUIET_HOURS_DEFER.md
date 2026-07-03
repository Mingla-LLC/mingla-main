# SPEC — ORCH-1270 [SMS blast — all sends fail → quiet-hours DEFER]

Status: DRAFT (binding contract). Author: mingla-forensics (SPEC phase).
Worktree: `~/Desktop/mingla-orchs/1270-[sms-quiet-hours-defer]/` on branch `1270-sms-quiet-hours-defer`.
Investigation (ground truth): `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1270_SMS_BLAST_ALL_FAILED.md`.
Comms ledger checked on entry: no BLOCK+OPEN row addressed to this ORCH / SPEC / ALL. COMMS-0052 (BLOCK, ACKNOWLEDGED) noted — business-web ships via Vercel, NOT `eas update`; relevant to the composer half's deploy (see §11).

---

## 1. Executive summary (layman outcome)

When a business owner fires an SMS blast in the middle of the night, today the app permanently marks every recipient "failed" (because it's outside their local texting hours) and then lies to the owner that the campaign was "sent" — so nobody gets a text and nobody is ever retried. This change makes the app **hold** those out-of-hours recipients and **automatically send them the moment their local morning window opens** (8 AM–9 PM local), retrying safely without ever double-texting anyone. It also makes the campaign tell the truth: it only reports "sent" once at least one text actually went out, and it stays in a "waiting" state (or "failed") while nothing has been delivered. Finally, if the owner tries to send when the *entire* audience is currently outside texting hours, the composer warns them and offers a one-tap "schedule for the next window" instead of firing into a guaranteed zero-delivery send.

---

## 2. Scope, non-goals, affected surfaces

### In scope (CODE half only — operator approved)
- **RC-1** Quiet-hours recipients DEFER (retryable) instead of terminal `failed`; re-attempted in-window by the existing pg_cron re-invocation, idempotently.
- **RC-2** Campaign status reflects true outcome; never `sent` with `recipient_count = 0`.
- **RC-3** Composer pre-send guardrail: warn + offer "schedule for next window" when the whole audience is currently outside sending hours. Non-blocking.

### Explicit non-goals (DO NOT build)
- The `[OPS]` items from the investigation (RC-3/RC-4 there): flipping `MARKETING_SEND_LIVE_ENABLED`, `SMS_LIVE_ENABLED_US/_NG`, or Twilio A2P 10DLC registration. These are operator env/console actions, **not code**, and are OUT of this SPEC. The composer CANNOT read edge env flags, so the "live flags off" informational warning is NOT implemented client-side (stated in §7.3).
- RCS tab, email-preview changes, MMS — those are ORCH-1271/1272/1273. **Do not touch.**
- Email dispatch behavior — UNCHANGED except it inherits the shared campaign-status finalizer (§5.2), which is proven to preserve email's existing `recipient_count`/status semantics (§5.2 note). No email code path is edited.
- A stuck-`sending`-campaign sweeper (crash-mid-pass recovery). Pre-existing limitation, NOT introduced here (see §10 Risk R-4). Registered as a discovery for the orchestrator.

### Affected surfaces (full table in §3)
Backend `marketing-send` edge function + ONE forward-only migration (marketing_messages columns/enum/indexes + one SQL finalizer). Business composer UI (iOS / Android / business-web, shared RN code → automatic parity). **NOT** consumer, **NOT** admin, **NOT** buyer/anon web.

---

## 3. Cross-Surface Impact Declaration (HARD GATE)

| # | Surface | Covered? | User-visible behavior demanded | Files touched | Parity |
|---|---------|----------|-------------------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | — | none | n/a — marketing send is business-only |
| 2 | Consumer Android (`app-mobile/`) | NO | — | none | n/a |
| 3 | Buyer/anon Web (`mingla-business` `/checkout`, `/e/…`, `/b/…`, `/t/…`) | NO | — | none | n/a — not a buyer surface |
| 4 | Business iOS | YES | SMS blast defers out-of-hours recipients; composer warns when whole audience is out-of-window + offers schedule | `compose.tsx`, `ComposerReviewSheet.tsx`, new `smsSendWindow.ts` | shared RN → auto |
| 5 | Business Android | YES | same as iOS | same as iOS | shared RN → auto |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NO | — | none | n/a |
| 7 | Business Web preview (adjacent, react-native-web) | YES | same composer behavior (RN-web) | same RN files | shared RN → auto |
| — | Backend edge fn + DB | YES | defer state machine + honest campaign status | `marketing-send/index.ts`, one new migration | single source |

Business surfaces 4/5/7 share the same React Native code (composer + util), so parity is automatic; success criteria are NOT split per-surface for RC-3 (§5). Backend is a single source of truth for RC-1/RC-2.

---

## 4. Confirmed current behavior (re-derived from the WORKTREE — line numbers authoritative)

All paths in `supabase/functions/marketing-send/index.ts` (worktree copy) unless noted.

- **RC-1 site — quiet-hours permanent fail:** `sendSms`, lines **716–727**. `if (!isWithinQuietHours(phone, countryCode, now))` → `INSERT marketing_messages { status:'failed', failure_reason:'quiet_hours_deferred' }` then `continue`. No requeue, no next_attempt. Terminal fail.
- **RC-2 site — unconditional `sent`:** serve loop, lines **169–177**. After `dispatchByKind` returns, `UPDATE marketing_campaigns SET status='sent', sent_at=now(), recipient_count = outcome.recipients`. `outcome.recipients = sent + previewSkipped` (line 813). Quiet-hours-failed recipients are counted in NEITHER → `recipient_count = 0`, `status='sent'`.
- **Dispatch outcome:** `DispatchOutcome = { recipients, preview_skipped }` (lines 264–267); `sendSms` returns `{ recipients: sent + previewSkipped, preview_skipped }` (line 813).
- **Quiet-hours logic (KEEP — do not alter the tz map):** `US_AREACODE_TZ` (556–603), `resolveRecipientTz` (612–623), `isWithinQuietHours` (633–658). `resolveRecipientTz` returns `null` for unknown market / unrecognized US area code; `isWithinQuietHours` returns `false` for null tz (conservative deny). `QUIET_HOURS = { US:{8,21}, NG:{8,20} }` (61–64).
- **Cron / claim (KEEP UNCHANGED):** `supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql`. pg_cron job `orch_0815_b_marketing_send` runs `* * * * *`, POSTs `{}` with service-role bearer. `mkt_claim_campaigns(p_limit, p_campaign_id)` atomically flips up to 10 campaigns `status='scheduled' AND scheduled_for <= now()` → `'sending'` via `FOR UPDATE SKIP LOCKED … RETURNING`. **This helper is NOT modified by this SPEC** — the defer design re-uses the proven `scheduled→sending` atomic claim (see §6).
- **Schema (authoritative, `20260602000003_orch_0815_marketing_hub_phase_a.sql`):**
  - `marketing_campaigns.status` CHECK: `('draft','scheduled','sending','sent','failed','cancelled')` (line 205). `recipient_count integer` nullable (208). Index `idx_campaigns_scheduled_for … WHERE status='scheduled'` (226–228).
  - `marketing_messages.status` CHECK: `('queued','sent','delivered','opened','clicked','bounced','failed','unsubscribed','preview_skipped')` (281–285). Columns include `recipient_phone`, `channel`, `provider_message_id`, `sent_at`, `failure_reason`, `created_at`. `segments integer` added by `20261111000000_orch_1161_marketing_sms_segments.sql`. Index `idx_messages_campaign_status (campaign_id, status)` (298). marketing_messages INSERT/UPDATE = **service-role only** (no caller RLS) — the edge fn writes it.
- **Audience resolver (`_shared/marketingAudience.ts`):** dedups contacts into a `Map` keyed by lowercased buyer email; emits at most one `ResolvedContact` per email identity. Two identities sharing a phone would yield two rows with the same `raw_phone` (rare) → handled by the unique index in §6.4 (one text per phone, by design).
- **Composer send flow (`compose.tsx`):** `channel` state (`'email'|'sms'`); Send Now → `missingFieldsLabel` guard → `setSendMode('now')` → `setShowReview(true)` → `<ComposerReviewSheet … isSendNow onConfirm={handleConfirmSchedule}>`. `handleConfirmSchedule` (431–444) calls `scheduleMutation.mutate({ scheduled_for: now() … })`. "Send now" = schedule for `now()` so cron picks it up (`useScheduleCampaign` → `scheduleSend` sets `status='scheduled'`). `reach.reachable_sms` is available (line 715, 529).

---

## 5. Per-RC contract

### 5.1 RC-1 — Quiet-hours DEFER (the hard part)

**File:** `supabase/functions/marketing-send/index.ts`, function `sendSms` (660–814) + new pure helper.

**Required behavior.** Replace the terminal-fail branch (716–727) with a disposition decision. **Extract a pure, exported, DB-free helper** so the decision is unit-testable without a live Postgres:

```ts
// Illustrative signature ONLY (≤3 lines) — not an implementation.
type SmsDisposition =
  | { action: "send" }
  | { action: "defer"; next_attempt_at: string; attempt_count: number }
  | { action: "fail"; reason: "unknown_timezone" | "quiet_hours_unreachable" };
export function decideSmsDisposition(phone, countryCode, now, existing): SmsDisposition
```

`existing` = the current `marketing_messages` row for `(campaign_id, phone)` or `null`. Decision rules (exact):

1. **Already terminal** — if `existing` is non-null and `existing.status ∈ {sent, delivered, opened, clicked, failed, bounced, unsubscribed, preview_skipped}` → the caller SKIPS this recipient entirely (no write, no send). (Guard belongs in `sendSms`, not the pure helper; the helper is only called for fresh or `deferred` rows.)
2. **Unknown timezone** — if `resolveRecipientTz(phone, countryCode) === null` (unknown market or unrecognized US area code) → `{ action:"fail", reason:"unknown_timezone" }`. Do **NOT** defer — an unresolvable tz can never pass `isWithinQuietHours`, so deferring would loop forever. Terminal now, honestly.
3. **In window** — else if `isWithinQuietHours(phone, countryCode, now) === true` → `{ action:"send" }`.
4. **Out of window, resolvable tz** — else compute `attempt = (existing?.attempt_count ?? 0) + 1`; `ageMs = existing ? (now - existing.created_at) : 0`.
   - **Termination bound:** if `ageMs > MAX_DEFER_AGE_MS` (24 h) OR `attempt > MAX_DEFER_ATTEMPTS` (30) → `{ action:"fail", reason:"quiet_hours_unreachable" }`. (24 h guarantees every resolvable tz has had ≥1 in-window shot; 30 attempts is a belt-and-suspenders cap.)
   - Else `{ action:"defer", next_attempt_at, attempt_count: attempt }` where
     `hoursUntilOpen = ((startHour - localHour + 24) % 24)`; `next_attempt_at = now + max(hoursUntilOpen h, 5 min)`. This is APPROXIMATE and **self-correcting**: the next pass re-runs `isWithinQuietHours`, so a slightly-early estimate simply re-defers ~1 h. (`localHour`, `startHour` from the same Intl/`QUIET_HOURS` logic already in the file.)

**`sendSms` loop wiring (per deliverable contact, after the existing E.164 skip at 706–710):**
- SELECT the existing row for `(campaign.id, phone)` (single `.eq().eq().maybeSingle()` on `campaign_id` + `recipient_phone`). If terminal (rule 1) → `continue` (skip; idempotency guard).
- `const d = decideSmsDisposition(phone, countryCode, now, existing)`.
- `action:"fail"` → **UPSERT** terminal row `{ status:'failed', failure_reason: d.reason, recipient_phone, channel:'sms' }` (see §6.4 upsert). No provider call. `failed++`.
- `action:"defer"` → **UPSERT** `{ status:'deferred', next_attempt_at: d.next_attempt_at, attempt_count: d.attempt_count, failure_reason:'quiet_hours_deferred', recipient_phone, channel:'sms' }`. No provider call. `deferred++`. (`failure_reason` kept as an informational label; status carries the real meaning.)
- `action:"send"` → existing send path (rewrite links, compute segments, UPSERT `status:'queued'`, live gate, `smsAdapter.send`, then UPDATE terminal `sent`/`preview_skipped`/`failed`). On `sent` → `delivered++`. On skipped → `preview_skipped++`. On failed → `failed++`. Insert `marketing_clicks` only on the actual send pass (a deferred row wrote no clicks; each send re-runs `rewriteSmsLinks` producing fresh unique `tracking_id`s — no dup because a recipient sends at most once).

**`DispatchOutcome`** (264–267) becomes `{ delivered: number; deferred: number; failed: number; preview_skipped: number }`. `sendSms` returns these running counts (used only for the JSON response body). The campaign row is written by the finalizer (§5.2), not from these counts.

**Constants** (top of file, near `SMS_BATCH_SIZE`): `MAX_DEFER_AGE_MS = 24 * 60 * 60 * 1000`, `MAX_DEFER_ATTEMPTS = 30`, `MIN_DEFER_INTERVAL_MS = 5 * 60 * 1000`.

### 5.2 RC-2 — Honest campaign status (shared finalizer)

**Replace** the inline campaign UPDATE at serve-loop lines **169–177** with a single call:
`await supabase.rpc("mkt_finalize_campaign", { p_campaign_id: campaign.id });`
The catch block (185–203) is UNCHANGED (a *thrown* dispatch error — `audience_missing`, `sms_body_empty`, etc. — still sets `status='failed'`; quiet-hours no longer throws, so this path is only genuine config/DB errors).

**`mkt_finalize_campaign(p_campaign_id uuid) RETURNS text`** — new SQL function (see §6.3), computes counts from `marketing_messages` for the campaign and applies the EXACT status rule (cumulative across passes — correct under cron re-pick):

| Condition (evaluated in order) | campaign.status | recipient_count | sent_at | scheduled_for |
|---|---|---|---|---|
| `deferred > 0` | `scheduled` | `delivered` (running) | `NULL` | `MIN(next_attempt_at over deferred)`; fallback `now()+15m` |
| else `delivered > 0` | `sent` | `delivered` | `now()` | unchanged |
| else `preview_skipped > 0` | `sent` | `preview_skipped` | `now()` | unchanged |
| else (only failures / empty) | `failed` | `0` | (leave NULL) | unchanged |

Where `delivered = count(status ∈ {sent,delivered,opened,clicked})`, `deferred = count(status='deferred')`, `preview_skipped = count(status='preview_skipped')`, `failed = count(status ∈ {failed,bounced})`.

- **Invariant satisfied by construction:** `status='sent'` is only reached when `delivered>0` OR `preview_skipped>0`, so `recipient_count` is always `>0` on `sent` — **never `sent` with 0**.
- **`deferred>0` re-uses `status='scheduled'`** with a future `scheduled_for` — the EXISTING `mkt_claim_campaigns` re-picks it at the next window with NO helper change. Operator sees an honest "Scheduled for 8:00 AM" while the cohort drains.
- **Email is unchanged:** email never produces `deferred` rows; for a live email send `delivered>0` → `recipient_count=delivered` (identical to old `sent+preview` with `preview=0`); for preview-mode email `preview_skipped>0` → `recipient_count=preview_skipped` (identical to old). SMS live/preview cases likewise identical. ONLY the broken all-quiet-hours SMS case changes (0-count `sent` → honest `scheduled`/`failed`). No email file is edited.

**Operator-facing delivery summary.** No new campaign enum value; no status-badge UI change required (`deferred` cohort shows as `scheduled`). The delivery breakdown (delivered / deferred / preview_skipped / failed) is already derivable from `marketing_messages` status counts, which the Marketing Overview funnel queries independently (`mingla-business/src/types/marketing.ts` `MarketingOverviewFunnel`: `sent = IN('sent','delivered','clicked','preview_skipped')`, `failed = IN('failed','bounced')`). A `'deferred'` message row falls into NEITHER bucket → correctly shown as pending, not sent, not failed. **No overview code change needed** (verified against the formula); implementor adds `'deferred'` to the `MessageStatus` TS union only (§6.5).

### 5.3 RC-3 — Composer pre-send guardrail (non-blocking warn + schedule)

**New shared util** `mingla-business/src/utils/marketing/smsSendWindow.ts`:
- `export const SMS_QUIET_HOURS` = `{ US:{startHour:8,endHour:21}, NG:{startHour:8,endHour:20} }` — MUST equal the edge fn's `QUIET_HOURS` (drift test §7 T-9).
- `export const SUPPORTED_SMS_ZONES` = the distinct IANA zones with market tag: `America/New_York`, `America/Chicago`, `America/Denver`, `America/Phoenix`, `America/Los_Angeles`, `America/Anchorage`, `Pacific/Honolulu` (US), `Africa/Lagos` (NG).
- `export function isAnyMarketInSendWindow(now: Date): boolean` — true iff ≥1 supported zone's current local hour is inside its market window (uses `Intl.DateTimeFormat` hour, same technique as the edge fn). `false` ⇒ the whole audience is provably unreachable right now (sufficient condition regardless of audience tz mix).
- `export function nextGlobalSendWindowOpen(now: Date): Date` — the soonest instant at which SOME supported zone enters its window (min over zones of `now + hoursUntilOpen`). Powers the "Schedule for …" affordance.

**`compose.tsx` wiring:** in the existing `onSendNow` handler (footer, ~744–756) AND the `⌘`-shortcut `onSendNow` (~606–615), after the `missingFieldsLabel` guard, when `channel === 'sms'` compute `const outsideWindow = !isAnyMarketInSendWindow(new Date())` and stash `nextGlobalSendWindowOpen(new Date())` in state; pass both into `ComposerReviewSheet`. (Point-in-time check at tap; no live re-render needed.)

**`ComposerReviewSheet.tsx` new props (additive, optional):**
`smsOutsideWindow?: boolean`, `nextWindowLabel?: string`, `onScheduleForNextWindow?: () => void`.
When `isSendNow && smsOutsideWindow === true`, render a warning block ABOVE the actions row + a secondary CTA. **Exact copy:**
- Title: **"Outside texting hours right now"**
- Body: **"It's before 8 AM or after 9 PM local for your whole audience, so nothing sends this instant. Tap Send now and Mingla holds each text until that person's next morning window — or schedule it for {nextWindowLabel}."**
- Primary CTA stays **"Send now"** (non-blocking — RC-1 guarantees it safely defers).
- Secondary CTA: **"Schedule for {nextWindowLabel}"** → `onScheduleForNextWindow()`.

`onScheduleForNextWindow` (in `compose.tsx`): `setSendMode('schedule'); setScheduledForIso(nextGlobalSendWindowOpen(new Date()).toISOString());` then invoke the same confirm path (`handleConfirmSchedule` reads `sendMode`/`scheduledForIso`). `{nextWindowLabel}` uses the existing `scheduledLabel` locale format (short month/day + time).

Warning styling: reuse existing `ComposerReviewSheet` `styles.section` container with an accent border (`accent.border`) + `typography.bodySm` copy — no new design tokens. WCAG: the secondary CTA is a `Pressable` with `accessibilityRole="button"`, `accessibilityLabel={"Schedule for " + nextWindowLabel}`, min height 44.

**Non-goals for RC-3 (stated):** the composer does NOT check `MARKETING_SEND_LIVE_ENABLED` / `SMS_LIVE_ENABLED_*` (edge env, unreadable from client). `reachable_sms === 0` (empty audience) is NOT an RC-3 warning — it is handled honestly by RC-2's `failed` terminal.

---

## 6. Schema / migration spec (REQUIRED — one forward-only migration)

**File:** `supabase/migrations/20261203000000_orch_1270_sms_quiet_hours_defer.sql` (version strictly greater than the current latest `20261202000000_orch_1263_claim_adoption.sql`). Wrap in `BEGIN; … COMMIT;` with apply-time `DO $$ … RAISE EXCEPTION` probes matching the Phase-A style. All changes ADDITIVE + idempotent (`IF NOT EXISTS`). No data mutation (read-only guard only).

### 6.1 marketing_messages.status — add `'deferred'`
`ALTER TABLE public.marketing_messages DROP CONSTRAINT IF EXISTS marketing_messages_status_check;`
`ALTER TABLE public.marketing_messages ADD CONSTRAINT marketing_messages_status_check CHECK (status IN ('queued','sent','delivered','opened','clicked','bounced','failed','unsubscribed','preview_skipped','deferred'));`
(Re-adding the full list is required because the constraint is anonymous-named in Phase A as `marketing_messages_status_check` — confirmed by the Phase-A probe at line 574. Preserve that exact name so the existing probe still matches.)

### 6.2 marketing_messages — new columns
`ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;` (NULL except on `deferred` rows.)
`ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;`
`COMMENT ON COLUMN` each, citing ORCH-1270.

### 6.3 mkt_finalize_campaign — the RC-2 finalizer (SQL, service-role only)
`CREATE OR REPLACE FUNCTION public.mkt_finalize_campaign(p_campaign_id uuid) RETURNS text LANGUAGE plpgsql SET search_path TO public, pg_temp` — body implements the §5.2 table exactly (single grouped `count(*) FILTER (…)` + `min(next_attempt_at) FILTER (WHERE status='deferred')`, then the ordered `IF/ELSIF` UPDATE, `RETURN` the new status). `SECURITY INVOKER` (default). `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO service_role;` (mirror `mkt_claim_campaigns` grants — never granted to `authenticated`).

### 6.4 Idempotency indexes (the double-send guarantee)
Partial UNIQUE indexes (the structural anti-double-text backbone):
- `CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_msg_campaign_phone ON public.marketing_messages (campaign_id, recipient_phone) WHERE recipient_phone IS NOT NULL;`
- `CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_msg_campaign_email ON public.marketing_messages (campaign_id, recipient_email) WHERE recipient_email IS NOT NULL;`
Plus a re-selection helper index: `CREATE INDEX IF NOT EXISTS idx_mkt_msg_deferred_due ON public.marketing_messages (campaign_id, next_attempt_at) WHERE status = 'deferred';`

**Backfill / guard implication (READ-ONLY):** creating a UNIQUE index FAILS if duplicate `(campaign_id, recipient_phone)` or `(campaign_id, recipient_email)` rows already exist. Prod was wiped 2026-06-22 and holds only 2 SMS rows (distinct phones) + a handful of email rows, so the risk is low — but the migration MUST fail loudly, not silently. Precede each `CREATE UNIQUE INDEX` with a `DO $$` guard that `RAISE EXCEPTION`s with the offending keys if a duplicate group exists (a pure `SELECT … GROUP BY … HAVING count(*)>1` check — NO data mutation). If it fires, the operator/implementor dedups manually before re-running; this SPEC does not authorize any DELETE.

**UPSERT semantics used by `sendSms`:** all `marketing_messages` writes for SMS become `INSERT … ON CONFLICT (campaign_id, recipient_phone) DO UPDATE` (PostgREST `.upsert(row, { onConflict: 'campaign_id,recipient_phone' }).select('id,status')`). Because the in-loop guard (§5.1 rule 1) already skips terminal rows, and because campaign processing is serialized by the `scheduled→sending` atomic claim (§6 note), the upsert only ever transitions `∅→queued/deferred/failed` or `deferred→queued/deferred/failed` — never overwrites a terminal `sent` row in practice. The unique index is the last-line structural guarantee against any duplicate row under overlapping invocations.

### 6.5 TypeScript type (business)
`mingla-business/src/types/marketing.ts` — add `'deferred'` to the `MessageStatus` union (line 139–149). `CampaignStatus` is UNCHANGED (deferred cohort reuses `'scheduled'`).

### Why NO change to `mkt_claim_campaigns` / cron
The finalizer parks a deferred campaign back in `status='scheduled'` with `scheduled_for = next window`. The existing cron + `mkt_claim_campaigns` already re-pick `scheduled AND scheduled_for<=now()` and atomically flip to `'sending'`. That `scheduled→sending` transition is what serializes processing (a second invocation can't claim a `sending` campaign) — so re-using it gives re-entrancy + double-claim protection **for free**, with zero risk to the proven helper and zero new campaign enum value / UI status change. Modifying the helper to re-pick `sending` was rejected: it would break the transition-based single-processing guarantee AND force email idempotency changes (out of scope).

---

## 7. DRAFT invariants (namespaced `I-PROPOSED-1270-*`, flip ACTIVE on CLOSE)

Each = rule / enforcement / regression triad. Register strict-grep scripts per `feedback_strict_grep_registry_pattern.md`: edge-fn + migration scripts in `.github/workflows/supabase-migrations-and-stripe-deno.yml`; composer scripts in `.github/workflows/strict-grep-mingla-business.yml`. Script files under `.github/scripts/strict-grep/`.

- **I-PROPOSED-1270-QUIET-HOURS-DEFERS-NOT-FAILS**
  - Rule: an out-of-window recipient with a **resolvable** tz is written `status='deferred'` with a future `next_attempt_at`, NEVER terminal `failed`, on first out-of-window evaluation.
  - Enforcement: strict-grep `i-proposed-1270-quiet-hours-defers-not-fails.mjs` asserting `marketing-send/index.ts` contains `status: "deferred"` in the out-of-window branch and does NOT insert `status:'failed'` with `failure_reason:'quiet_hours_deferred'` (the old terminal pattern is gone) + `decideSmsDisposition` exists.
  - Regression: Deno unit test — `decideSmsDisposition` for a 415/Pacific number at 05:00 PT returns `action:'defer'`, `next_attempt_at>now`; fails-on-revert (revert to terminal-fail → the runtime + grep tests fail).

- **I-PROPOSED-1270-NO-EMPTY-SENT**
  - Rule: a campaign is NEVER `status='sent'` with `recipient_count=0`; `sent` requires `delivered>0` OR `preview_skipped>0`.
  - Enforcement: migration apply-time `DO $$` probe asserting `mkt_finalize_campaign` exists + a SQL test (§8) exercising the count matrix; strict-grep `i-proposed-1270-no-empty-sent.mjs` asserting the finalizer's ordered branches + that `marketing-send/index.ts` calls `mkt_finalize_campaign` (and no longer inline-UPDATEs `status:"sent"` in the success path).
  - Regression: SQL/pg test — insert only `deferred` rows → finalize → campaign `scheduled` (not `sent`); only `failed` rows → `failed`; ≥1 `sent` row → `sent` with `recipient_count>0`. Fails-on-revert (restore inline `status='sent'` → grep + SQL test fail).

- **I-PROPOSED-1270-SEND-IDEMPOTENT**
  - Rule: a recipient with an existing terminal-success row is never re-dispatched; no recipient ever gets two dispatched SMS for one campaign under cron re-invocation.
  - Enforcement: migration probe asserting `uq_mkt_msg_campaign_phone` + `uq_mkt_msg_campaign_email` exist; strict-grep `i-proposed-1270-send-idempotent.mjs` asserting the in-loop terminal-skip guard + `.upsert(` with `onConflict: 'campaign_id,recipient_phone'` in `sendSms`.
  - Regression: Deno test — two sequential dispatch passes over a mixed-tz audience with a mock adapter → each recipient has exactly ONE terminal row and the adapter was called exactly once per recipient. Fails-on-revert (drop the guard/index → duplicate send detected).

---

## 8. Test requirements

### 8.1 Implementor MUST write (happy-path + fails-on-revert)
1. **Deno — RC-1 disposition** (`supabase/functions/marketing-send/`, new `orch-1270-defer.test.ts`): `decideSmsDisposition` matrix — in-window→send; out-of-window resolvable→defer (next_attempt_at>now, attempt_count increments); unknown tz→fail(unknown_timezone); age>24h→fail(quiet_hours_unreachable); attempt>30→fail. Fails-on-revert anchored on the exported helper + `status:"deferred"`.
2. **Deno — RC-3 idempotency** (same file): two passes, mock adapter, assert single terminal row + single call per recipient; a recipient with a pre-existing `sent` row is skipped.
3. **SQL — RC-2 finalizer** (`supabase/migrations/__tests__/orch_1270_finalize_campaign.test.sql`, matching existing `.test.sql` style): the §5.2 status matrix incl. the never-`sent`-with-0 assertion and the `deferred>0 → scheduled + scheduled_for=min(next_attempt_at)` path.
4. **Business — RC-3 util** (`mingla-business/src/utils/__tests__/smsSendWindow.test.ts`): `isAnyMarketInSendWindow` true/false at boundary instants (e.g., the ORCH-1270 04:39 UTC dead-of-night → false; a 15:00 UTC instant → true via US morning/NG afternoon); `nextGlobalSendWindowOpen` returns the soonest zone open.
5. **Business — composer warning** (`mingla-business/src/components/marketing/__tests__/orch_1270_review_sheet_warning.test.tsx`): `ComposerReviewSheet` renders the warning + "Schedule for …" CTA only when `isSendNow && smsOutsideWindow`; the CTA fires `onScheduleForNextWindow`.
6. **UPDATE existing test (append-only gate)** — `supabase/functions/marketing-send/index.test.ts` lines ~42–43 assert `SOURCE.includes("quiet_hours_deferred")` as the SMS-leg contract. The RC-1 change keeps `quiet_hours_deferred` as an informational `failure_reason` on `deferred` rows, so the string survives — BUT the surrounding intent must be re-annotated. Add a `[TEST-MOD-APPROVED ORCH-1270]` comment (mirroring the existing `[TEST-MOD-APPROVED ORCH-1161]` at line 17) and extend the assertion to require `status: "deferred"` in the source (proving defer, not terminal fail). This edit REQUIRES the test-append-only gate token per `feedback_test_append_only_gate.md`.

### 8.2 T-9 drift guard
Cross-file test (`smsSendWindow.test.ts` or a dedicated file) asserting the client `SMS_QUIET_HOURS` values equal the edge fn's `QUIET_HOURS` (read both source files, compare the {US,NG}×{start,end} tuples). Prevents the two copies drifting.

### 8.3 Tester adversarial angles (mingla-tester — do not skip)
- **Double-send (highest priority):** simulate cron re-pick across a mixed-tz audience; some in-window, some deferred; run pass 1 then pass 2 (window advanced) → assert NO recipient has two provider calls or two terminal rows. Probe the unique index directly (attempt a duplicate insert → expect constraint violation).
- **Timezone boundary:** 07:59 vs 08:00 vs 20:59/21:00 local; a DST-transition instant; unrecognized US area code → fail(unknown_timezone); +234 at WAT midnight → defer with next_attempt_at ≈ next 08:00 WAT.
- **Termination:** a perpetually-out-of-window recipient (frozen clock / unknown tz) becomes terminal `failed` within the 24 h / 30-attempt bound; the campaign reaches a terminal state and does NOT loop in `scheduled` forever.
- **RC-2 honesty:** all-quiet-hours audience → campaign is `scheduled` (never `sent`) until a window opens, then `sent` (delivered>0) or `failed` (all unreachable); assert it is NEVER `sent` with `recipient_count=0`.
- **Concurrency:** two overlapping `marketing-send` invocations on the same due campaign → claimed once (extend existing T-B10).
- **Live-fire cap:** per `feedback_biz_web_authed_runtime_unreachable_cap_claims.md`, the authed biz-web SMS send path can't be driven to real Twilio here; source + Deno unit + SQL-fire is the ceiling — state PASS-by-mechanism, do not claim a real Twilio send.

---

## 9. Implementation order

1. **Migration** `20261203000000_orch_1270_sms_quiet_hours_defer.sql` (§6.1–6.4) + apply-time probes. (Orchestrator deploys/applies at CLOSE, not the implementor — see memory `feedback_orchestrator_deploys_edge_functions`.)
2. **Edge fn** `marketing-send/index.ts`: extract `decideSmsDisposition`; rewrite `sendSms` loop (§5.1) with the terminal-skip guard + upsert; extend `DispatchOutcome`; swap serve-loop `status='sent'` UPDATE for `mkt_finalize_campaign` RPC (§5.2).
3. **Types** `mingla-business/src/types/marketing.ts` — add `'deferred'` to `MessageStatus`.
4. **Composer util** `mingla-business/src/utils/marketing/smsSendWindow.ts` (§5.3).
5. **Composer wiring** `compose.tsx` + `ComposerReviewSheet.tsx` (§5.3).
6. **Tests** (§8) incl. the `[TEST-MOD-APPROVED ORCH-1270]` update.
7. **Strict-grep scripts** + workflow registration (§7).

### Scoped allowlist (implementor MAY edit ONLY these)
- `supabase/functions/marketing-send/index.ts`
- `supabase/migrations/20261203000000_orch_1270_sms_quiet_hours_defer.sql` (new)
- `supabase/functions/marketing-send/orch-1270-defer.test.ts` (new), `supabase/functions/marketing-send/index.test.ts` (gated update ONLY at ~42–43)
- `supabase/migrations/__tests__/orch_1270_finalize_campaign.test.sql` (new)
- `mingla-business/src/types/marketing.ts` (MessageStatus union only)
- `mingla-business/src/utils/marketing/smsSendWindow.ts` (new) + `mingla-business/src/utils/__tests__/smsSendWindow.test.ts` (new)
- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`
- `mingla-business/src/components/marketing/ComposerReviewSheet.tsx` + `mingla-business/src/components/marketing/__tests__/orch_1270_review_sheet_warning.test.tsx` (new)
- `.github/scripts/strict-grep/i-proposed-1270-*.mjs` (new ×3) + the two workflow YAMLs (registration only)

### DO-NOT-TOUCH (stop-and-amend before editing)
`smsAdapter.ts` (adapter contract is correct — the kill-switch is an OPS concern, not this fix); `20260603000000_orch_0815_b_marketing_send_cron.sql` / `mkt_claim_campaigns` (re-used unchanged); `sendEmail` and any email path; `marketingAudience.ts`; `useScheduleCampaign.ts` / `marketingCampaignService.ts` (the `scheduled` reuse needs no service change); RCS/MMS/email-preview code; consumer/admin/buyer-web. Any change outside the allowlist requires a `SPEC_AMENDMENT_ORCH-1270_*.md`.

---

## 10. Risks / open decisions

- **R-1 (accepted):** deferred cohort re-uses `status='scheduled'`. A mid-delivery campaign therefore appears in the "scheduled" list and is technically editable/cancellable via the composer (`scheduleSend`/`cancelScheduled` accept `scheduled`). Editing mid-blast would give already-sent recipients the old body and deferred recipients the new body — an inconsistency, NOT a double-send (the unique index still holds). Low probability (defer windows are hours; the composer isn't the natural place to revisit a firing blast). Documented; a follow-up guard (lock edits once any `sent`/`deferred` row exists) is a candidate future ORCH, out of scope here.
- **R-2 (accepted, self-correcting):** `next_attempt_at` is an approximate hours-until-open estimate (no tz→UTC library in Deno). The next pass re-runs `isWithinQuietHours`, so an early estimate simply re-defers ~1 h. Correctness is unaffected; only efficiency (a few extra passes) is.
- **R-3 (decision made):** unknown-tz / unrecognized-area-code recipients become terminal `failed(unknown_timezone)` immediately rather than deferring forever. This is a behavior change from today's "defer(as failed) permanently" but is honest and bounded. Confirm acceptable — the alternative (defer + 24 h age-out) wastes cron cycles for a recipient that can never pass the window check.
- **R-4 (pre-existing, out of scope, registered):** a crash between claim (`scheduled→sending`) and finalize strands a campaign in `sending` (cron never re-picks `sending`). This already exists for email today (no sweeper). The defer design adds more passes (more crash windows) but does not change the failure mode. Recommend a follow-up "reclaim stale `sending` campaigns" sweeper (would require adding email idempotency first). Flag to orchestrator as a discovery.
- **Open Q-1:** recipient_count semantics. This SPEC keeps `recipient_count = delivered` (or `preview_skipped` in preview mode) to preserve email parity and satisfy the never-`sent`-with-0 invariant. If the product wants `recipient_count` to mean "total attempted incl. deferred," say so — it would change the finalizer table. Default assumption: delivered-count (honest "people who received it").

---

## 11. Downstream routing

- **Next → mingla-implementor (backend + business).** Build §5–§9 in the worktree `~/Desktop/mingla-orchs/1270-[sms-quiet-hours-defer]/` on branch `1270-sms-quiet-hours-defer`. Honor the allowlist + DO-NOT-TOUCH. Deploy note: the composer half is business-web + native RN; per COMMS-0052 (ACKNOWLEDGED) web ships via Vercel, NOT `eas update` — it rides the next native build for iOS/Android. The edge fn + migration are deployed/applied by the orchestrator at CLOSE.
- **Then → mingla-tester** for the §8.3 adversarial angles (double-send + tz-boundary are the gates), source+unit+SQL-fire with the live-fire cap stated.
- **Then → mingla-orchestrator** to flip the three `I-PROPOSED-1270-*` invariants ACTIVE, apply the migration to `gqnoajqerqhnvulmnyvv`, deploy `marketing-send`, verify with one curl, and CLOSE. The `[OPS]` env-flag + Twilio A2P actions from the investigation remain a separate operator checklist (NOT part of this code CLOSE).
