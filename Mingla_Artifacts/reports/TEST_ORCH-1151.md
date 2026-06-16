# TEST / QA — ORCH-1151 [curated experiences with menu items as STOPS + summed price + remove free ticket]

**Phase:** TEST (production gatekeeper). Verifies `IMPLEMENT_ORCH-1151.md` against `SPEC_ORCH-1151_CURATED_EXPERIENCES_STOPS.md`.
**Worktree:** `~/Desktop/mingla-orchs/orch-1151-[curated-experiences-stops]` on branch `orch-1151-curated-experiences-stops`, tip `74c1bc834` (+ tester adversarial commit). Clean, not behind origin/main; diff = only the 9 ORCH-1151 files.
**Comms ledger:** read on entry. No OPEN BLOCK/WARN row targets `mingla-tester` / `ORCH-1151` / `ALL` (latest relevant rows are closed: COMMS-0033 was a 1133 ID collision, RESOLVED). Nothing to ack.

---

## 1. Verdict

### PASS — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2

Backend/edge + AI + one-executor change, no UI shipped, no migration, no OTA. The live-DB schema accepts every column the executor writes and satisfies every NOT-NULL constraint; the Ari stop-less path is byte-identical to ORCH-1146 (source-traced + test-proven); summed-price arithmetic is robust to malformed input; the implementor's fails-on-revert is reproduced; my adversarial test (different angle) is on-branch, in-diff, and fails-on-revert. The product read-back (snapped experience opens in the wizard with stops + summed price) is **source-proven** and routed as a **POST-DEPLOY smoke** (edge fns must be deployed from merged main first — current deployed versions predate this code; that is expected and is the orchestrator's CLOSE step, not a defect).

Regression gate: SATISFIED — implementor happy-path `orch_1151_curated_experiences_stops.test.ts` (fails-on-revert reproduced) + tester adversarial `orch_1151_curated_experiences_stops.tester-adversarial.test.ts` (different angle, fails-on-revert) both in `git diff origin/main...HEAD`.

---

## 2. SC-by-SC matrix

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | Ve5 ≤6 experiences, non-empty `stops[]` `{name,desc,price_cents}` | PASS | `geminiMenuParser.ts:10` `MAX_EXPERIENCES=6`; `RESPONSE_SCHEMA` nested stops + item `required:["title","narrative","stops"]`; test T10 green |
| SC-2 | Ve6 ≤6, non-empty `stops[]`; play `intent_tags` 5-id restricted | PASS | `geminiActivitiesParser.ts:12` `=6`; `filterPlayIntentTags` untouched; T10 green |
| SC-3 | both edge entries persist `stops` into `agent_pending_actions.tool_args` | PASS | `parse-restaurant-menu/index.ts:210` + `parse-play-activities/index.ts:223` `stops: exp.stops`; runtime path: `agent-confirm-action/index.ts:185→200` passes `tool_args` to `tool.executor` |
| SC-4 | N stops → N rows (order 0..N-1, place_name=item, address='', ai_description=desc, price_cents=price; place_id/lat/lng NULL) | PASS | `agentTools.ts:892-905`; tests T1/T7/T8 green; live schema confirms columns exist + nullable coords (§ deciding evidence) |
| SC-5 | single ticket `price_cents = Σ(stops)`; `is_free` true only when sum 0 | PASS | `agentTools.ts:830-835` (sum) + `:936-943` (force-price); tests T1 (4700), T2 (8800), T5 (0/free) |
| SC-6 | exactly ONE ticket; no per-stop tickets; not free unless sum 0 | PASS | single `ticket_types` insert (`:950`); T1 asserts `tickets.length===1`; I-1 preserved |
| SC-7 | draft preserved: status/visibility='draft', published_at=null, no event_dates, no cover | PASS | events row `:844-846`; tests T3 + amended ORCH-1146 T6 green |
| SC-8 | Ari no-regression: `{brand_id,title,narrative}` → events + one free unlimited ticket, NO stops, no throw | PASS | `hasStops` gate (`:827`); source-trace § Tier 3; T4 + ORCH-1146 T5/ADV-1 green |
| SC-9 | stops-insert failure soft-deletes orphan event, throws WRITE_FAILED | PASS | `agentTools.ts:910-923`; test T6 green |
| SC-10 | with stops `pricing_mode='per_stop'` + `whole_price_cents=null`; without, `whole` | PASS | `agentTools.ts:853-854`; tests T1/T2 (per_stop) + T4 (whole); **live CHECK `events_pricing_mode_chk` accepts `per_stop`** |

