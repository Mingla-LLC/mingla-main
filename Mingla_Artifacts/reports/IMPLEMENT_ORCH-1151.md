# IMPLEMENT — ORCH-1151 [curated experiences with menu items as STOPS + summed price + remove free ticket]

**Phase:** IMPLEMENT. Follows `SPEC_ORCH-1151_CURATED_EXPERIENCES_STOPS.md` + `INVESTIGATE_ORCH-1151_…md`.
**Worktree:** `~/Desktop/mingla-orchs/orch-1151-[curated-experiences-stops]` on branch `orch-1151-curated-experiences-stops` (rebased onto origin/main — up to date).
**Status:** implemented and verified (backend/edge + AI + executor; Deno typecheck + targeted Deno test suites + no-GBP strict-grep all green; fails-on-revert proven).
**Comms ledger:** read on entry. No OPEN `BLOCK` row targets `mingla-implementor` / `ORCH-1151` / `ALL`. The recent ALL/WARN/FYI rows (COMMS-0027 OTA cache, COMMS-0028 GIPHY key, COMMS-0032/0035 `expo-image-manipulator` native drift) touch native/OTA/image paths — ORCH-1151 is backend-edge-only with no OTA/native, so none apply. Nothing to ack.

---

## 1. Summary (plain English)

Snapping a restaurant menu or a Play activities list now produces a **curated few themed experiences** instead of ~20 flat one-per-dish drafts. Inside each experience the **menu items / activities are the stops** (name + description + price), the experience's single price is the **sum of its stops' prices**, and the junk free per-dish ticket is gone. Both AI parsers (Ve5 menu, Ve6 activities) changed, and the shared confirm executor learned to write the stops and the summed-price ticket. Everything is gated on the presence of a `stops` arg, so Ari's stop-less calls behave exactly as before. Dates, cover, and per-stop addresses stay blank — a snapped experience is a draft the brand finishes (adds real stop addresses + a date) before publishing. **Edge/backend only — no client OTA, no migration.**

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `cabafa4d2` unless noted) |
|----|-----------|--------|--------------------------------------------|
| SC-1 | Ve5 ≤6 experiences, each non-empty `stops[]` `{name,desc,price_cents}`; no flat per-dish | ✓ | `geminiMenuParser.ts` `MAX_EXPERIENCES=6`, `RESPONSE_SCHEMA.stops` (`required:["name","price_cents"]`), item `required:["title","narrative","stops"]`; test T10 |
| SC-2 | Ve6 ≤6 experiences, non-empty `stops[]`; play `intent_tags` still 5-id restricted | ✓ | `geminiActivitiesParser.ts` mirror; `filterPlayIntentTags` untouched; test T10 |
| SC-3 | both edge entries persist `stops` into `agent_pending_actions.tool_args` | ✓ | `parse-restaurant-menu/index.ts` + `parse-play-activities/index.ts` add `stops: exp.stops` |
| SC-4 | N stops → N rows (`stop_order` 0..N-1, `place_name`=item, `address=''`, `ai_description`=desc, `price_cents`=price; `place_id`/`lat`/`lng` NULL) | ✓ | `agentTools.ts` stop-rows builder; tests T1, T7, T8 |
| SC-5 | single ticket `price_cents = sum(stops)`; `is_free` true only when sum 0 | ✓ | `agentTools.ts` `stopSumCents` + ticket force-price; tests T1, T2, T5 |
| SC-6 | exactly ONE ticket; no per-stop tickets; not free unless sum 0 | ✓ | one `ticket_types` insert (I-1 preserved); tests T1, T5 |
| SC-7 | draft preserved: `status/visibility='draft'`, `published_at=null`, no `event_dates`, no `cover_media_*` | ✓ | events row unchanged on these fields; tests T3, amended T6 |
| SC-8 | Ari no-regression: `{brand_id,title,narrative}` → events + one free unlimited ticket, NO stops, no throw | ✓ | `hasStops` gate; test T4 + ORCH-1146 T5 still green |
| SC-9 | stops-insert failure soft-deletes orphan event, throws `WRITE_FAILED` | ✓ | `agentTools.ts` extended compensation; test T6 |
| SC-10 | with stops `pricing_mode='per_stop'` + `whole_price_cents=null`; without, `pricing_mode='whole'` (unchanged) | ✓ | events row conditional; tests T1, T2, T4 |

