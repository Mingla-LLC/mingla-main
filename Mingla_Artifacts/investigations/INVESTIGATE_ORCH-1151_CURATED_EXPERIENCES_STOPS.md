# INVESTIGATE — ORCH-1151 [snap → curated experiences with menu items as STOPS + summed price + remove free ticket]

**Phase:** INVESTIGATE (no fix proposed here — see the companion SPEC).
**Worktree:** `~/Desktop/mingla-orchs/orch-1151-[curated-experiences-stops]` on branch `orch-1151-curated-experiences-stops` (rebased onto `origin/main`).
**Date:** 2026-06-16.
**Comms ledger:** read on entry. No OPEN `BLOCK`/`WARN` entry targets `mingla-forensics`, `ORCH-1151`, or `ALL` (the `ALL`-targeted rows are all RESOLVED). Nothing to ack.

---

## Symptom summary (expected vs actual)

**Today (actual).** A menu snap (Ve5 `parse-restaurant-menu`) or activities snap (Ve6 `parse-play-activities`) produces up to **20 FLAT experiences — one per dish/activity**. Each is a standalone draft with:
- a single `ticket_types` row that is almost always a **FREE $0 ticket** (no menu price flows into a price), and
- **NO `experience_stops` rows** (the AI path is forbidden from writing stops by `I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT`).

So the brand sees ~20 junk one-line experiences, each free, each stop-less.

**Wanted (expected, LOCKED by Seth).** A snap produces a **CURATED FEW themed experiences**. Within each experience the **menu items are the STOPS** (the crux). Each experience has a descriptive **name + description**, the **experience price = the SUM of its item-stops' menu prices**, and the **free per-dish ticket is REMOVED**. Applies to BOTH Ve5 (menu items → stops) and Ve6 (activities → stops). Vibes inferred where sensible. **Dates/cover/address stay blank** (draft-only, no fabrication).

---

## Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` | Mandatory entry scan. |
| 2 | `supabase/functions/_shared/geminiMenuParser.ts` | Ve5 responseSchema + system prompt (flat per-item output). |
| 3 | `supabase/functions/_shared/geminiActivitiesParser.ts` | Ve6 responseSchema + system prompt (flat per-item output). |
| 4 | `supabase/functions/parse-restaurant-menu/index.ts` | Ve5 edge entry — builds `tool_args` per experience → `agent_pending_actions`. |
| 5 | `supabase/functions/parse-play-activities/index.ts` | Ve6 edge entry — same shape with play fields. |
| 6 | `supabase/functions/_shared/agentTools.ts` (`createExperience`) | The ORCH-1146 executor: events insert + the ONE ticket insert; no stops. |
| 7 | `supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql` | The `experience_stops` table DDL + `biz_create_experience` RPC (the manual stop-create shape to mirror). |
| 8 | `mingla-business/src/services/experienceDetailService.ts` | Read-back: how stops are loaded for the wizard. |
| 9 | `mingla-business/app/experience/[id]/edit.tsx` | The "Set up & publish" edit screen: maps `exp.stops` → `ExperienceStopDraft[]`. |
| 10 | `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` + `experienceWizardTypes.ts` | Wizard hydration from `initialDraft.stops`; the `ExperienceStopDraft` shape. |
| 11 | `mingla-business/src/services/publicExperienceService.ts` | Checkout/public read of the experience price (the single ticket). |
| 12 | `supabase/functions/_shared/__tests__/orch_1146_create_experience_field_completeness.test.ts` | The test (T6) that enforces the old "no stops" rule. |
| 13 | `supabase/functions/_shared/__tests__/orch_1146_create_experience.tester-adversarial.test.ts` | Adversarial: is_free precedence + Ari-minimal no-regression. |
| 14 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (4596–4607) | The three ORCH-1146 invariants. |
| 15 | `.github/scripts/strict-grep/orch-1146-no-gbp-currency-default.mjs` | The no-GBP gate scope (5 files). |

---

## Q-scorecard

### Q1 — What is the current parser output + executor write path? Cite the lines that create the FREE ticket and that DON'T write stops.

**Ve5 output shape** (`geminiMenuParser.ts:39-62`): a flat array `experiences[]`, each `{ title, narrative, suggested_price_min_cents, suggested_price_max_cents, currency, intent_tags[], is_free, suggested_time_of_day, confidence }`. System prompt (`:64-70`): *"Each experience is ONE clear intent… Cap at 20 experiences."* **No `stops` concept.** `MAX_EXPERIENCES = 20` (`:7`), `MAX_OUTPUT_TOKENS = 8192` (`:8`).

