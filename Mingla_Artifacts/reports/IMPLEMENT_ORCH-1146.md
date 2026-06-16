# IMPLEMENTATION — ORCH-1146 [experience-parser field completeness]

**Skill:** mingla-implementor · **Phase:** IMPLEMENT · **Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/orch-1146-[experience-parser-field-completeness]` · branch `orch-1146-experience-parser-field-completeness`
**Binding inputs:** `SPEC_ORCH-1146_EXPERIENCE_PARSER_FIELD_COMPLETENESS.md`, `INVESTIGATE_ORCH-1146_EXPERIENCE_PARSER_FIELD_COMPLETENESS.md`
**Status:** implemented and verified (Deno typecheck + 35 tests green; fails-on-revert proven by true line-deletion).

---

## 1. Summary

Snapped menu/activities photos now arrive in the experience wizard with every AI-inferable field
already in its real typed column instead of a write-only JSON blob. The shared `create_experience`
confirm executor now persists: the AI vibes → `events.experience_intents` (mapped to the canonical
4-id vocabulary, or NULL when nothing maps — never an empty array), the currency →
`events.currency`, and free/capacity/price → a single `ticket_types` row. The two Gemini parsers
(Ve5 menu, Ve6 Play) gained an `is_free` field (+ `suggested_time_of_day` on Ve5), each "leave null
if not in the photo." Every hardcoded `"GBP"` currency fallback in the parser path was removed —
currency now resolves from the brand's `default_currency`. Genuinely-uninferable fields (dates,
cover, stops, exact address, fee switches) are still left blank, and **no AI path produces a dated
or publishable experience** — drafts stay drafts.

No UI changed: the wizard already reads these columns/ticket back, so prefill is automatic. No
migration (every target column/table already exists).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Satisfied by (commit) |
|---|---|---|---|
| SC-1 | Ve6 snap → canonical intents `{group-fun,romantic}` + currency + midpoint + 1 ticket (cap 8, paid) | ✓ verified (test T1) | `7f29fcf7e` |
| SC-2 | Ve5 no-price romantic snap → `{romantic}` + free unlimited ticket | ✓ verified (test T2) | `7f29fcf7e` |
| SC-3 | Unmappable tags → `experience_intents` NULL (omitted), insert succeeds (no CHECK fail) | ✓ verified (test T3) | `7f29fcf7e` + `7f29fcf7e` |
| SC-4 | Wizard prefill via read-back, ZERO wizard change | ✓ source — no wizard/`experienceDetailService` edit; columns/ticket now populated (the service already reads them) | `7f29fcf7e` |
| SC-5 | No `event_dates`/`experience_stops`/cover/`published_at` on a snapped draft | ✓ verified (test T6) | `7f29fcf7e` |
| SC-6 | Ari minimal `{brand_id,title,narrative}` → draft + free/unlimited ticket + NULL intents, no throw | ✓ verified (test T5) | `7f29fcf7e` |
| SC-7 | Ve5 schema has `is_free`+`suggested_time_of_day`; null when not in photo | ✓ verified (tests T8/T8b) | `7f29fcf7e` |
| SC-8 | Ve6 schema has `is_free`; capacity/time behavior preserved | ✓ verified (tests T8c/T8d + existing Ve6 test) | `7f29fcf7e` |
| SC-9 | Absent field → null in parser output (no fabrication) | ✓ verified (tests T8/T8c) | `7f29fcf7e`/`7f29fcf7e` |
| SC-10 | No hardcoded `"GBP"` currency fallback across the 5 files | ✓ verified (strict-grep gate, real scan clean) | `7f29fcf7e` |
| SC-11 | Brand NGN + unreadable currency → `currency='NGN'` end-to-end | ✓ verified (test T7; executor resolves from brand) | `7f29fcf7e` + `7f29fcf7e` |

(Commit hashes filled in §11 / chat summary after commit.)

---

## 3. Files changed

| File | Phase | Δ | Change |
|---|---|---|---|
| `supabase/functions/_shared/canonicalExperienceIntents.ts` (NEW) | 1 | +~190 | shared vibe-mapping helper (Play map + free-text keyword rules + already-canonical passthrough; caps 4, dedups, drops unmappable) |
| `supabase/functions/_shared/agentTools.ts` | 1,3 | ~+90 | `createExperience` executor: currency column (de-GBP), `experience_intents` column (canonical or omitted), ONE `ticket_types` row (is_free+capacity+price), compensating orphan soft-delete; `is_free` added to the tool param schema |
| `supabase/functions/_shared/geminiMenuParser.ts` | 2,3 | ~+25 | Ve5 schema/interface/normalizer/prompt for `is_free`+`suggested_time_of_day`; GBP default removed |
| `supabase/functions/_shared/geminiActivitiesParser.ts` | 2,3 | ~+15 | Ve6 schema/interface/normalizer/prompt for `is_free`; GBP default removed |
| `supabase/functions/parse-restaurant-menu/index.ts` | 2,3 | ~+5 | tool_args `is_free`+`suggested_time_of_day`; brand-currency passthrough (no GBP) |
| `supabase/functions/parse-play-activities/index.ts` | 2,3 | ~+5 | tool_args `is_free`; brand-currency passthrough (no GBP) |
| `mingla-business/src/constants/experienceIntents.ts` | 1 | +~10 (comment only) | cross-reference comment to the DB CHECK + the new edge helper (ids unchanged) |
| `.github/scripts/strict-grep/orch-1146-no-gbp-currency-default.mjs` (NEW) | 3 | +~130 | strict-grep gate (T10) + `--self-test` |
| `.github/workflows/strict-grep-mingla-business.yml` | 3 | +14 | register the ORCH-1146 gate job (self-test + run) |
| `supabase/functions/_shared/__tests__/orch_1146_create_experience_field_completeness.test.ts` (NEW) | 1 | +~310 | executor regression + adversarial tests (T1/T2/T3/T5/T6/T7/T9) |
| `supabase/functions/_shared/__tests__/orch_1146_parser_field_completeness.test.ts` (NEW) | 1,2,3 | +~150 | helper (T4 + edge) + normalizer no-fabrication (T8) + de-GBP tests |

All inside the SPEC §12 allowlist. NO existing test modified (append-only preserved). NO migration.
NO UI / wizard / `experienceDetailService` / RPC / `agent-chat` / `agent-confirm-action` edit.

---

## 4. Data-model changes applied

NONE. No migration. Every target already exists and is written through additively:
- `events.currency` (`20260824…:411`) — now populated when resolvable, else omitted (DB default).
- `events.experience_intents text[]` + CHECK `events_experience_intents_chk` (`20260828…:57-62`) —
  now populated with the canonical 4-id array, or the key is omitted (column NULL) when empty.
- `ticket_types` (one row, RPC default shape `20260824…:489-507`) — now inserted by the executor.

Read-only schema probe NOT required (no migration, no guard/backfill). The executor writes through
the caller's JWT (RLS is the final wall, unchanged).

---

## 5. Edge functions touched (deploy from MERGED main — orchestrator/operator-owned)

| Function | `verify_jwt` to preserve | Why it changed |
|---|---|---|
| `parse-restaurant-menu` | (unchanged — preserve current) | tool_args `is_free`+`suggested_time_of_day`; brand-currency passthrough |
| `parse-play-activities` | (unchanged — preserve current) | tool_args `is_free`; brand-currency passthrough |
| `agent-confirm-action` | (unchanged — preserve current) | NOT edited; imports the changed `_shared/agentTools.ts` (executor) → redeploy to pick up the shared change |
| `agent-chat` | (unchanged — preserve current) | NOT edited; imports `_shared/agentTools.ts` (AGENT_TOOLS) → redeploy to pick up the shared change |

`_shared/` modules ship inside each importing function's bundle, so the four functions above must be
redeployed from merged main for the executor + parser changes to take effect. NO new env var.

---

## 6. Regression tests added

- `supabase/functions/_shared/__tests__/orch_1146_create_experience_field_completeness.test.ts` —
  7 tests (T1 primary + T2/T3/T5/T6/T7/T9). PASS (7/7).
- `supabase/functions/_shared/__tests__/orch_1146_parser_field_completeness.test.ts` — 11 tests
  (T4 + helper edges + T8 no-fabrication + de-GBP). PASS (11/11).

**fails-on-revert verified at `7f29fcf7e`** (true line-deletion, NOT comment-out): with the
executor's three additive write blocks deleted (the `row.currency` line, the
`row.experience_intents` line, and the entire `ticket_types` insert + orphan-delete block),
`deno test orch_1146_create_experience_field_completeness.test.ts` → **5 of 7 FAILED**
(T1/T2/T5/T7/T9 — the currency/intents/ticket/atomicity assertions). Restoring the fix → **7/7
PASS**. Evidence captured in the IMPLEMENT session log.

Append-only: both new test files appear in `git diff origin/main...HEAD --name-only`; no existing
test was deleted or modified.

---

## 7. Old → New receipts

### `_shared/agentTools.ts` — `createExperience` executor
**Before:** wrote a 14-column `events` draft shell (no `currency`, no `experience_intents`) + a
`theme.experience_meta` blob; wrote NO ticket; `currency` fell back to a literal `"GBP"`.
**Now:** resolves currency from `args.currency` else `brand.default_currency` (no GBP literal; omits
the column when unknown); maps `intent_tags` → canonical 4-id vibes via the new helper and writes
`experience_intents` (or omits the key → NULL when empty, never `[]`); inserts ONE `ticket_types`
row (`is_free` from explicit `args.is_free` else price-derived; `quantity_total` from Ve6
`capacity_max`, else unlimited; `price_cents` = midpoint or 0 if free); on ticket-insert failure,
soft-deletes the orphan `events` row and throws `WRITE_FAILED`. Blob retained for audit. Draft
invariants unchanged.
**Why:** SC-1/2/3/5/6/11, F-1 plumbing root cause, I-1 one-ticket, atomicity (Q4 LOCKED).
**Lines:** ~+90.

### `_shared/canonicalExperienceIntents.ts` (NEW)
**Before:** n/a.
**Now:** `mapToCanonicalExperienceIntents(rawTags, venueCategory)` → canonical-ordered, deduped,
≤4 ids; Play-vocab map + free-text keyword rules + already-canonical passthrough; unmappable → drop;
empty → `[]`.
**Why:** F-2 vocabulary mismatch; the CHECK requires the 4 canonical ids.
**Lines:** ~+190.

### `_shared/geminiMenuParser.ts` (Ve5)
**Before:** schema/interface had no `is_free`/`suggested_time_of_day`; prompt "Use GBP if currency
unclear"; normalizer defaulted currency to "GBP".
**Now:** `is_free`+`suggested_time_of_day` added (schema/interface/normalizer, null when absent);
prompt instructs "leave currency empty if unclear" + explicit is_free/time rules; default currency
param `""`.
**Why:** SC-7/9/10, Phase 2+3. **Lines:** ~+25.

### `_shared/geminiActivitiesParser.ts` (Ve6)
**Before:** no `is_free`; "Use GBP" prompt; GBP normalizer default.
**Now:** `is_free` added (null when absent); de-GBP prompt + `""` default; capacity/time-of-day
unchanged.
**Why:** SC-8/9/10, Phase 2+3. **Lines:** ~+15.

### `parse-restaurant-menu/index.ts` / `parse-play-activities/index.ts`
**Before:** `defaultCurrency = … || "GBP"`; tool_args lacked the new fields.
**Now:** `… || undefined` (brand-currency passthrough, executor resolves server-side); tool_args
carry `is_free` (+`suggested_time_of_day` on Ve5). **Why:** SC-10/11. **Lines:** ~+5 each.

### `mingla-business/src/constants/experienceIntents.ts`
**Before/Now:** ids unchanged; added a cross-reference comment to the DB CHECK + the edge helper.
**Why:** SPEC §4.4 sync-guard. **Lines:** +~10 (comment only).

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS | NO | parsers have zero `app-mobile/` consumers |
| Consumer Android | NO | same |
| Buyer/anon Web | NO | public pages render PUBLISHED experiences; authoring prefill unaffected |
| Business iOS | YES | wizard now prefills vibes/currency/free/capacity/price — automatic via shared edge fns + shared read-back (no iOS-specific file) |
| Business Android | YES | same shared code |
| Admin Web (adjacent) | NO | no admin experience authoring |
| Business Web preview (adjacent) | YES | same shared edge fns + same wizard read-back |

All three affected surfaces (Business iOS/Android/Web) are served by the SAME edge functions + the
SAME `experienceDetailService` read-back. Parity is automatic — NO per-surface manual work.

---

## 9. Smoke / verification result

- `deno check` clean on: `agentTools.ts`, `canonicalExperienceIntents.ts`, both Gemini parsers, both
  edge `index.ts`.
- `deno test` (5 files, 35 tests) → **35 passed | 0 failed**, including the pre-existing
  `orch_1103_ari_brand_crud` (10) + adversarial (7) + both parser tests (7) — no regression.
- Strict-grep `orch-1146-no-gbp-currency-default.mjs` `--self-test` OK + real scan clean (5 files,
  0 violations). `i-ari-user-jwt-only.mjs` still OK (edge handlers untouched).
- fails-on-revert proven by true line-deletion (5/7 fail on revert, 7/7 on restore).

No simulator/device run performed (backend-only change; no native code; runtime behavior validated
via the executor's mock-client tests). UNVERIFIED on device: the actual wizard prefill render — the
tester should open a snapped draft on Business iOS/Android/web and confirm vibes/currency/free/
capacity/price are pre-populated (the read-back path `experienceDetailService.ts:236,257-259,
315-320,338-349` is unchanged and proven to read these columns/ticket).

---

## 10. Known issues / deferred

- **Price RANGE** stays in `theme.experience_meta` only (no schema slot); the sellable value is the
  midpoint (SPEC §4.5 / Q3 LOCKED). No wizard range prefill — that's ORCH-1144 UI territory.
- **`suggested_time_of_day`** is persisted to the blob (Ve5 now extracts it too), NOT mapped to a
  `when_draft`/date — the date stays uninferable/blank by invariant (SPEC C-3).
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

1. **No migration** — nothing to `db push`. (Verified: every target column/table pre-exists.)
2. **Deploy from MERGED main** (orchestrator/operator-owned, NOT from this worktree): redeploy
   `parse-restaurant-menu`, `parse-play-activities`, `agent-confirm-action`, `agent-chat` (all four
   bundle the changed `_shared/agentTools.ts` / parser modules). Preserve each function's current
   `verify_jwt`. Deploy hazard: deploy from merged main, not stale worktrees
   (`[[feedback_edge_deploy_and_migration_apply_hazards]]`).
3. **CI**: the new gate job `orch-1146-no-gbp-currency-default` runs in
   `strict-grep-mingla-business.yml`.

---

## 12. Discoveries for Orchestrator

1. **SPEC gate-path deviation (minor, documented):** SPEC §9.4/§12 named the gate
   `scripts/gates/orch-1146-no-gbp-currency-default.mjs`, but that directory does not exist in this
   repo. The live convention (ORCH-1103, ORCH-1130, all 212 gates) is
   `.github/scripts/strict-grep/<name>.mjs` registered as a job in
   `strict-grep-mingla-business.yml`. I placed + registered the gate there so it actually runs. Gate
   behavior is exactly per SPEC; only the location differs. No SPEC amendment requested (location is
   not behavior-binding) — flagged for the orchestrator's awareness.
2. **`theme.experience_meta` blob is still write-only for the structured wizard** (investigation
   Discovery #1). This SPEC moved the high-value fields (intents/currency/free/capacity) to real
   columns, but `suggested_time_of_day` + the price range still only live in the blob. A future ORCH
   could wire those (or the wizard could read the blob's `when_draft`-style time hint).
3. **`is_free` precedence (Q5 LOCKED):** explicit `args.is_free` wins over the price-derived value —
   implemented exactly. The parser only emits `is_free=true` on an explicit free signal (else null),
   so the price-derivation path remains the default for ordinary paid offerings.
