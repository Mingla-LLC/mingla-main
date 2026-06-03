# IMPLEMENTATION — META-ORCH-1059 [experiences-business-parity] · Pass 3 (final lifecycle track) · Sub-E — edit-after-publish buyer-protection guards

**ORCH:** META-ORCH-1059 Sub-E
**Branch:** `meta-orch-1059-experiences-business-parity`
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]`
**Status:** implemented and verified (test-level: client guard + server-contract regression both PASS + fails-on-revert; sim smoke note below)
**Date:** 2026-06-03

---

## Goal

Protect existing buyers when a brand edits a LIVE / scheduled experience, mirroring the proven TRIP edit-after-publish protection (ORCH-0876 `biz_update_live_trip` + `publishedTripEditGuards.ts` + `EditAfterPublishTripBanner.tsx`), adapted to experience semantics (stops + the ONE ticket + dates). Draft edits keep the existing wizard flow unchanged.

---

## Comms ledger (read on entry)

Relevant active entries acknowledged and factored:
- **COMMS-0002** (WARN, ALL) — new migration → ORCH-0863 C7 `no-new-backend-files` allowlist in the SAME commit. **Done:** the new migration `20260902000000_..._sub_e_update_live_experience.sql` + its Deno regression test are added to `META_ORCH_1059_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in this same commit; C7 verified green.
- **COMMS-0003** (WARN, ALL) — external-API docs cited inline. **Done:** the migration header cites Supabase SECURITY DEFINER / RLS / RPC / PostgREST schema-reload docs URLs for every backend construct introduced.
- **COMMS-0014 / COMMS-0016** (WARN) — experiences route money through `ticket-checkout-create`; no parallel money fn. **Honoured:** this RPC touches NO Stripe/payment surface; it only rewrites the single sellable `ticket_types` row the existing engine reads (I-1 / I-6). Asserted by Deno test E-07.
- COMMS-0018 (WARN, META-ORCH-1009) — Sub-F source reconciliation; informational, does not affect this guard work.

No new cross-ORCH discovery this turn → no new COMMS entry written.

---

## What was built

### 1. `mingla-business/src/utils/publishedExperienceEditGuards.ts` (NEW)
Client-side UX fast-path mirroring the server RPC's refund-gate. Exports:
- `validateLiveExperienceFieldUpdate(exp, patch, totalConfirmedOrders, reason)` → `{ok:true, trimmedReason}` | `{ok:false, reason, affectedOrderCount?, droppedDates?, droppedStops?}`.
- `liveExperienceRejectCopy(reason, affectedOrderCount?)` → human inline copy.
- Types `LiveExperiencePatch`, `UpdateLiveExperienceRejectReason`, `LiveExperienceFieldValidationResult`.

**Reject reasons (experience-adapted; trip-only `days_dropped`/`inclusions_removed` dropped):**
| reason | when |
|---|---|
| `missing_edit_reason` | empty reason |
| `invalid_edit_reason` | reason <10 or >200 chars |
| `experience_not_editable_status` | status not `scheduled`/`live` (a DRAFT never trips the live guards) |
| `capacity_below_sold` | ticket capacity dropped below confirmed sold |
| `price_change_with_sales` | the ONE ticket's resolved price (whole **or** per-stop sum) changed while sold>0 — locked after first sale |
| `dates_shifted_with_sales` | occurrence add/remove/shift while sold>0 |
| `stop_removed_with_sales` | an existing (by-name) stop removed while sold>0 (editing/adding/reordering stays allowed) |

### 2. `supabase/migrations/20260902000000_meta_orch_1059_sub_e_update_live_experience.sql` (NEW — **apply this**)
Mirror of `biz_update_live_trip`'s migration, three constructs:
- `experience_edit_log` — append-only audit table (owner-read RLS; **no** INSERT/UPDATE/DELETE policy → only the SECURITY DEFINER RPC writes; `reason` CHECK 10–200).
- `biz_experience_sold_count(p_event_id)` — total confirmed (non-failed/non-cancelled) `order_line_items.quantity` sum. Same source the client guard reads.
- `biz_update_live_experience(p_event_id, p_payload, p_reason)` — SECURITY DEFINER RPC. Same auth + `event_manager` permission gate + `event_type='experience'` assertion + status gate as `biz_publish_experience`; runs the refund-gate against ACTUAL orders; applies allowed changes (events row + `experience_stops` replace + the ONE `ticket_types` **UPDATE-in-place** + `event_dates` re-materialise); inserts the audit row; returns `{ok, severity, changed_keys, edit_log_entry_id, affected_order_count, event, stops, ticket, eventDates}` on success or `{ok:false, reason, affected_order_count?, dropped_dates?, dropped_stops?}` on reject.