**Ve6 output shape** (`geminiActivitiesParser.ts:42-67`): same flat array + `capacity_min/capacity_max`. System prompt (`:69-78`): *"Each experience is ONE clear bookable or walk-in offering… Cap at 20."* `intent_tags` restricted to 5 play ids (`:75`). **No `stops` concept.**

**Edge → pending action.** `parse-restaurant-menu/index.ts:195-236` loops each parsed experience and inserts ONE `agent_pending_actions` row per experience with `tool_name: "create_experience"` and the flat `tool_args` (`:196-208`). `parse-play-activities/index.ts:206-249` is identical with the play fields. Each experience becomes its own pending action; the brand later confirms each.

**Executor** (`agentTools.ts` `createExperience`, `:646-905`). On confirm (via `agent-confirm-action/index.ts:188-200` — the ONLY write-executor caller), it:
1. Inserts ONE `events` row, `event_type:"experience"`, `status:"draft"`, `visibility:"draft"`, `published_at:null`, `location_mode:"single"`, `pricing_mode:"whole"`, `whole_price_cents:suggestedMidCents` (`:802-817`). Writes `experience_intents` only if a canonical vibe mapped (`:824`).
2. **Creates the FREE ticket** — `agentTools.ts:851-885`:
   - `:851-853` — `const isFree = typeof args.is_free === "boolean" ? args.is_free : (suggestedMidCents === null || suggestedMidCents <= 0);` → with no price, `isFree=true`.
   - `:864` — `price_cents: isFree ? 0 : (suggestedMidCents ?? 0)`.
   - `:867` — `is_free: isFree`.
   - `:883-885` — inserts the row into `ticket_types`.
3. **Does NOT write `experience_stops`** — there is no `experience_stops` insert anywhere in `createExperience`. The events insert (`:826`) and the ticket insert (`:883`) are the only two writes.

**Verdict (Q1):** CONFIRMED. The flat 20-experience output, the FREE ticket at `:851-885`, and the absence of any `experience_stops` write are all source-proven.

---

### Q2 — The STOPS schema (the crux): exact table, every column, every NOT-NULL, the address-uninferable decision; how the wizard reads stops back; how the manual wizard creates stops.

**Table `public.experience_stops`** — DDL at `20260824000000_meta_orch_1059_sub_a_experience_stops.sql:78-100`. Every column:

| Column | Type | NULL? | Default | Notes |
|--------|------|-------|---------|-------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `event_id` | uuid | **NOT NULL** | — | FK → `events(id)` ON DELETE CASCADE |
| `stop_order` | integer | **NOT NULL** | — | 0-based; `CHECK >= 0`; `UNIQUE(event_id, stop_order)` |
| `place_id` | text | nullable | — | Mapbox feature id; NULL allowed transiently in draft |
| `place_name` | text | **NOT NULL** | — | → `CuratedStop.placeName` |
| `address` | text | **NOT NULL** | — | Mapbox formatted address; **the RPC writes `COALESCE(v_s_address,'')` so empty string satisfies NOT-NULL** (`:481`) |
| `city` | text | nullable | — | |
| `region` | text | nullable | — | |
| `country_code` | text | nullable | — | |
| `lat` | double precision | nullable | — | non-null gated at PUBLISH (I-3), not column-level |
| `lng` | double precision | nullable | — | |
| `image_urls` | text[] | NOT NULL | `'{}'` | `CHECK ≤5` |
| `start_time` | time | nullable | — | optional per-stop time |
| `price_cents` | integer | NOT NULL | `0` | `CHECK >= 0`; **per-stop price; display-only in whole mode** |
| `ai_description` | text | NOT NULL | `''` | per-stop blurb → `CuratedStop.aiDescription`; required at PUBLISH (1–280) but column default `''` |
| `created_at` / `updated_at` | timestamptz | NOT NULL | `now()` | |

**The five required-at-INSERT fields the AI executor must satisfy:** `event_id`, `stop_order`, `place_name` (the only one needing real content from the AI), `address`, `image_urls`, `price_cents`, `ai_description` — but `address` accepts `''`, `image_urls` defaults `'{}'`, `price_cents` defaults `0`, `ai_description` defaults `''`. So the AI must supply only `event_id`, `stop_order`, `place_name` (and `price_cents`, `ai_description` for the feature). **`lat`/`lng`/`place_id` are NULLABLE at the column level** — they are gated only at PUBLISH (I-3), not at insert. **This is the address-uninferable decision: a menu item has no address. The AI stop carries `place_name` + `ai_description` + `price_cents` only; `place_id`/`lat`/`lng`/`address` are left NULL/`''`. The experience therefore stays a DRAFT and cannot publish until the brand adds an address per stop in the wizard (or chooses single-location mode and validates `stops[0]`). No address is fabricated.** See Open Question OQ-1.