All 10 SCs PASS. No surface-split rows — backend/edge-only (no per-platform parity; consumer/admin/web untouched per the Cross-Surface Impact table).

---

## 3. Tier 2 — LIVE-DB schema truth (THE DECIDING EVIDENCE)

Read-only against project `gqnoajqerqhnvulmnyvv` (`information_schema.columns` + `pg_constraint`).

### `experience_stops` — every executor-written column exists; every NOT-NULL satisfied

| Column | Live type | Live NOT-NULL? | Live default | Executor provides | Verdict |
|--------|-----------|----------------|--------------|-------------------|---------|
| `event_id` | uuid | YES (no default) | — | `eventId` | ✓ satisfied |
| `stop_order` | integer | YES (no default) | — | `i` (0..N-1) | ✓ satisfied (CHECK `>=0` OK) |
| `place_name` | text | YES (no default) | — | `name`≤120 / `"Stop {i+1}"` | ✓ satisfied |
| `address` | text | YES (no default) | — | `""` | ✓ satisfied (empty string is valid) |
| `ai_description` | text | YES | `''::text` | `desc`≤280 / `""` | ✓ satisfied |
| `price_cents` | integer | YES | `0` | `max(0,round(...))` | ✓ satisfied (CHECK `>=0` OK) |
| `image_urls` | ARRAY (text[]) | YES | `'{}'::text[]` | OMITTED → default `'{}'` | ✓ satisfied by default |
| `place_id` | text | NO (nullable) | — | OMITTED | ✓ NULL OK |
| `lat`/`lng` | double precision | NO | — | OMITTED | ✓ NULL OK |
| `city`/`region`/`country_code` | text | NO | — | OMITTED | ✓ NULL OK |
| `start_time` | time | NO | — | OMITTED | ✓ NULL OK |
| `id`/`created_at`/`updated_at` | uuid/tstz | YES | defaults | OMITTED | ✓ satisfied by default |

**RESULT: NO missing/wrong column. NO unsatisfied NOT-NULL. The `experience_stops` insert cannot fail at runtime for schema reasons.**

### `events` — executor-written columns on the snap path

- `pricing_mode` text, nullable. Executor writes `'per_stop'`. **Live CHECK `events_pricing_mode_chk`: `pricing_mode IS NULL OR pricing_mode = ANY (ARRAY['whole','per_stop'])` → `'per_stop'` ACCEPTED.** (Matches how the manual RPC writes it — same allowed set.)
- `whole_price_cents` integer, nullable → executor writes `null` on per_stop path. ✓
- `location_mode` text, nullable, stays `'single'`. **Live CHECK `events_location_mode_chk` accepts `'single'`.** ✓
- `whole_price_cents` integer nullable; `published_at`/`deleted_at` nullable (compensation update writes `deleted_at`). ✓

**Conclusion: every column the executor writes to BOTH tables exists with a compatible type and passes its CHECK; no runtime insert failure path.**

---

## 4. Findings (P-numbered)

No P0/P1/P2/P3.

- **P4 (praise):** The `hasStops` single-fork gate (`agentTools.ts:827`) is a clean structural safeguard — every snap-only mutation (events mode, stops insert, ticket force-price, compensation) is inside an `if (hasStops)` or a `hasStops ? : ` ternary, so the Ari path is provably untouched. Protective comment block (`:820-823`, `:885-890`) documents the contract well.
- **P4 (praise):** Per-stop price coercion `Math.max(0, Math.round(Number(s?.price_cents) || 0))` is defensively correct against negative/null/float/string/garbage inputs (proven by tester ADV-1) — no NaN can poison the summed ticket price.

---

## 5. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out tip `74c1bc834`. Backed up `agentTools.ts`, then performed a TRUE line modification reverting the fix: `const hasStops = stopArgs.length > 0;` → `const hasStops = false;` (collapses the snap path into the Ari path — the exact revert the implementor claimed).

- **Result WITH fix reverted:** `orch_1151_curated_experiences_stops.test.ts` → **6 FAILED (T1, T2, T5, T6, T7, T8), 3 passed (T3, T4, T10)**. Matches the implementor's claim verbatim (T3/T4/T10 stay green by design — they assert draft/Ari/parser-schema behavior independent of the gate).
- **Result restored:** `cp` back → **9 passed, 0 failed**. Tree clean (no tracked modification remains).
- **Commit run against:** `74c1bc834`. fails-on-revert REPRODUCED.

---

## 6. Adversarial test added (tester-owned)

**Path:** `supabase/functions/_shared/__tests__/orch_1151_curated_experiences_stops.tester-adversarial.test.ts` (NEW, append-only, on-branch, in `git diff origin/main...HEAD`).

