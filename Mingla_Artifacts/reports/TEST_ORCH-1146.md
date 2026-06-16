# TEST — ORCH-1146 [experience-parser field completeness]

**Skill:** mingla-tester · **Phase:** TEST (brutal gatekeeper) · **Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/orch-1146-[experience-parser-field-completeness]` · branch `orch-1146-experience-parser-field-completeness`
**Tip under test:** `3e8c0f068` (impl) + `af7714a7f` (tester adversarial test, this run)
**Binding inputs:** `SPEC_ORCH-1146…md`, `INVESTIGATE_ORCH-1146…md`, `IMPLEMENT_ORCH-1146.md`
**Mode:** SPEC-COMPLIANCE + TARGETED + adversarial. Backend/edge-only change → Phase 0.A live-fire sim gate is EXEMPT (no native/UI code; runtime validated via Deno mock-client executor tests + live DB CHECK read-back). Live snap→wizard render + Ari live-fire are post-deploy checks (edge fns deploy from merged main at CLOSE; current deployed versions confirmed stale).

---

## 1. VERDICT: **CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 2 · P4: 2

Zero P0, zero P1, zero P2. Regression gate SATISFIED (implementor happy-path with independently re-proven fails-on-revert + tester adversarial different-angle test, both on-branch and in the closing diff). All 11 SCs met at the source + Deno + live-DB-CHECK level. **CHECK-safety fully proven against the live constraint.** Ari no-regression proven at the Deno/source level (17 neighbor tests + T5 green against the changed shared module).

**Why CONDITIONAL, not PASS:** the product payoff (snap → wizard prefill render) and the Ari live-fire path are **source-verified + Deno-proven only** — they cannot be runtime-confirmed until the four edge functions are redeployed from merged main (currently live at stale versions: `agent-confirm-action` v162, `agent-chat` v167, `parse-restaurant-menu` v133, `parse-play-activities` v132). This is the SPEC's own documented post-deploy step (§8), not a defect. The two P3 items are doc nits. No condition requires rework.

The condition to clear to full PASS: after CLOSE deploys the four edge fns from merged main, do one live snap (Ve5 menu + Ve6 activities) on the business app and confirm the wizard arrives with vibes/currency/free/capacity/price prefilled, plus one minimal Ari `create_experience` call still produces a clean draft.

---

## 2. SC-by-SC matrix

| SC | Criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | Ve6 snap → `{group-fun,romantic}` + currency + midpoint 3000 + 1 ticket (cap 8, paid) | **PASS** | Deno T1 green; executor `agentTools.ts:824,820,815,860-879`. Canonical order asserted `["romantic","group-fun"]`. |
| SC-2 | Ve5 no-price romantic → `{romantic}` + free unlimited ticket | **PASS** | Deno T2 green; helper free-text `tasting_menu/date-night`→romantic. |
| SC-3 | Unmappable tags → `experience_intents` NULL (omitted), insert OK (no CHECK fail) | **PASS** | Deno T3 + tester ADV-4a green; executor `:824` writes key only when `length>0`. Verified against live CHECK (§4). |
| SC-4 | Wizard prefill via read-back, ZERO wizard change | **PASS (source)** | `experienceDetailService.ts` NOT in diff; reads `currency`+`experience_intents` (`:236`), ticket (`:258-259`), maps `:315-316,344-347`. Live render = post-deploy. |
| SC-5 | No event_dates/stops/cover/published_at on snapped draft | **PASS** | Deno T6 + tester ADV; executor writes none; `status/visibility='draft'`, `published_at=null` (`:809-811`). |
| SC-6 | Ari minimal `{brand_id,title,narrative}` → draft + free/unlimited ticket + NULL intents, no throw | **PASS (Deno/source)** | T5 green; 17 orch_1103 neighbor tests green against changed module; callers source-traced (§ Tier 2). Live = post-deploy. |
| SC-7 | Ve5 schema has `is_free`+`suggested_time_of_day`; null when not in photo | **PASS** | `geminiMenuParser.ts:53-54,111,68`; Deno T8/T8b green. |
| SC-8 | Ve6 schema has `is_free`; capacity/time preserved | **PASS** | `geminiActivitiesParser.ts:59,124,57-58`; Deno T8c/T8d + existing Ve6 test green. |
| SC-9 | Absent field → null in parser output (no fabrication) | **PASS** | Normalizers `… ? raw.is_free : null` (Ve5:111, Ve6:124); Deno T8/T8c green. |
| SC-10 | No hardcoded `"GBP"` currency fallback across the 5 files | **PASS** | Strict-grep gate clean (5 files, 0 violations) + `--self-test` OK; independent grep: every `GBP` is a comment or an arg-description example, no quoted fallback literal. |
| SC-11 | Brand NGN + unreadable currency → `currency='NGN'` end-to-end | **PASS** | Deno T7 green (lowercase brand `ngn`→`NGN`); edge passes `undefined`→normalizer `""`→executor brand-resolve. |

All covered surfaces (Business iOS/Android/Web preview) are served by the SAME edge fns + SAME read-back service → parity automatic; no per-surface split.

---

## 3. CHECK-safety proof (highest-risk failure) — PASS

**Live DB CHECK (read-only query, project `gqnoajqerqhnvulmnyvv`):**
```
CHECK ((experience_intents IS NULL) OR (
  array_length(experience_intents,1) >= 1 AND array_length(experience_intents,1) <= 4
  AND experience_intents <@ ARRAY['adventurous','first-date','romantic','group-fun']))