**Read-back** (`experienceDetailService.ts:248-336`): `loadExperienceDetail` selects `id, stop_order, place_id, place_name, address, city, region, country_code, lat, lng, image_urls, start_time, price_cents, ai_description` from `experience_stops` (`:251-253`) and maps each into `ExperienceStopRow` including `placeName: s.place_name` (`:326`) and `description: s.ai_description` (`:336`).

**Wizard hydration** (`app/experience/[id]/edit.tsx:72-86`): the "draft → edit" path maps `exp.stops` → `ExperienceStopDraft[]` carrying `placeName`, `address`, `priceMajor: centsToMajor(s.priceCents)` (`:84`), and `description: s.description` (`:85`). `ExperienceCreatorWizard.tsx:227-229` seeds its `stops` state from `initialDraft.stops`. So **AI-written stops render in the wizard with zero client code change.**

**Manual stop-create shape (to mirror)** — `biz_create_experience` RPC, INSERT at `20260824000000…:472-485`: writes `event_id, stop_order, place_id, place_name, address (COALESCE→''), city, region, country_code, lat, lng, image_urls, start_time, price_cents, ai_description`. In `whole` pricing mode it writes `price_cents = 0` (display-only); in `per_stop` mode it writes the stop's price (`:469-470`). The summed total lands on the ticket (`:489-507`).

**Verdict (Q2):** CONFIRMED. Schema fully enumerated; only `place_name` is a hard content requirement from the AI; `address` accepts `''`; `lat/lng/place_id` are nullable at insert (publish-gated). The read-back + wizard hydration is already wired end-to-end.

---

### Q3 — The price model: how the single experience price is stored, and how checkout reads it so a summed price is sellable.

The experience's **sellable price is the single `ticket_types` row's `price_cents`** (the I-1 ONE-TICKET spine, `20260824…:16,72,105`). `events.whole_price_cents` is **display/audit redundancy only** (migration comment `:71-72`). The manual RPC computes `v_resolved_total` as the SUM of stop prices when `pricing_mode='per_stop'` (`20260824…:357-360`) and writes that total to the single ticket (`:498`).

**Checkout/public read** — `publicExperienceService.ts:161-167` selects the sellable ticket as the `available_online` ticket with `price_cents > 0`; the buyer-facing all-in price comes through the ORCH-1147 single-owner `pg_public_event_tier_allin` path keyed by `ticket_types.id` (`:28, :155, :213-217, :287-296`). So **if the executor writes one ticket at `price_cents = SUM(stops)`, the existing checkout engine sells the summed price with no checkout change.** The free-when-zero behavior (`is_free = price === 0`) then only fires when the menu truly has no prices.

**Verdict (Q3):** CONFIRMED. Set the single ticket's `price_cents = sum of stop prices`; checkout reads it as-is. No `ticket-checkout-create` change required.

---

### Q4 — The invariant reversal: which invariant forbids AI stops today, what the exact amended rule is, and which test/gate enforced "no stops".

**Today** `I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT` (ACTIVE, `INVARIANT_REGISTRY.md:4604-4606`) reads: *"No AI/snap path writes `event_dates`, `experience_stops`, `cover_media_*`, or `published_at`…"* — it **forbids `experience_stops`**.

**Enforced by** the Deno test `orch_1146_create_experience_field_completeness.test.ts` **T6** (`:256-281`), specifically **line 275**:
`assertEquals(rec.inserts.some((i) => i.table === "experience_stops"), false);`
This is the exact assertion ORCH-1151 must flip.

**The other two ORCH-1146 invariants STAY unchanged:**
- `I-PROPOSED-1146-PARSER-CANONICAL-VIBES-OR-NULL` (`:4596-4598`) — vibes stay canonical-or-NULL. Preserved.
- `I-PROPOSED-1146-PARSER-NO-GBP-DEFAULT` (`:4600-4602`) — no hardcoded GBP. Preserved; gate file `.github/scripts/strict-grep/orch-1146-no-gbp-currency-default.mjs` (5-file scope) is untouched by this work.

**Verdict (Q4):** CONFIRMED. Amend `I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT` to PERMIT `experience_stops` while still forbidding `event_dates`/`cover_media_*`/`published_at`. Update test `orch_1146…field_completeness.test.ts` T6 line 275 (`event_dates` still false; `experience_stops` now allowed/expected). The SPEC names the amended rule.