## 3. Files changed

| File | Δ (approx) |
|------|-----------|
| `supabase/functions/_shared/geminiMenuParser.ts` | +55 / -8 |
| `supabase/functions/_shared/geminiActivitiesParser.ts` | +56 / -7 |
| `supabase/functions/parse-restaurant-menu/index.ts` | +3 |
| `supabase/functions/parse-play-activities/index.ts` | +3 |
| `supabase/functions/_shared/agentTools.ts` (`createExperience` only) | +75 / -6 |
| `supabase/functions/_shared/__tests__/orch_1146_create_experience_field_completeness.test.ts` | T6 amend (−1 assertion, +comment) `[TEST-MOD-APPROVED ORCH-1151]` |
| `supabase/functions/_shared/__tests__/orch_1151_curated_experiences_stops.test.ts` | NEW, ~420 lines (T1–T8, T10) |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | amend I-1146-AI-EXPERIENCE-STAYS-DRAFT + pre-stage I-PROPOSED-1151-SNAP-STOPS-PRICE-IS-SUM (DRAFT) |

Commits:
- `cabafa4d2` — all 7 code + test files.
- registry + this report — committed separately (see §11).

## 4. Data-model changes applied

**None (no DDL, no migration).** The `experience_stops` table already has every needed column. The executor's `experience_stops` INSERT writes exactly these columns:

| Column | Value written | NOT-NULL? |
|--------|---------------|-----------|
| `event_id` | the new experience event id | NOT NULL ✓ |
| `stop_order` | array index `i` (0..N-1) | NOT NULL ✓ (`CHECK >= 0` satisfied) |
| `place_name` | `stop.name` trimmed ≤120, fallback `"Stop {i+1}"` if empty | NOT NULL ✓ |
| `address` | `""` (empty string — the address-uninferable decision; no fabrication) | NOT NULL ✓ |
| `ai_description` | `stop.description` trimmed ≤280 (or `""`) | NOT NULL ✓ |
| `price_cents` | `max(0, round(stop.price_cents \|\| 0))` | NOT NULL ✓ (`CHECK >= 0` satisfied) |

Omitted (nullable / DB-default): `place_id`, `lat`, `lng`, `city`, `region`, `country_code`, `start_time` (all NULL); `image_urls` (DB default `'{}'`); `id`/`created_at`/`updated_at` (DB defaults). Verified against `20260824000000_meta_orch_1059_sub_a_experience_stops.sql:78-100`.

**Summed-price logic:** `stopSumCents = Σ max(0, round(Number(stop.price_cents) || 0))`. The single `ticket_types` row is forced to `price_cents = stopSumCents`, `is_free = (stopSumCents === 0)` on the snap path; `events.pricing_mode='per_stop'`, `whole_price_cents=null`. The buyer-facing all-in price flows through the unchanged single-ticket `pg_public_event_tier_allin` path (no checkout change).

## 5. Edge functions touched (deploy from MERGED main — NOT this worktree)

| Function | `verify_jwt` to preserve | Why |
|----------|--------------------------|-----|
| `parse-restaurant-menu` | (unchanged — preserve existing) | threads `stops` into `tool_args` |
| `parse-play-activities` | (unchanged — preserve existing) | threads `stops` into `tool_args` |
| `agent-confirm-action` | (unchanged — preserve existing) | bundles `_shared/agentTools.ts` (the executor) — the ONLY write-executor caller |

`_shared/geminiMenuParser.ts` + `_shared/geminiActivitiesParser.ts` are bundled by the two parser functions. Deploy all three functions from merged main at CLOSE.

## 6. Regression tests added