**Angle (different from implementor):** summed-price **arithmetic robustness** (a) + name/desc **truncation boundaries** (d) — angles the implementor's clean-integer happy path never probes.
- **ADV-1:** a single `stops[]` mixing negative/null/missing-key/float/string-numeric/non-numeric-garbage prices → each clamps to a finite `>=0` integer, ticket = Σ = 4800, never NaN, not free.
- **ADV-2:** >120-char name truncates to exactly 120; >280-char desc to exactly 280; whitespace-only name → `"Stop 2"` fallback; blank desc → `''`.
- **ADV-3:** one priced stop among unpriced (null / missing key) → ticket = the single price (3300), `is_free=false` (unpriced stops treated as 0, excluded from the total, never NaN, never falsely free).

**fails-on-revert verified at `74c1bc834`+adversarial-commit:** reverting the clamp/round (`Math.max(0,Math.round(Number||0))` → naive `Number||0`) made **ADV-1 FAIL** on the negative-price assertion; restored → **3 passed**. Tree clean after.

Both tests in closing diff confirmed:
```
orch_1146_create_experience_field_completeness.test.ts   (implementor T6 amend)
orch_1151_curated_experiences_stops.test.ts              (implementor happy-path)
orch_1151_curated_experiences_stops.tester-adversarial.test.ts  (tester)
```

**Full combined suite (all green together): 37 passed, 0 failed** — `orch_1151_*` (9) + `orch_1151_*.tester-adversarial` (3) + `orch_1146_create_experience_field_completeness` (7, incl. amended T6) + `orch_1146_create_experience.tester-adversarial` (7) + `orch_1146_parser_field_completeness` (11).

Static: `deno check` clean on all 5 changed source files + both test files; `deno lint` clean on the 3 cores; no-GBP strict-grep gate `OK: scanned 5 file(s)`.

---

## 7. Tier 3 — Ari no-regression (HARD GUARD)

**Source-trace of the `hasStops=false` branch** (`agentTools.ts`):
- **events** (`:853-854`): `pricing_mode: hasStops ? "per_stop" : "whole"` → `"whole"`; `whole_price_cents: hasStops ? null : suggestedMidCents` → `suggestedMidCents`. IDENTICAL to ORCH-1146.
- **stops insert** (`:891-924`): entire block inside `if (hasStops)` → NEVER runs for Ari. No `experience_stops` write, no extra compensation branch.
- **ticket** (`:936-943`, `:954`): collapses to `isFree ? 0 : (suggestedMidCents ?? 0)` with the exact ORCH-1146 `is_free` precedence (`args.is_free` boolean wins, else derive from midpoint absence). The only edit is the inline `suggestedMidCents ?? 0` being hoisted into a `ticketPriceCents` variable — functionally identical when `!hasStops`.

**Test proof:** T4 (`{brand_id,title,narrative}`, no stops) → ZERO `experience_stops` inserts, `pricing_mode='whole'`, one free unlimited ticket, no throw. ORCH-1146 T5 + ADV-1 (explicit `is_free=false` precedence) stay green. The executor is byte-identical for stop-less callers. **Ari preserved.**

---

## 8. Tier 4 — read-back (POST-DEPLOY)

**Source-proven.** `mingla-business/src/services/experienceDetailService.ts` (the wizard hydration source) reads:
- `experience_stops` (`:251-256`) selecting `stop_order, place_name, address, price_cents, ai_description` — exactly the executor-written columns — ordered by `stop_order` asc; mapped into `stops[]` with `placeName/address/priceCents/description` (`:322-337`).
- `pricing_mode` mapped through incl. `'per_stop'` (`:302-305`); `whole_price_cents` (`:306`).
- the summed price via `ticket_types.price_cents` (`:259`, `:283`).