---

### Q5 — Ari no-regression: can the new behavior key off the presence of a `stops` arg so a minimal Ari call is unaffected?

`create_experience` is shared with Ari chat (`agentTools.ts:646`, registered in `AGENT_TOOLS` `:911-920`; READ-ONLY set excludes it `:927`). The ORCH-1146 tests prove the Ari-minimal contract: **T5** (`orch_1146…field_completeness.test.ts:220-253`) — a `{brand_id, title, narrative}` call still yields a draft + free unlimited ticket, intents NULL, no throw; **ADV-1** (`…tester-adversarial.test.ts:108-130`) — explicit `is_free` precedence. Ari calls carry **no `stops` arg**.

**The new behavior must be gated on `Array.isArray(args.stops) && args.stops.length > 0`:** when stops are present (the snap path), write `experience_stops` + set `price_cents = sum(stops)` + suppress the free-ticket derivation; when absent (Ari), the executor behaves EXACTLY as today (one ticket, free-when-zero, no stops). This is additive and keys cleanly off the `stops` arg.

**Verdict (Q5):** CONFIRMED. A `stops`-presence gate keeps Ari's stop-less path byte-identical to today.

---

### Q6 — How many experiences + grouping; the new Gemini schema; model/token limits.

Today both parsers cap at 20 flat experiences (`MAX_EXPERIENCES=20`). The new model returns a **curated few** experiences, each containing a **subset of items as stops**. The new Gemini responseSchema (both cores, kept SEPARATE) becomes an array of experiences where each is `{ name (→title), description (→narrative), vibe?/intent_tags?, stops: [{ name, description, price_cents }] }`. The executor sums `stops[].price_cents` for the experience price.