- `supabase/functions/_shared/__tests__/orch_1151_curated_experiences_stops.test.ts` — T1 (3 priced menu stops → 3 rows + ticket=4700, `per_stop`, not free), T2 (Ve6 2 stops → 8800), T3 (draft-only with stops), T4 (Ari no-regression — zero stops + free unlimited ticket), T5 (zero-price → free + stops still written + explicit `is_free=false` ignored), T6 (atomicity — stops-fail soft-deletes orphan + no ticket), T7 (address NULL), T8 (NOT-NULL columns satisfied), T10 (both cores' schema + `MAX_EXPERIENCES=6`). **9 tests, all green.**
- Amended `orch_1146_create_experience_field_completeness.test.ts` T6 — removed the `experience_stops`-absent assertion (now permitted), kept `event_dates`-absent + `published_at` null + no cover. Append-only token `[TEST-MOD-APPROVED ORCH-1151]` in the commit body + in-file comment.

**fails-on-revert verified at `cabafa4d2`:** deleting the `const hasStops = stopArgs.length > 0;` gate (true line replacement → `hasStops = false`) made T1, T2, T5, T6, T7, T8 FAIL; restoring it returned all 9 to green. (T3/T4/T10 stay green on revert because they assert Ari/draft/parser-schema behavior, by design — the gate's two-fork guarantee.)

Full suite cross-check (all green together): `orch_1146_parser_field_completeness.test.ts` (11) + `orch_1146_create_experience_field_completeness.test.ts` (7, incl. amended T6) + `orch_1146_create_experience.tester-adversarial.test.ts` (7) + `orch_1151_curated_experiences_stops.test.ts` (9) = **34 passed, 0 failed**.

## 7. Old → New receipts

### geminiMenuParser.ts (Ve5)
**Before:** `MAX_EXPERIENCES=20`; flat per-dish experiences; no `stops` concept; `RESPONSE_SCHEMA` item `required:["title","narrative"]`; prompt "Each experience is ONE clear intent… Cap at 20."
**Now:** `MAX_EXPERIENCES=6` + `MAX_STOPS_PER_EXPERIENCE=5`; `ParsedExperienceStop` type + nested `stops[]` on `ParsedMenuExperience`; `RESPONSE_SCHEMA` adds nested `stops` (`required:["name","price_cents"]`) and item `required:["title","narrative","stops"]`; prompt groups items into a curated few (3–6), items-as-stops, 2–5 stops each, no invented prices; `normalizeStops` builds the array.
**Why:** SC-1, SC-10 (curated-few + items-as-stops model).
**Lines:** ~+55/-8.

### geminiActivitiesParser.ts (Ve6)
**Before/Now:** identical change to Ve5 in a SEPARATE file (cores not merged); keeps `capacity_min/max`, `filterPlayIntentTags`, play prompt vocabulary.
**Why:** SC-2.
**Lines:** ~+56/-7.

### parse-restaurant-menu/index.ts + parse-play-activities/index.ts
**Before:** `tool_args` carried title/narrative/price-range/currency/tags/etc., no stops.
**Now:** each adds `stops: exp.stops` so the nested stops persist into `agent_pending_actions.tool_args` and reach the executor on confirm.
**Why:** SC-3.
**Lines:** +3 each.

### agentTools.ts `createExperience`
**Before:** events row `pricing_mode:"whole"`, `whole_price_cents:suggestedMidCents`; ONE ticket free-when-zero from the suggested midpoint; NO `experience_stops` write; ticket-fail compensation only.
**Now:** `stops` tool-param added; `hasStops` gate forks the executor — when stops present: `pricing_mode:"per_stop"`, `whole_price_cents:null`, one `experience_stops` row per stop (after events insert, before ticket), the single ticket forced to `price_cents=stopSumCents` (free only when sum 0), and a stops-insert failure soft-deletes the orphan event + throws `WRITE_FAILED`. When stops absent: byte-identical to ORCH-1146 (whole mode, free-when-zero ticket, no stops).
**Why:** SC-4, SC-5, SC-6, SC-8, SC-9, SC-10.
**Lines:** ~+75/-6.

## 8. Cross-surface impact

| Surface | Affected? | Note |
|---------|-----------|------|
| Consumer iOS / Android (`app-mobile/`) | NO | reads published experiences; draft-authoring change only |
| Buyer/anon Web | NO | summed price flows through the unchanged single-ticket all-in path (parity automatic) |
| Business iOS / Android | YES (read-only) | snap → a few curated experiences; opening one in "Set up & publish" shows the menu items as editable stops + the summed price — via the EXISTING client read-back (`edit.tsx:72`, `ExperienceCreatorWizard.tsx:227`), no client change. **Parity automatic.** TEST must confirm on sim/device (OQ-3). |
| Admin Web / Business Web preview | NO | untouched |

**Edge-only, no OTA expected.** No manual cross-surface parity work.

## 9. Smoke / verification result

Backend/edge + AI-schema + DB-write redesign — no UI reproducer (Prime Directive 7 exemption; the wizard read-back is source-proven wired). Verified by: `deno check` on all 5 changed source files (clean); 34 Deno tests green; no-GBP strict-grep gate `OK: scanned 5 file(s)`; fails-on-revert at `cabafa4d2`. The business-app read-back (snapped→confirmed experience opens with stops + summed price) is the one runtime-unverified claim — routed to TEST (OQ-3); source-traced through `edit.tsx:72` + `ExperienceCreatorWizard.tsx:227`.

## 10. Known issues / deferred + DEVIATION

- **DEVIATION from SPEC §4.1/§4.2 (documented):** the SPEC said the normalizer should "Drop experiences with `stops.length === 0`." That hard drop is **omitted** — both normalizers now keep the experience and let `stops` normalize to `[]` when absent. Reason: the existing ORCH-1146 normalizer tests (`orch_1146_parser_field_completeness.test.ts`, NOT in the ORCH-1151 allowlist, append-only) feed stop-less fixtures and assert a normalized experience back; the hard drop broke 5 of them, and that file is not approved for modification. The omission is safe — the `RESPONSE_SCHEMA` already makes `stops` a required per-item field (so the live model emits stops), and the executor's `hasStops` gate treats a stop-less experience exactly as the Ari/manual shell path (one ticket, no stops) — never a fabricated stop and never a regression beyond today's status-quo behavior. No success criterion depends on the normalizer dropping. In-code comments mark this in both cores.
- **Pre-existing (NOT mine, NOT fixed):** `deno lint` flags `sourceCategory` unused in `parse-play-activities/index.ts:170` (confirmed absent from my diff). `deno test` on the whole `_shared/__tests__/` dir is blocked by a pre-existing typecheck failure in the unrelated `ticketPdf.test.ts` (`endAtIso` missing in its fixture) — also not in my diff. Surfaced for the orchestrator; out of ORCH-1151 scope.
- **Legacy data (DISC-1151-A / OQ-2):** ~20 existing free stop-less snapped drafts are not migrated — recommend leave (brand deletes).

## 11. Operator action required

- **No migration.** No `db push`. (NO DDL — confirmed zero new files in `supabase/migrations/`.)
- **Edge deploy at CLOSE, from MERGED main:** `parse-restaurant-menu`, `parse-play-activities`, `agent-confirm-action` (bundles `_shared/agentTools.ts`). Preserve each function's existing `verify_jwt`. Do NOT deploy from this worktree (COMMS edge-deploy clobber hazard).
- **Invariant flips at CLOSE (orchestrator):** flip the AMENDED `I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT` + the pre-staged `I-PROPOSED-1151-SNAP-STOPS-PRICE-IS-SUM` (DRAFT → ACTIVE).

## 12. Discoveries for Orchestrator

- **DISC-1151-C (pre-existing lint/typecheck debt):** `parse-play-activities/index.ts:170` unused `sourceCategory`; `ticketPdf.test.ts` fixture missing `endAtIso` → whole-dir `deno test` typecheck fails. Both pre-date ORCH-1151. Worth a small cleanup ORCH.
- **DISC-1151-A (legacy drafts):** see §10 — decision needed (recommend leave).
- **DISC-1151-B (atomicity):** resolved here — stops-insert failure now soft-deletes the orphan event (extended compensation).
- **OQ-3 (read-back):** TEST must confirm on sim/device that a snapped→confirmed experience opens in "Set up & publish" with stops + summed price; if a gap is found it is a stop-and-amend (possible small client change + OTA).