```
**Helper id list** `CANONICAL_EXPERIENCE_INTENTS = ['adventurous','first-date','romantic','group-fun']` is **byte-identical** to the CHECK's allowed array.

**Executor guarantees (traced `agentTools.ts:735-738,824` + `canonicalExperienceIntents.ts`):**
- `mapToCanonicalExperienceIntents` only ever returns members of the canonical set (`mapOneTag` returns a canonical id or null; non-strings/empties dropped) → **never an invalid id** (CHECK `<@` satisfied).
- Output deduped via Set + `CANONICAL_EXPERIENCE_INTENTS.filter(...).slice(0,4)` → **length ≤ 4** (CHECK upper bound satisfied).
- Executor writes the column ONLY when `canonicalIntents.length > 0` (`:824`) → **never `[]`** (CHECK lower bound satisfied; empty → key omitted → column NULL → CHECK `IS NULL` branch).

**Adversarial inputs proven (tester ADV-4, all green):**
- all-unmappable + case + whitespace + duplicates (`["  GLUTEN_FREE  ","Vegan","keto","halal","GLUTEN_FREE"]`) → column **OMITTED**, never `[]`.
- mixed mappable+garbage+non-strings → ONLY canonical ids, deduped, ≤4, in canonical order `["adventurous","first-date","romantic","group-fun"]`.
- empty array / null / non-array / `[""]` → `[]` (executor then omits → NULL).

Conclusion: the snap-confirm path **cannot** produce a CHECK-violating `experience_intents` write. PROVEN.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- Checked out HEAD `3e8c0f068`; backed up `agentTools.ts`.
- **True line-deletion** of the three additive blocks: `row.currency` (`:820`), `row.experience_intents` (`:824`), and the entire `ticket_types` insert + orphan-soft-delete block (`:846-901`).
- `deno test orch_1146_create_experience_field_completeness.test.ts` → **5 of 7 FAILED** (T1, T2, T5, T7, T9 — the currency/intents/ticket/atomicity assertions). T3/T6 still passed (they assert key-absence, true either way).
- Restored from backup → `git status` clean (identical to committed HEAD) → **7/7 PASS**.

Matches the implementor's claim exactly (5/7 fail on revert, 7/7 on restore). Hashes: proof commit `3e8c0f068`; restore verified at `3e8c0f068`.

---

## 5. Adversarial test added (tester-owned, different angle)

**Path:** `supabase/functions/_shared/__tests__/orch_1146_create_experience.tester-adversarial.test.ts`
**Commit:** `af7714a7f` (on-branch, append-only, in `git diff origin/main...HEAD --name-only`).
**Angles (7 tests, all green):** ADV-1 explicit `is_free=false` wins over price-derivation; ADV-2 `capacity_max` on a RESTAURANT does NOT cap; ADV-3 >120-char title → INVALID_ARGS, no partial write; ADV-4a/b/c CHECK-safety; ADV-5 events-insert failure → no ticket, no orphan update.
**fails-on-revert verified at `3e8c0f068`** — with the executor plumbing line-deleted, ADV-1 + ADV-2 FAIL (no ticket inserted: 5 passed | 2 failed); restored → 7/7 PASS.

Both the implementor happy-path test (fails-on-revert) AND this tester adversarial test appear in the closing diff. Regression gate SATISFIED.

---

## 6. Tier 2 — Ari no-regression

- **Callers enumerated (grep):** only `agent-confirm-action/index.ts:188,200` (`findTool`+`executor`) and `agent-chat/index.ts:320,357,365` (`AGENT_TOOLS`/`findTool`+`executor`). No other executor caller.
- **Additive proof:** `create_experience.required = ["brand_id","title","narrative"]` UNCHANGED (`:659`); `currency`/`intent_tags`/`capacity_*`/`is_free` all optional (`:660-681`). Executor return shape `{ event: data }` UNCHANGED; `data` still carries `title` (selected `:829`), so `agent-confirm-action:316-318`'s `result.event.title` read still works.
- **Deno proof:** T5 (minimal Ari call → draft + free/unlimited ticket + NULL intents + NULL currency, no throw) green; the 17 `orch_1103_ari_brand_crud` (10) + adversarial (7) neighbor tests green against the changed `agentTools.ts`.
- **Runtime status:** SOURCE + DENO PROVEN. Live `agent-confirm-action`/`agent-chat` are deployed at v162/v167 (pre-1146) — live-fire is a post-deploy check, capped at strong-source here (stated, not claimed as runtime).

---

## 7. Tier 3 — invariants / no-fabrication / draft-only / schema

- **Draft-only:** executor sets `status/visibility='draft'`, `published_at=null`; writes NO `event_dates`/`experience_stops`/`cover_media_*`. The one added ticket has no date → unsellable. (T6 + ADV.) I-2/I-4 preserved.
- **I-1 ONE-TICKET:** exactly one `ticket_types` insert (T1 asserts `tickets.length === 1`).
- **No fabrication (Constitution #9):** `is_free`/`suggested_time_of_day` → null when absent (T8/T8c); unmappable vibes dropped, never invented.
- **No silent failures (#3):** every write failure throws `ToolError("WRITE_FAILED")`; ticket-insert failure compensates with an orphan soft-delete then throws (T9). No empty catch in the diff.
- **Currency-aware (#10):** resolves from brand `default_currency`, no GBP literal.
- **Schema (live, read-only):** `events.currency` ✓, `events.experience_intents` ✓, `ticket_types` ✓ all exist. **Zero migration files** in the diff (correct — targets pre-exist).

---

## 8. Tier 1 — Deno + static (commands + output)

- `deno test orch_1146_create_experience_field_completeness.test.ts orch_1146_parser_field_completeness.test.ts` → **18 passed | 0 failed**. With tester adversarial → **25 passed | 0 failed**.
- `deno test orch_1103_ari_brand_crud*.test.ts` → **17 passed | 0 failed** (no regression on shared module).
- `deno check` clean on all ORCH-1146 files (`canonicalExperienceIntents.ts`, `agentTools.ts`, both parsers, both edge `index.ts`). The 20 type errors surfaced by a full `__tests__/` typecheck are all in `ticketPdf.ts` (NOT touched by ORCH-1146; pre-existing).
- `node .github/scripts/strict-grep/orch-1146-no-gbp-currency-default.mjs --self-test` → `SELF-TEST OK` (exit 0). Real scan → `scanned 5 file(s); no hardcoded GBP currency fallback` (exit 0).

---

## 9. Constitution 14-rule matrix (against the diff)

| # | Rule | Result |
|---|---|---|
| 1 | No dead taps | N/A (no UI) |
| 2 | One owner per truth | PASS — executor is the single writer of the snap draft; helper is the single vibe-mapping source (cross-ref comments in 3 places) |
| 3 | No silent failures | PASS — all writes throw ToolError; orphan compensation on ticket failure |
| 4 | One query key per entity | N/A (no client query keys touched) |
| 5 | Server state server-side | N/A |
| 6 | Logout clears | N/A |
| 7 | `[TRANSITIONAL]` labelled | N/A (none introduced) |
| 8 | Subtract before adding | PASS — reused RPC's ticket-default shape + existing blob; no parallel structure |
| 9 | No fabricated data | PASS — null-on-absent for is_free/time; unmappable vibes dropped |
| 10 | Currency-aware | PASS — brand-resolved, no GBP literal |
| 11 | One auth instance | N/A — executor uses the passed user-scoped client (I-ARI-USER-JWT-ONLY preserved) |
| 12 | Validate at right time | PASS — title/narrative length validated before any write |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | N/A |

No violations.

---

## 10. Device / parity matrix

| Surface | Ships here? | Result |
|---|---|---|
| Consumer iOS | NO | N/A — zero `app-mobile/` consumers of the parsers/executor |
| Consumer Android | NO | N/A |
| Buyer/anon Web | NO | N/A — public pages render PUBLISHED experiences |
| Business iOS | YES | PASS (source) — prefill via shared read-back; live render = post-deploy |
| Business Android | YES | PASS (source) — same shared code |
| Admin Web | NO | N/A |
| Business Web preview | YES | PASS (source) — same shared edge fns + read-back |

Live-fire sim gate EXEMPT (backend/edge-only, no native/UI code). No physical-iPhone step (nothing user-touchable changed without an edge redeploy).

---

## 11. Findings

**P3-1 (doc nit) — migration-line citation drift in the helper comment.**
Evidence: `canonicalExperienceIntents.ts:7` cites the CHECK at `:57-62` while `:20` and `experienceIntents.ts` cite `:62-64`. Impact: none (the live CHECK is byte-identical regardless; cosmetic). Fix: pick one line range. Retest: visual.

**P3-2 (copy nit, PRE-EXISTING, out of scope) — confirm-action says "Published experience".**
Evidence: `agent-confirm-action/index.ts:318` returns `Published experience "<title>" to your venue.` but `create_experience` produces a DRAFT (never published). Impact: misleading Ari confirmation copy. NOT introduced by ORCH-1146 (unchanged line; the file is DO-NOT-TOUCH per SPEC §12). Fix: future ORCH — change to "Created draft experience…". Routed to Discoveries.

**P4-1 (praise).** Clean CHECK-safety design: the column write is gated on `length>0` and the id list is frozen + cross-referenced in 3 places (helper, biz constant, DB CHECK), making drift loud. The compensating orphan soft-delete on ticket failure is the correct non-transactional pattern.

**P4-2 (praise).** De-GBP chain is single-source-of-truth end-to-end (edge `undefined` → normalizer `""` → executor brand-resolve), with a self-testing strict-grep gate.

---

## 12. Discoveries for Orchestrator

1. **`agent-confirm-action:318` "Published experience" copy is wrong** — the AI path creates a DRAFT, not a published experience. Pre-existing, DO-NOT-TOUCH this ORCH. Spawn a tiny copy-fix ORCH.
2. **`theme.experience_meta` blob is still write-only** for `suggested_time_of_day` + the price range (no schema slot; the wizard doesn't read the blob). Per SPEC Q3 LOCKED; a future ORCH could surface the range/time in the wizard.
3. **Post-deploy verification owed at CLOSE:** redeploy `parse-restaurant-menu`, `parse-play-activities`, `agent-confirm-action`, `agent-chat` from MERGED main (they bundle the changed `_shared/`), then live-snap + live-Ari check.
4. **COMMS-0035 (WARN, ALL, OPEN)** read + factored: `expo-image-manipulator` native-module-via-OTA risk — UNRELATED to this backend-only ORCH (no native modules, no business runtime bundle change beyond a comment). Not acked on the anchor to avoid the fragile-direct-main-commit hazard mid-QA; flagged here for the orchestrator.

---

## 13. Accepted conditions (CONDITIONAL PASS)

The single deferral is the **live snap→wizard-prefill render + Ari live-fire**, deferred to post-deploy because the four edge functions are not yet redeployed from merged main (SPEC §8's own step). This is `probable`-level (source + Deno + live-DB-CHECK proven; blocked from runtime only by the not-yet-merged/deployed state). It is NOT a P1 and requires no rework — it is the standard CLOSE-time deploy + smoke. If you want it cleared to full PASS before CLOSE, deploy to a preview and run the two live checks in §1.