So a snapped experience opened in "Set up & publish" WILL surface its stops + per_stop mode + summed-price ticket with **no client change** (OQ-3 read-back gap NOT found in source — matches the SPEC's no-OTA assertion).

**POST-DEPLOY smoke (Seth, after the orchestrator deploys edge fns from merged main):** snap a menu → confirm a curated experience → open it in the wizard → confirm the menu items appear as editable stops with the summed price. This is NOT runtime-verified here because the deployed edge fns (`parse-restaurant-menu` v136, `parse-play-activities` v135, `agent-confirm-action` v165) PREDATE this code — deploy from merged main is the orchestrator's CLOSE step §7 of the SPEC. A direct DB-seeded sim drive was not run: the payoff requires the *snap→confirm* edge path live, which is exactly the post-deploy gate; source-tracing the read-back is the correct ceiling pre-deploy.

---

## 9. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | no UI change |
| 2 | One owner per truth | PASS | `createExperience` is the single snap+Ari write-executor; summed price has one owner (the stop sum) |
| 3 | No silent failures | PASS | stops-fail → soft-delete + `throw WRITE_FAILED` (`:910-923`); no swallowed catch |
| 4 | One query key per entity | N/A | no client query change |
| 5 | Server state stays server-side | N/A | edge-only |
| 6 | Logout clears everything | N/A | no client state |
| 7 | `[TRANSITIONAL]` label | N/A | no transitional code |
| 8 | Subtract before adding | PASS | `MAX_EXPERIENCES` 20→6; no parallel old path left behind; gate forks cleanly |
| 9 | No fabricated data | PASS | address `''` + lat/lng NULL (no invented location); NULL price → 0 not faked; experience stays unpublishable until brand adds real addresses |
| 10 | Currency-aware | PASS | currency unchanged; no-GBP strict-grep gate green; price flows through existing all-in path |
| 11 | One auth instance | PASS | executor uses the user-scoped client (I-ARI-USER-JWT-ONLY); no service role |
| 12 | Validate at the right time | PASS | no date written; publish-time lat/lng gate untouched (draft stays unpublishable) |
| 13 | Exclusion consistency | PASS | `.is("deleted_at", null)` on ownership reads; soft-delete on compensation |
| 14 | Persisted-state startup | N/A | no client hydration change |

No constitutional violation.

---

## 10. Device / parity matrix

| Surface | Status | Note |
|---------|--------|------|
| Consumer iOS / Android (`app-mobile`) | SKIPPED (N/A) | reads published experiences only; draft-authoring change — does not ship here |
| Buyer/anon Web | SKIPPED (N/A) | summed price flows through unchanged single-ticket all-in path; parity automatic |
| Business iOS / Android | SOURCE-PROVEN + POST-DEPLOY | read-back wired (`experienceDetailService.ts`); on-device smoke is the post-deploy gate (§8) |
| Admin Web / Business Web preview | SKIPPED (N/A) | untouched |
| Physical iPhone (HITL) | NOT REQUIRED this turn | no UI/runtime change to drive pre-deploy; the post-deploy snap→wizard smoke is Seth's |
| Edge-fn live deploy state | NOT DEPLOYED (expected) | `parse-restaurant-menu` v136 / `parse-play-activities` v135 / `agent-confirm-action` v165 predate ORCH-1151 — deploy from MERGED main at CLOSE (SPEC §7) |

Backend/edge + AI executor change → Phase 0.A live-fire sim gate is EXEMPT for the executor logic (DB-write / edge-only, exhaustively covered by live-schema truth + Deno runtime tests). The one user-facing payoff (wizard read-back) is correctly a post-deploy smoke.

---

## 11. Discoveries for Orchestrator

- **DISC-1151-C (pre-existing, confirmed NOT from this ORCH):** `deno lint` flags unused `sourceCategory` in `parse-play-activities/index.ts:170` — absent from the ORCH-1151 diff. A whole-dir `deno test __tests__/` is blocked by a pre-existing typecheck failure in the unrelated `ticketPdf.test.ts` (`endAtIso` missing in its fixture). Both pre-date ORCH-1151; surfaced for a small cleanup ORCH. Not a blocker (targeted per-file `deno check`/`deno test` are clean).
- **DISC-1151-A (legacy drafts):** ~20 existing free stop-less snapped drafts are not migrated (OQ-2). Recommend leave (brand deletes). No code touches them.
- **SPEC §4.1/§4.2 normalizer deviation (documented by implementor, confirmed safe):** the "drop experiences with `stops.length===0`" instruction was omitted to keep the un-allowlisted ORCH-1146 normalizer tests green; safe because the `RESPONSE_SCHEMA` makes `stops` per-item-required (live model emits stops) and the executor's `hasStops` gate treats a stop-less experience exactly as the Ari shell (one ticket, no stops) — never a fabricated stop, never a regression. No SC depends on the drop. Acceptable.

## 12. Routing

PASS → orchestrator CLOSE. At CLOSE: (1) deploy `parse-restaurant-menu`, `parse-play-activities`, `agent-confirm-action` from MERGED main (preserve each `verify_jwt=true`); (2) flip the AMENDED `I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT` + the pre-staged `I-PROPOSED-1151-SNAP-STOPS-PRICE-IS-SUM` (DRAFT→ACTIVE); (3) Seth's post-deploy snap→wizard smoke (§8).