**Additive, safe:** `CREATE TABLE IF NOT EXISTS` + `CREATE OR REPLACE FUNCTION`; no destructive DDL. Self-verify `DO` block + `NOTIFY pgrst`.

**ONE-TICKET invariant (I-1) preserved + strengthened:** unlike publish (soft-delete + re-insert), the live RPC **UPDATEs the single live ticket in place** so existing `order_line_items.ticket_type_id` references stay valid for prior buyers. Zero new `ticket_types` INSERTs (asserted Deno E-07).

### 3. `mingla-business/src/components/experience/EditAfterPublishExperienceBanner.tsx` (NEW)
Orange "you're editing a live experience" banner (mirror of `EditAfterPublishTripBanner.tsx`) **with the required reason `TextInput` folded in** (the trip banner is copy-only; Sub-E makes the banner the single protection surface). Surfaces an inline `errorMessage` (server/guard rejection copy) under the input.

### 4. `mingla-business/src/hooks/useExperienceSoldCount.ts` (NEW)
React Query hook calling `biz_experience_sold_count` — the SAME source the server gate uses, so client/server see the same sold count (no drift). Enabled only for a live experience edit.

### 5. Wiring
- `app/experience/[id]/edit.tsx` — computes `isLive` (status `scheduled`/`live`), loads the sold count, and passes `liveExperience` + `liveSoldCount` to the wizard. Drafts pass neither → existing flow unchanged. Stale header comment ("EditPublishedExperienceScreen is Sub-E") replaced with the actual Sub-E routing.
- `src/components/experience/ExperienceCreatorWizard.tsx` — new optional `liveExperience` / `liveSoldCount` props gate a `isLiveEdit` mode: renders the banner at the top of the scroll; replaces the Save-as-draft/Publish footer split with a single **"Save changes"** button; `handleLiveSave` builds the `LiveExperiencePatch` from the same wizard state, runs the client guard (fast-path), then routes through `supabase.rpc("biz_update_live_experience", …)`, surfacing both client- and server-side rejection copy inline. Draft mode (`isLiveEdit=false`) is byte-for-byte the prior behaviour.

---

## RPC contract

`biz_update_live_experience(p_event_id uuid, p_payload jsonb, p_reason text) RETURNS jsonb`
- `p_payload` is the **same shape** the wizard's `buildPayload(true)` already produces for `biz_publish_experience` (title/description/intents/modes/whole_price_cents/is_free/capacity/stops[]/whenMode/when/multiDates/recurrence_rules/timezone/cover).
- `p_reason` required, trimmed, 10–200 chars.
- Returns `{ok:false, reason, …}` for refund-gate rejects (HTTP 200, soft reject — mirrors trip RPC), or throws Postgres exceptions for auth/permission/validation (`not_authenticated`, `insufficient_event_permission`, `experience_not_found`, `event_not_an_experience`, `experience_title_required`, `experience_description_invalid`, `invalid_mode`, `experience_stop_count_invalid`, `stop_name_required`, `experience_price_invalid`, `event_date_required`).

---