**Token note:** richer nested output (a handful of experiences × several stops × name/desc/price) is well within `MAX_OUTPUT_TOKENS=8192` at `temperature=0.2` on `gemini-2.5-flash`, **provided the experience count is capped low** (recommend a curated cap of ~3–6 experiences with ≤5 stops each — the `experience_stops` table `CHECK`-free at insert but the publish gate is 2–5 stops, so 2–5 stops per experience aligns with the wizard's publish rule). Capping the experience count (down from 20) actually REDUCES total tokens vs today while adding nesting.

**Verdict (Q6):** CONFIRMED. Curated few (cap ~3–6) experiences, each with a nested `stops[]` of `{name, description, price_cents}`; executor sums stop prices. Token budget is comfortable; lowering the experience cap offsets the added nesting.

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | Seth's LOCKED goal: curated few, items-as-stops, summed price, no free ticket, vibes inferred, dates/cover/address blank. | — |
| **Schema** | `experience_stops` exists with `place_name` NOT-NULL and `lat/lng/place_id` NULLABLE-at-insert (publish-gated). `ticket_types.price_cents` is the sellable price. Schema **already supports** AI stops with no address. | **No contradiction** — schema is ready; only the executor + invariant forbid it. |
| **Code** | Executor writes one free-ish ticket, no stops (`agentTools.ts:851-885`). Parsers emit flat per-item experiences. Read-back + wizard already render stops. | The executor/parsers contradict the desired model — this is the build target, not a bug. |
| **Runtime** | Not run (pure backend/edge + DB + AI-schema redesign — exempt from live-fire per Prime Directive 7; no UI reproducer). The wizard read-back path is source-proven wired (`edit.tsx:72`, `ExperienceCreatorWizard.tsx:227`). | — |
| **Data** | Existing snapped drafts (≈20 free stop-less rows) are legacy; not migrated by this ORCH (Open Question OQ-2). | — |

No layer contradicts another in a way that hides a bug; this is a deliberate model redesign with the schema already in place.

---

## Repro evidence

**Not a runtime bug — no reproducer.** This is a backend/edge + Gemini-schema + DB-write redesign of a desired output model. Per Prime Directive 7, pure backend/edge/AI-schema work is exempt from sim live-fire. The read-back rendering path was verified by source trace (manifest items 8–10), not by sim, because no client change is required and the path already ships. Confidence is bound accordingly (see below).

---

## Blast radius / cross-surface map

**In-scope (edge + AI + DB-write + invariant/test):**
- `supabase/functions/_shared/geminiMenuParser.ts` (Ve5 schema + prompt + types + normalizer).
- `supabase/functions/_shared/geminiActivitiesParser.ts` (Ve6 schema + prompt + types + normalizer).
- `supabase/functions/parse-restaurant-menu/index.ts` + `parse-play-activities/index.ts` (`tool_args` pass-through of `stops`).
- `supabase/functions/_shared/agentTools.ts` `createExperience` (write `experience_stops`, sum price, suppress free ticket, gated on `stops`).
- The ORCH-1146 test files (amend T6 + add ORCH-1151 cases).
- `INVARIANT_REGISTRY.md` (amend the one invariant — orchestrator owns the ACTIVE flip; the SPEC pre-stages it).

**Out-of-scope (NOT covered — one-phrase reason each):**
- Consumer iOS/Android (`app-mobile/`) — **no client change**; consumer reads the same published experience model; this only changes how drafts are authored.
- Business iOS/Android (`mingla-business/` native) — **read-back already renders AI stops** (`edit.tsx:72`, wizard hydration); **edge-only, no OTA** unless TEST finds a read-back gap.
- Buyer/anonymous Web — **no checkout change**; the summed price flows through the existing single-ticket all-in path.
- Admin Web / Business Web preview — untouched.
- `ticket-checkout-create` — untouched (reads the single ticket as today).
- `biz_create_experience` RPC + the manual wizard — untouched (the manual per_stop path already sums; this ORCH only teaches the AI executor the same).
- Currency/de-GBP gate + canonical-vibes invariant — preserved, not modified.

**Recurring-pattern note:** the executor's two-insert non-atomic compensation pattern (`agentTools.ts:886-901`) must be EXTENDED to cover the new stops insert (a stops-insert failure must also soft-delete the orphan event), or the snap can leave a partial draft. The SPEC must specify this.

---

## Invariant impact (flagged, NOT pre-decided)

- **`I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT`** — MUST be AMENDED: permit `experience_stops`; keep forbidding `event_dates` / `cover_media_*` / `published_at`. Enforcing test `orch_1146…field_completeness.test.ts` T6 line 275 must change.
- **`I-PROPOSED-1146-PARSER-CANONICAL-VIBES-OR-NULL`** — PRESERVED (vibes still canonical-or-NULL).
- **`I-PROPOSED-1146-PARSER-NO-GBP-DEFAULT`** — PRESERVED (no GBP literal in the 5 gate files; the new stop/price code adds none).
- **I-1 ONE-TICKET (META-ORCH-1059)** — PRESERVED: still exactly ONE `ticket_types` row, now at the summed price.
- **I-2 / I-4 (2–5 stops on publish / publish-time dates)** — PRESERVED: drafts may carry stops with no validated location/date; publish still gates 2–5 validated stops + a date.
- A **new** invariant is proposed in the SPEC: `I-PROPOSED-1151-SNAP-STOPS-PRICE-IS-SUM` (DRAFT).

## Discoveries for Orchestrator

- **DISC-1151-A (legacy data):** the ~20 existing free stop-less snapped drafts from before ORCH-1151 are not migrated/cleaned by this ORCH. Surfaced as OQ-2 — likely a no-op (drafts; brand deletes them), but flag for a decision.
- **DISC-1151-B (atomicity):** the executor's orphan-compensation (`agentTools.ts:886-901`) currently only covers a ticket-insert failure. With a new stops insert, a stops-insert failure must ALSO soft-delete the orphan event. The SPEC specifies the extended compensation order.

## Confidence level

**probable.** Every layer is source-proven (schema DDL, executor lines, parser schemas, read-back path, the enforcing test line, the invariant text). No runtime repro was required (backend/edge/AI-schema redesign — Prime Directive 7 exemption). The one unverified-at-runtime claim is that the wizard renders AI-written stops without a client change — this is source-traced through `edit.tsx:72` + `ExperienceCreatorWizard.tsx:227` but not sim-confirmed; the SPEC routes that confirmation to TEST. No invented findings.

## Recommended next phase + scope

**SPEC (this same dispatch — IA mode), then IMPLEMENT, then TEST.** Scope is exactly: rewrite the two Gemini cores to emit curated experiences with nested stops (cores kept SEPARATE); thread `stops` through both edge `tool_args`; teach `createExperience` to write `experience_stops` + set the single ticket price = sum-of-stops + suppress the free per-dish ticket, all gated on `stops` presence so Ari is unaffected; amend the one invariant + its enforcing test. **Backend/edge + AI + one DB-write executor only — no client OTA expected** (TEST confirms read-back). Do NOT touch the manual wizard UI, the `biz_create_experience` RPC, `ticket-checkout-create`, the canonical-vibes / no-GBP invariants, or the consumer app.
