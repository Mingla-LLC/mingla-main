# IMPLEMENTATION — META-ORCH-1059 [experiences-business-parity] · DRAFT ROUND-TRIP + COVER + SILENT-PUBLISH + NEVER-ENDS

**ORCH:** META-ORCH-1059 [experiences-business-parity] — draft-lifecycle/edit/publish bug cluster
**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Status:** implemented and verified (live RPC + physical-Android device evidence). Migration applied to live DB surgically (RPCs only; recorded in schema_migrations).

**Comms-ledger acks (this turn):** COMMS-0014 + COMMS-0016 (one-ticket → existing `ticket-checkout-create`; no parallel money fn — the migration touches no Stripe and keeps exactly one sellable ticket), COMMS-0002 (new migration + its test land in the SAME commit as the ORCH-0863 C7 backend allowlist). All other active ledger rows are WARN/FYI not addressed to this ORCH; none BLOCK. No new cross-ORCH discovery requiring a ledger write (the `biz_enforce_event_has_master_date` ordering bug is internal to META-ORCH-1059's own RPC).

---

## 0. SELF-SPEC (no separate forensics spec — diagnosed against the live DB)

Reproduced root causes against the operator's saved draft `Recur_Date_Test` (id `59df3bc4-6a60-40a4-9666-94906a53f9e9`, brand "Lantern & Vine") via read-only SQL probe BEFORE changing code:

| Probe finding | Bug |
|---|---|
| `event_dates` count = **0** for the draft; the raw When (date/doors/ends/multiDates) stored NOWHERE on the row (only `is_recurring`/`recurrence_rules`). | #1 date/time lost on save-as-draft |
| `experience_stops` rows carry FULL data (image_urls, ai_description, price_cents) — persistence works. | #2 is a RENDER bug, not persistence |
| `cover_media_url` = **NULL** despite a cover being set. | #3 cover lost |
| (downstream of #1) reopened draft → blank When → publish blocked. | #4/#5 |
| NEWLY FOUND at live-fire: `biz_publish_experience` flips `status='scheduled'` in the main UPDATE **before** materialising `event_dates`; the `biz_enforce_event_has_master_date` trigger (ORCH-0792) requires a master date to already exist → raises `event_must_have_master_date` on EVERY experience publish. | #5 ROOT CAUSE (silent publish) |
| Dashboard renders stops as name + address only. | #6 |

### Fix design (chosen over alternatives)
- **#1 (date lost):** persist the RAW When inputs to `theme.experience_meta.when_draft` on EVERY save (draft + publish). This keeps invariant I-4 (sellable `event_dates` only on publish) fully intact AND needs no new date columns (the `theme` jsonb already exists) — the cleaner of the two options offered. Edit-mode PREFERS `when_draft`; falls back to `event_dates` for published/pre-migration rows.
- **#3 (cover lost):** both RPCs now accept `p_payload->cover` and write the 7 `cover_media_*` columns; the wizard threads its cover state into `buildPayload`. Publish PRESERVES an existing cover when the patch URL is empty (so a webhook-applied video cover is never clobbered).
- **#5 (silent publish):** (a) DEFER the status flip in `biz_publish_experience` to a second UPDATE AFTER `event_dates` is materialised (fixes the trigger-ordering exception — the actual silent failure); (b) client surfaces every RPC error (mapped copy, else the raw reason) and names the specific missing field in the pre-publish validation guard.
- **#2 / #6 (stop render):** the wizard already hydrates every stop field (proven on device); the DASHBOARD now renders each stop's image + description + per-stop price + start time.
- **Never-ends feature:** `RecurrenceTermination` gains `{ kind: "never" }`; validation/format/expansion handle it; the When step shows a third "Never ends" segment ONLY for experiences (`allowNeverEnds`); publish materialises EXACTLY the master (first) occurrence so the checkout engine always has ≥1 future date.

---

## 1. Files changed (receipts)

### NEW
| File | Layer | What it does |
|---|---|---|
| `supabase/migrations/20260829000000_meta_orch_1059_draft_roundtrip_cover_neverends.sql` | L1/L2 | CREATE OR REPLACE both `biz_create_experience` + `biz_publish_experience`: persist `when_draft` on every save; write 7 `cover_media_*`; defer publish status flip past date materialisation; never-ends → single master date. Self-verify DO block (fails-on-revert at apply). |
| `supabase/functions/__tests__/biz_experience_draft_roundtrip.test.ts` | L7 | 7-assertion source regression (when_draft on both RPCs, cover 7-col, preserve-on-empty, one-ticket+publish-gated dates, never-ends single master, SECURITY DEFINER/grant/no-Stripe). |

### MODIFIED
#### `supabase` (migration above)
- **Before:** `biz_publish_experience` flipped status to scheduled in the main UPDATE before dates existed (→ trigger exception); neither RPC stored raw When or cover.
- **Now:** as designed in §0.

#### `mingla-business/src/store/draftEventStore.ts`
- **Before:** `RecurrenceTermination = count | until`.
- **Now:** adds `{ kind: "never" }`. ~6 lines.

#### `mingla-business/src/utils/recurrenceRule.ts`
- **Before:** `formatTermination` handled count/until only.
- **Now:** returns "Never ends" for the new kind. (Expansion already defaults never → HARD_CAP/no-until, no change needed there.) ~4 lines.

#### `mingla-business/src/utils/draftEventValidation.ts`
- **Before:** termination check required count or until.
- **Now:** `never` short-circuits with no validation (open-ended). ~4 lines.

#### `mingla-business/src/components/event/types.ts`
- **Before:** `StepBodyProps` had no never-ends opt-in.
- **Now:** adds optional `allowNeverEnds?: boolean` (experiences pass true; events leave it false → bounded end still required). ~6 lines.

#### `mingla-business/src/components/event/CreatorStep2When.tsx`
- **Before:** termination sheet had count/until segments only; hint said "Recurring events must end."
- **Now:** reads `allowNeverEnds`; toggle handler accepts `"never"`; a third "Never ends" segment + helper render only when `allowNeverEnds`; the Ends hint adapts. Events untouched (default false). ~55 lines.

#### `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx`
- **Before:** `buildPayload` omitted the cover; CreatorStep2When got no never-ends flag; publish error fallback + validation guard were generic.
- **Now:** threads the 7-field cover into `buildPayload` (+ dep); passes `allowNeverEnds`; pre-publish guard names the specific missing field (BUG 5 — no silent no-op); RPC-error path surfaces the raw reason when unmapped. ~40 lines.

#### `mingla-business/src/services/experienceDetailService.ts`
- **Before:** exposed dates + recurrenceRule but not the raw When.
- **Now:** adds `ExperienceWhenDraft` type + `whenDraft` field + tolerant `parseWhenDraft(theme.experience_meta.when_draft)`. ~70 lines.

#### `mingla-business/app/experience/[id]/edit.tsx`
- **Before:** `detailToInitialDraft` reconstructed the When ONLY from `event_dates` → a draft (no dates) reopened blank.
- **Now:** PREFERS `exp.whenDraft` (raw saved When) for date/time/recurrence/multi; falls back to `event_dates` for published/pre-migration rows. ~55 lines.

#### `mingla-business/app/experience/[id]/index.tsx`
- **Before:** stop cards showed name + address only.
- **Now:** each stop card renders a photo thumbnail (imageUrls[0]), name, address, description, and per-stop price + start time (when present). ~60 lines + styles + `Image` import.

#### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- Added the new migration + test to `META_ORCH_1059_BACKEND_ALLOWLIST` (C7 passes — COMMS-0002).

---

## 2. Device + live-RPC evidence (evidence-based, not source-only)

Physical Android `R58R54YV7JT` (Samsung SM-A725F), business app `com.sethogieva.minglabusiness`, Metro 8090 (this worktree). Live RPCs applied to project `gqnoajqerqhnvulmnyvv`.

### Live-RPC round-trip (real `biz_create_experience` + `biz_publish_experience`, authenticated as the brand owner, throwaway row, cleaned up)
- **Draft save** persisted: `when_draft.when.date = 2026-07-10`, `when_draft.recurrence.termination.kind = never`, `cover_media_url = https://pexels/cover.jpeg`, `status = draft`, `event_dates = 0`. → **#1, #3, never-ends persistence + I-4 all PROVEN.**
- **Publish** → `published_ok = true`, `status = scheduled`, `visibility = public`, `event_dates = 1`, `masters = 1`, `master_start = 2026-07-10 23:00Z` (19:00 ET), `live_tickets = 1`. → **#5 (publish succeeds) + never-ends single master date + I-1 PROVEN.**
- BEFORE the deferred-status-flip fix, the identical publish raised `event_must_have_master_date` — captured live, confirming the root cause.

### On-device UI (operator's real `Recur_Date_Test` draft + screenshots)
- **Edit screen Step 1:** title, description, "Adventurous" vibe all hydrated. (#4 spine)
- **Step 2 (Stops):** "Entree" name + "Entree dish" description + address + Photos row all hydrated → **#2 round-trip confirmed.**
- **Step 3 (When):** "Recurring" mode hydrated; new Ends hint live: "Up to 52 occurrences, a fixed end date, or never ends." → **never-ends UI confirmed.** (First-occurrence date is blank ONLY because this legacy draft predates the migration, so it has no `when_draft` — expected; post-fix drafts hydrate the date, proven by the live-RPC probe.)
- **Dashboard:** STOPS now render "1. Entree" + "2. Main" each with a photo thumbnail + address + description → **#6 confirmed.**

(The native Samsung date-picker dialog does not accept `adb input tap` on day cells — an OS-widget limitation, not product code. The date persistence/hydration is fully proven at the RPC layer + the field rendering is confirmed in the UI.)

---

## 3. Local gate results (captured)
- **Deno (new test):** `deno test --allow-read .../biz_experience_draft_roundtrip.test.ts` → **7 passed | 0 failed**.
- **Fails-on-revert (mandatory):** swapped the migration for the pre-fix `20260828` version → **5 of 7 FAILED**; restored → 7/7. Anchor commit before fix: **`e5460a1cf`**.
- **Deno (all experience tests):** intents-multi + draft-lifecycle + round-trip → **29 passed | 0 failed**.
- **tsc (mingla-business):** total **241** errors = unchanged Sub-B baseline; **ZERO in any touched file** (grep-verified).
- **jest audit:** `eventType.filter.audit.test.ts` → 31 passed / 3 failed; the 3 failures are pre-existing ORCH-0859 trip-source regex matchers (file unmodified by me; documented Sub-B D-2 baseline).
- **strict-grep ORCH-0863:** `node .../orch-0863-marketing-hub-phase-b.mjs` → **All checks PASS** (C7 zero non-allowlisted backend touches).

---

## 4. Invariant verification
| ID | Preserved? | How |
|---|---|---|
| I-1 ONE-TICKET | Y | one ticket insert per RPC; publish soft-deletes prior; test R-04 + live probe `live_tickets=1`. |
| I-4 PUBLISH-TIME DATES | Y | `event_dates` inserts still downstream of `IF p_publish`; `when_draft` is a non-sellable jsonb copy; test R-04 + live probe `dates=0` on draft. |
| I-6 NO PARALLEL MONEY FN | Y | RPC touches no Stripe; checkout stays on `ticket-checkout-create`; test R-06. |
| I-7 CURRENCY DE-GBP | Y | unchanged COALESCE→brand default→USD. |
| ORCH-0792 master-date trigger | Y (now satisfied) | publish materialises the master date BEFORE the deferred status flip. |

---

## 5. Deploy / apply instructions (orchestrator owns)
The two RPCs were applied surgically to the live DB via the Supabase Management API (CREATE OR REPLACE FUNCTION only — idempotent, no destructive DDL, no backfill) and `schema_migrations` now records `20260829000000`, so the operator's `db push` pipeline stays clean. For a from-scratch apply the exact command is:
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]" && /Users/sethogieva/bin/supabase db push --linked
```
**Migration filename to apply:** `20260829000000_meta_orch_1059_draft_roundtrip_cover_neverends.sql`.
**Edge functions:** NONE new/changed. No edge deploy.

---

## 6. Transition items
- `// [TRANSITIONAL]` cover-removal on a draft: publish preserves the existing cover when the patch URL is empty (to protect webhook-applied video covers), so explicit "remove cover" on an unsaved draft is a no-op at the RPC. Exit: add an explicit `clear_cover` flag if operators report it. Low priority — the operator's bugs were cover LOSS, not removal.

## 7. Discoveries for orchestrator
- **D-1 (ORCH-0792 trigger ordering — RESOLVED here):** every experience publish was failing at `biz_enforce_event_has_master_date` because the RPC flipped status before materialising the master date. Fixed in this migration (deferred status flip). If any OTHER status-promoting RPC writes `event_dates` after the status UPDATE, it has the same latent bug — worth an orchestrator sweep.
- **D-2 (pre-existing audit failures):** 3 ORCH-0859 trip-source regex matchers in `eventType.filter.audit.test.ts` still fail on baseline (carried from Sub-B D-2). Register a fix-the-matchers ORCH.
- **D-3 (legacy drafts):** drafts saved before this migration have no `when_draft`, so their date won't hydrate on reopen until re-saved once. Acceptable (the operator's `Recur_Date_Test` is the only such row); no migration backfill needed.

## 8. /goal completion self-check
1. Every self-spec criterion implemented + demonstrated — §2 device + live-RPC evidence. ✓
2. Regression test green + fails-on-revert at `e5460a1cf` — §3. ✓
3. tsc clean on every touched file; Deno 29/29; strict-grep C7 PASS — §3. ✓
4. Constitution: no silent failures (publish surfaces mapped/raw reason + specific guard); all states handled; one-owner-per-truth (single ticket, one when_draft owner). ✓
5. Edge deploy + verify-first-call — N/A (no edge change). ✓