## Migration to apply (operator)

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]" && /Users/sethogieva/bin/supabase db push --linked
```

Filename: `supabase/migrations/20260902000000_meta_orch_1059_sub_e_update_live_experience.sql`. Additive (CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION; no destructive DDL). Prefix `20260902000000` confirmed strictly greater than the max across origin/main + all sibling worktrees (prior max = `20260901000000`, ORCH-1064). **Do NOT** push from this skill (orchestrator applies after the safe-migration protocol).

---

## Regression tests

**Client guard (Jest):** `mingla-business/src/utils/__tests__/publishedExperienceEditGuards.test.ts`
- 17 tests PASS. Covers each reject reason + benign no-op accept + additive stop-add accept + capacity-increase accept + zero-orders-any-change accept + reason trim + human copy.
- **fails-on-revert verified** at pre-fix tree: disabling the price gate (`if (false)`) flips 3 price tests to FAIL (9 passed / 3 failed); restored clean (`git diff` empty).

**Server contract (Deno):** `supabase/functions/__tests__/biz_update_live_experience.refund_gate.test.ts`
- 10 tests PASS (`deno test --allow-read`). Pins the SQL contract: reason gate, status gate (draft never trips), capacity/price/date/stop refund-gates, I-1 one-ticket UPDATE-in-place (zero new INSERTs), I-6 no Stripe, permission gate + SECURITY DEFINER + grant, append-only audit (no INSERT/UPDATE/DELETE policy), reason CHECK.
- **fails-on-revert verified:** renaming `'price_change_with_sales'` in the migration flips E-04 to FAIL (9 passed / 1 failed); restored clean.

**No regressions:** `publishedTripEditGuards.test.ts` + all 5 existing `metaOrch1059*` experience suites + `experiencesService.test.ts` = **63 tests PASS** after the change.

---

## tsc

`npx tsc --noEmit` (mingla-business): **zero errors reference any of the 6 touched files**. The 243 remaining errors are pre-existing baseline noise in unrelated files (notably the foreign `../packages/*` cruft from the abandoned merge the dispatch flagged — NOT touched/committed by this ORCH, e.g. `packages/event-rendering/*`, `packages/phone-input/*`, plus pre-existing `app/checkout/*`, `marketing/ComposerV2/*`). Touched-file filter returns empty.

---

## Device / sim evidence

Physical device `R58R54YV7JT` (Samsung A72) is **NOT connected** (`adb devices` shows only `emulator-5554`). Per the dispatch fallback ("else sim + note it"), verification rests on:
1. The **server gate** (canonical source of truth) proven by the Deno contract test + fails-on-revert.
2. The **client fast-path** proven by the Jest test + fails-on-revert (17 cases including the exact dispatch scenarios: price-change-after-sale rejected, capacity-below-sold rejected, allowed change saves).
3. The wiring is pure-JS/RN (hot-reload-safe); no native module touched.

**Operator on-device confirmation (recommended before CLOSE):** publish an experience, then edit it live — confirm (a) the orange banner + reason input appear at the top, (b) saving with an empty/short reason is blocked inline, (c) a price change after a sale is rejected with "You can't change the price — N buyers already paid…", (d) a benign edit (e.g. description/cover) with a valid reason saves. The migration must be applied first (the RPC 404s until `db push`).

---

## Hard-guard checklist

- [x] Mirrors the proven trip guard architecture (RPC + client fast-path + banner + audit log + same auth/permission gate).
- [x] ONE-TICKET invariant intact (UPDATE-in-place; zero new ticket INSERTs; Deno E-07).
- [x] Draft lifecycle intact — a DRAFT edit does NOT route here (edit screen gates on `scheduled`/`live`; RPC also rejects non-live status). Draft mode flow byte-unchanged.
- [x] Server-side enforcement is canonical; client guard reasons match the RPC 1:1 (shared sold-count source).
- [x] New migration → ORCH-0863 C7 allowlist in the SAME commit (COMMS-0002); C7 green.
- [x] Migration additive (CREATE OR REPLACE / IF NOT EXISTS; no destructive DDL); monotonic prefix.
- [x] tsc clean on touched files; regression tests PASS + fails-on-revert (both layers).
- [x] Committed ONLY mingla-business + supabase + the strict-grep mjs via explicit pathspec; foreign cruft left untouched; no stray `* 2.*` dupes found.
- [x] Did NOT db push / deploy / merge.

---

## Files changed

| file | change |
|---|---|
| `mingla-business/src/utils/publishedExperienceEditGuards.ts` | NEW — client guard + reject copy |
| `mingla-business/src/utils/__tests__/publishedExperienceEditGuards.test.ts` | NEW — 17-case Jest regression |
| `mingla-business/src/components/experience/EditAfterPublishExperienceBanner.tsx` | NEW — banner + reason input |
| `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` | edited — live-edit mode (banner + guard + RPC route) |
| `mingla-business/src/hooks/useExperienceSoldCount.ts` | NEW — sold-count hook (server RPC) |
| `mingla-business/app/experience/[id]/edit.tsx` | edited — route scheduled/live → live-edit |
| `supabase/migrations/20260902000000_meta_orch_1059_sub_e_update_live_experience.sql` | NEW — audit table + helper + RPC |
| `supabase/functions/__tests__/biz_update_live_experience.refund_gate.test.ts` | NEW — 10-case Deno contract regression |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | edited — C7 allowlist (migration + Deno test) |

Commit hash: _(filled at commit below)_

---

## Discoveries for orchestrator

- **Foreign cruft present in worktree** (as the dispatch warned): `app-mobile/*` + `packages/*` modifications from an abandoned merge are uncommitted in this worktree and produce most of the tsc baseline errors. NOT touched or committed by Sub-E. The orchestrator should reconcile/discard them before any branch-wide tsc gate.
- The experience live-edit currently reuses the multi-step wizard with the banner overlaid (the minimal proven mirror), rather than a dedicated sectioned `EditPublishedExperienceScreen` like trips. This is sufficient for the buyer-protection guard. A dedicated sectioned editor for experiences could be a future polish ORCH if operators want section-level save parity with trips.
