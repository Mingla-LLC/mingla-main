# SPEC — ORCH-1151 [snap → curated experiences with menu items as STOPS + summed price + remove free ticket]

**Phase:** SPEC (build contract). Follows `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1151_CURATED_EXPERIENCES_STOPS.md`.
**Worktree:** `~/Desktop/mingla-orchs/orch-1151-[curated-experiences-stops]` on branch `orch-1151-curated-experiences-stops`.
**Provider note:** Gemini structured-JSON only — no Anthropic/OpenAI/Stripe surface. No external-API-docs invariant (COMMS-0026) triggered beyond Gemini's existing responseSchema, which both cores already use.

---

## 1. Executive summary

Today a menu/activities snap produces ~20 flat experiences — one per dish/activity — each a stop-less DRAFT with a junk FREE $0 ticket. ORCH-1151 changes the snap to produce a **curated few themed experiences**, each containing its **menu items as STOPS**, with a descriptive name + description, an experience **price = the SUM of its stops' prices**, and **no free per-dish ticket**. Both parsers (Ve5 restaurant-menu, Ve6 play-activities) change; the shared executor `create_experience` learns to write `experience_stops` and the summed-price ticket. Everything is gated on the presence of a `stops` arg so Ari's stop-less calls are byte-identical to today. Dates, cover, and per-stop addresses stay blank (draft-only; no fabrication). The DB schema and the business-app read-back/wizard already support AI-authored stops, so this is **backend/edge + AI + one executor only — no client OTA expected.**

## 2. Scope & non-goals

**In scope:**
- Rewrite the Ve5 + Ve6 Gemini responseSchema + system prompt to emit `experiences[] { name, description, vibe?/intent_tags?, stops[] { name, description, price_cents } }`. **Cores stay SEPARATE files** (one menu, one activities).
- Thread `stops` through both edge `tool_args` builders.
- Teach `createExperience` (`agentTools.ts`) to: write `experience_stops` rows from `args.stops`; set the single `ticket_types.price_cents = sum(stops[].price_cents)`; suppress the free-per-dish ticket; set `pricing_mode='per_stop'`; ALL gated on `Array.isArray(args.stops) && args.stops.length > 0`.
- Extend the executor's orphan-compensation to cover a stops-insert failure.
- Amend `I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT` to permit `experience_stops`; update its enforcing test (T6 line 275).
- Add ORCH-1151 regression tests (happy + adversarial). Pre-stage `I-PROPOSED-1151-SNAP-STOPS-PRICE-IS-SUM` (DRAFT).

**Non-goals (explicit):**
- NO change to the business-app wizard UI, `experienceWizardTypes.ts`, or `ExperienceCreatorWizard.tsx` — the read-back already renders AI stops (`edit.tsx:72`). (If TEST finds a read-back gap, that's a stop-and-amend, not assumed scope.)
- NO change to `biz_create_experience` RPC, `ticket-checkout-create`, `publicExperienceService.ts`, or the consumer app.
- NO change to the canonical-vibes invariant or the no-GBP gate (both preserved).
- NO new `experience_stops` DDL — the table already has every needed column (Q2).
- NO migration of the ~20 legacy free stop-less drafts (OQ-2 / DISC-1151-A).
- NO publish path change — snapped experiences stay DRAFT; publish still gates 2–5 validated stops + a date.

**Assumptions:** the live `experience_stops` schema matches `20260824000000…sql` (verified in the investigation); `place_id`/`lat`/`lng` are nullable at insert; `address` accepts `''`.

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior | Files touched here | Parity |
|---|---------|----------|----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | None — consumer reads published experiences; this only changes draft authoring | none | n/a |
| 2 | Consumer Android | NO | None | none | n/a |
| 3 | Buyer/anon Web | NO | None — summed price flows through the unchanged single-ticket all-in path | none | automatic (shared price read) |
| 4 | Business iOS | YES (read-only) | Snap → a few curated experiences; opening one in "Set up & publish" shows its menu items as editable stops with the summed price | none (read-back already wired: `edit.tsx:72`, `ExperienceCreatorWizard.tsx:227`) | automatic (shared edge + existing read-back) |
| 5 | Business Android | YES (read-only) | Same as iOS | none | automatic |
| 6 | Admin Web | NO | None | none | n/a |
| 7 | Business Web preview | NO | None | none | n/a |

**Edge-only, no OTA expected.** Surfaces 4/5 are covered by the existing client read-back — TEST confirms (Open Question OQ-3); if a gap is found, the implementor stops-and-amends.

## 4. Layered specification

### 4.1 AI / Gemini layer — Ve5 (`supabase/functions/_shared/geminiMenuParser.ts`)

**New types (replace `ParsedMenuExperience`):**
```
interface ParsedExperienceStop { name: string; description: string; price_cents: number | null; }
interface ParsedMenuExperience { title; narrative; currency; intent_tags[]; is_free; suggested_time_of_day; confidence; stops: ParsedExperienceStop[]; }
```
Keep `currency`, `intent_tags`, `is_free`, `suggested_time_of_day`, `confidence` exactly as today (de-GBP, canonical-vibes mapping happens downstream in the executor). `suggested_price_min_cents`/`suggested_price_max_cents` become DERIVED from the stop sum (keep the fields on the type for executor compatibility, set both = the stop-sum so the existing midpoint code yields the sum; OR drop them and pass the sum directly — see executor 4.4).

**New `RESPONSE_SCHEMA`:** `experiences[]` items gain a required nested `stops` array; each stop `{ name: string, description: string, price_cents: integer }`. Item `required: ["title","narrative","stops"]`; stop `required: ["name","price_cents"]`.

**New `SYSTEM_PROMPT`** (menu): instruct Gemini to group menu items into a CURATED FEW themed experiences (recommend "3 to 6"), each a coherent theme (e.g. "Date-Night Tasting Trio", "Brunch Crawl for Four"); the **menu items are the stops**; each stop carries the item name, a one-line description, and its **printed price in cents** (`price_cents`); each experience gets a descriptive title + narrative; infer a vibe via `intent_tags` where sensible; **do not invent items or prices not on the menu**; leave currency empty if unclear (unchanged de-GBP rule). Cap experiences at **`MAX_EXPERIENCES = 6`** (lower the constant from 20) and stops per experience at **2–5** (align with the publish gate).

**New normalizer:** `normalizeMenuParsePayload` builds `stops[]` — each stop's `price_cents` via the existing `asCents` (NULL → treat as 0 for summing), `name` via `asString(…,120)`, `description` via `asString(…,280)`. Drop experiences with `stops.length === 0`. Keep the `defaultCurrency=""` de-GBP default (unchanged).

### 4.2 AI / Gemini layer — Ve6 (`supabase/functions/_shared/geminiActivitiesParser.ts`)

Mirror 4.1 **in a SEPARATE file** (do not merge the cores). Keep play-specific fields (`capacity_min`, `capacity_max`, `intent_tags` restricted to the 5 play ids via `filterPlayIntentTags`). The nested `stops[]` shape is identical (`{ name, description, price_cents }`). System prompt: group activities/packages into a curated few bookable experiences, the **activities are the stops**, each stop carries its name + blurb + printed price. Same `MAX_EXPERIENCES = 6`, same 2–5-stops guidance.

### 4.3 Edge layer — `parse-restaurant-menu/index.ts` + `parse-play-activities/index.ts`

In each per-experience `tool_args` builder (`parse-restaurant-menu/index.ts:196-208`; `parse-play-activities/index.ts:207-221`), **add `stops: exp.stops`** to the `tool_args` object so the nested stops persist into `agent_pending_actions.tool_args` and reach the executor on confirm. No other edge change (auth, rate-limit, file validation, currency pass-through all unchanged). Update the `temporaryCategory` and existing fields exactly as today.

### 4.4 Executor — `supabase/functions/_shared/agentTools.ts` `createExperience`

**Tool parameter schema (`:657-682`):** add an optional `stops` array param: `stops: { type: "array", items: { type: "object", properties: { name: {type:"string"}, description: {type:"string"}, price_cents: {type:"integer"} } } }`, description noting it is the snap path (items-as-stops); absent = Ari/manual shell.

**Executor body changes (gated on `const hasStops = Array.isArray(args.stops) && args.stops.length > 0;`):**

1. **Compute the summed price** when `hasStops`: `const stopSumCents = args.stops.reduce((sum, s) => sum + Math.max(0, Math.round(Number(s?.price_cents) || 0)), 0);`.
2. **events row** (`:802-817`): when `hasStops`, set `pricing_mode: "per_stop"` and `whole_price_cents: null` (per_stop mode's audit redundancy is null per the manual RPC `:426`); when `!hasStops`, keep today's `pricing_mode:"whole"` + `whole_price_cents: suggestedMidCents`. `location_mode` stays `"single"` (single shared location; the brand validates one address at publish — see 4.5 address decision).
3. **experience_stops insert** (NEW, only when `hasStops`, AFTER the events insert returns `eventId`, BEFORE the ticket insert): build rows, one per `args.stops[i]`:
   ```
   { event_id: eventId, stop_order: i, place_name: <stop.name trimmed, 1-120; fallback "Stop {i+1}" if empty>,
     address: "", ai_description: <stop.description trimmed, ≤280>, price_cents: max(0, round(stop.price_cents||0)) }
   ```
   OMIT `place_id`, `lat`, `lng`, `city`, `region`, `country_code`, `start_time` (all nullable; left NULL — the address-uninferable decision, 4.5). `image_urls` omitted (DB default `'{}'`). Insert as a single batch `.insert(stopRows)`.
4. **Ticket** (`:851-885`): when `hasStops`, FORCE `price_cents = stopSumCents`, `is_free = (stopSumCents === 0)`, ignore `args.is_free`/`suggestedMidCents` for the price (the summed price is authoritative). When `!hasStops`, keep today's exact free-derivation logic. Currency, capacity (Play), `is_unlimited` logic unchanged.
5. **Atomicity / compensation (DISC-1151-B):** order = events insert → stops insert → ticket insert. If the **stops insert** fails, soft-delete the orphan event (`deleted_at = now()`, mirroring `:893-896`) then throw `WRITE_FAILED`. The existing ticket-fail compensation (`:886-901`) stays; both compensation branches soft-delete the same orphan event.

**Ari preservation:** when `!hasStops`, NONE of the above fires — the executor writes exactly today's events row + one free-when-zero ticket + no stops. Verified by T5/ADV-1 (kept green) + the new ORCH-1151 Ari-no-regression test.

### 4.5 Address-uninferable decision (LOCKED)

A menu/activity item has no address. **AI stops carry `place_name` + `ai_description` + `price_cents` only**; `place_id`/`lat`/`lng` are left NULL and `address = ''` (NOT-NULL satisfied by empty string, per the RPC precedent `:481`). The experience therefore CANNOT publish (I-3 publish gate requires a validated `stops[0]` location in single mode) until the brand opens the draft and adds an address. **No address is fabricated.** This is the explicit resolution of the schema's `address NOT NULL` + publish-time `lat/lng` requirement.

### 4.6 Database

**No DDL.** The `experience_stops` table already has every column (Q2). No migration in this ORCH.

### 4.7 Service / hook / component / realtime

**None.** Read-back (`experienceDetailService.ts:248-336`), wizard hydration (`edit.tsx:72`, `ExperienceCreatorWizard.tsx:227`), and the checkout price read (`publicExperienceService.ts`) are all already wired for stops + the single ticket. No service/hook/component change. No realtime.

## 5. Success criteria

- **SC-1 (Ve5 schema):** `parse-restaurant-menu` returns ≤6 experiences, each with a non-empty `stops[]` of `{name, description, price_cents}`; no flat per-dish experiences.
- **SC-2 (Ve6 schema):** `parse-play-activities` returns ≤6 experiences, each with non-empty `stops[]`; play `intent_tags` still restricted to the 5 play ids.
- **SC-3 (tool_args):** both edge entries persist `stops` into `agent_pending_actions.tool_args`.
- **SC-4 (executor stops):** a confirm with N stops writes exactly N `experience_stops` rows with `stop_order` 0..N-1, `place_name` = item name, `address=''`, `ai_description` = item description, `price_cents` = item price; `place_id`/`lat`/`lng` NULL.
- **SC-5 (summed price):** the single `ticket_types` row has `price_cents = sum(stops price_cents)`; `is_free` true only when the sum is 0.
- **SC-6 (no free per-dish ticket):** exactly ONE `ticket_types` row is written (I-1 preserved); no per-stop tickets; the ticket is NOT free unless the summed price is 0.
- **SC-7 (draft preserved):** the snapped experience has `status='draft'`, `visibility='draft'`, `published_at=null`, NO `event_dates` insert, NO `cover_media_*` write.
- **SC-8 (Ari no-regression):** a `{brand_id, title, narrative}` call (no `stops`) writes the events row + one free unlimited ticket + NO `experience_stops` rows, and does not throw — byte-identical to today.
- **SC-9 (atomicity):** a stops-insert failure soft-deletes the orphan event and throws `WRITE_FAILED`; no ticket-less or stop-less orphan remains.
- **SC-10 (mode):** with stops, `events.pricing_mode='per_stop'` and `whole_price_cents=null`; without stops, `pricing_mode='whole'` (unchanged).

## 6. Invariants

**Amended (orchestrator flips ACTIVE on CLOSE):**

> **I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT (AMENDED by ORCH-1151)**
> **Rule:** No AI/snap path writes `event_dates`, `cover_media_*`, or `published_at` for an experience; those remain unset until the brand finishes the draft in the wizard. **A snap MAY write `experience_stops`** (the curated items-as-stops model). A snapped experience is always an unpublished, undated DRAFT.
> **Enforcement:** `orch_1146_create_experience_field_completeness.test.ts` T6 — `event_dates` insert still asserted absent; `published_at` null; no `cover_media_*`. The `experience_stops`-absent assertion (old line 275) is REMOVED; ORCH-1151 tests assert stops ARE written on the snap path and ARE NOT on the Ari path.

**New (DRAFT — flips ACTIVE on ORCH-1151 CLOSE):**

> **I-PROPOSED-1151-SNAP-STOPS-PRICE-IS-SUM (DRAFT)**
> **Rule:** When `create_experience` is called with a non-empty `stops` arg (the snap path), it writes one `experience_stops` row per stop AND sets the single `ticket_types.price_cents` to the SUM of the stops' `price_cents`, and the ticket is free ONLY when that sum is 0. The free-per-dish/zero-price ticket is never written when stops carry prices. (I-1 ONE-TICKET preserved: still exactly one ticket.)
> **Enforcement:** ORCH-1151 Deno tests (happy: N stops → N rows + summed ticket; adversarial: Ari stop-less unaffected + no free ticket on priced stops). Fails-on-revert.

**Preserved (unchanged):** `I-PROPOSED-1146-PARSER-CANONICAL-VIBES-OR-NULL`, `I-PROPOSED-1146-PARSER-NO-GBP-DEFAULT`, I-1 ONE-TICKET, I-2/I-4 (publish-gated stops/dates).

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy, Ve5) | Menu snap → curated experiences with priced stops | `tool_args` {brand, title, narrative, stops:[{name:"Burrata",price_cents:1400},{name:"Cacio e Pepe",price_cents:2200},{name:"Tiramisu",price_cents:1100}]} | 3 `experience_stops` rows (order 0,1,2), one ticket `price_cents=4700`, `is_free=false`, `pricing_mode='per_stop'`, draft | executor |
| T2 (happy, Ve6) | Activities snap with stops | stops:[{name:"2 Lanes 1hr",price_cents:6000},{name:"Pitcher",price_cents:2800}] | 2 stops, ticket `price_cents=8800`, draft | executor |
| T3 (draft invariant) | Snap writes no dates/cover/publish | any stops payload | NO `event_dates` insert, `published_at=null`, no `cover_media_*` | executor |
| T4 (Ari no-regression) | Minimal Ari call, no stops | {brand, title, narrative} | events row + ONE free unlimited ticket, NO `experience_stops` insert, no throw | executor |
| T5 (zero-price stops) | All stops price 0 (truly free menu) | stops with price_cents 0 | ticket `price_cents=0`, `is_free=true`; stops still written | executor |
| T6 (atomicity) | stops insert fails | mock stops insert error | orphan event soft-deleted (`deleted_at` set), throws `WRITE_FAILED`, no ticket written | executor |
| T7 (address null) | stops carry no address | any stops | each `experience_stops` row has `place_id`/`lat`/`lng` NULL, `address=''`, `place_name` set | executor |
| T8 (NOT-NULL satisfied) | minimal stop (name + price only, no description) | stops:[{name:"X",price_cents:500}] | row inserts; `ai_description=''`, `image_urls` default, no constraint error | executor/schema |
| T9 (edge tool_args) | parser builds tool_args | parsed experience with stops | `agent_pending_actions.tool_args.stops` present | edge |
| T10 (schema) | Gemini responseSchema validity | — | both cores' `RESPONSE_SCHEMA` declare nested `stops` with `price_cents` integer; `MAX_EXPERIENCES=6` | parser |

## 8. Implementation order

1. **Ve5 parser** (`geminiMenuParser.ts`): new types + `RESPONSE_SCHEMA` (nested stops) + `SYSTEM_PROMPT` (curated few, items-as-stops) + normalizer building `stops[]`; `MAX_EXPERIENCES=6`.
2. **Ve6 parser** (`geminiActivitiesParser.ts`): mirror in the SEPARATE file; keep play fields + `filterPlayIntentTags`.
3. **Edge entries** (`parse-restaurant-menu/index.ts`, `parse-play-activities/index.ts`): add `stops: exp.stops` to each `tool_args`.
4. **Executor** (`agentTools.ts` `createExperience`): add `stops` param; `hasStops` gate; summed price; `experience_stops` insert; force-price the single ticket; suppress free-on-zero only off the sum; extend orphan compensation; set `pricing_mode='per_stop'` when stops present.
5. **Tests:** amend `orch_1146_create_experience_field_completeness.test.ts` T6 (remove the stops-absent assertion; keep dates/cover/publish); add `orch_1151_curated_experiences_stops.test.ts` (T1–T8) + adversarial (T4/T5/T6); add a parser-schema test (T10).
6. **Invariant registry:** amend `I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT`; pre-stage `I-PROPOSED-1151-SNAP-STOPS-PRICE-IS-SUM` DRAFT. (Orchestrator owns the ACTIVE flip at CLOSE.)
7. **Deploy** edge fns (`parse-restaurant-menu`, `parse-play-activities`, and any fn bundling `_shared/agentTools.ts` — i.e. `agent-confirm-action`) **from MERGED main** (COMMS edge-deploy hazard), not the worktree.

## 9. Regression prevention

**Structural safeguard:** the `hasStops` gate is the single fork — Ari (no stops) and snap (stops) cannot cross-contaminate.

**Fails-on-revert contract:**
- `orch_1151_curated_experiences_stops.test.ts` T1 asserts N `experience_stops` rows + ticket `price_cents = sum`. **Reverting the executor (no stops written / free ticket restored) MUST fail T1; restoring MUST pass.**
- T4 asserts the Ari path writes NO `experience_stops` and one free ticket. **Reverting the `hasStops` gate (so Ari accidentally writes stops or the snap path leaks into Ari) MUST fail T4.**
- The amended `orch_1146…field_completeness.test.ts` T6 keeps `event_dates`/`published_at`/cover absent — **reverting to write dates/publish on a snap MUST fail T6** (the draft-only guarantee is still enforced).
- Protective comment in `createExperience` above the `hasStops` block: *"ORCH-1151: stops present = snap path (items-as-stops, summed-price ticket, NO free per-dish ticket); stops absent = Ari/manual shell (unchanged ORCH-1146 behavior). Do not collapse these branches."*

## 10. Open questions

- **OQ-1 (address decision — RESOLVED in 4.5, surfaced for visibility):** AI stops carry name/desc/price only; `address=''`, `lat/lng/place_id` NULL; the experience stays an unpublishable DRAFT until the brand adds addresses. Confirm Seth is OK that a snapped experience is **never directly publishable** (by design — it needs the brand to add real stop locations). LOCKED unless Seth objects.
- **OQ-2 (legacy drafts — DISC-1151-A):** the ~20 existing free stop-less snapped drafts are not migrated/cleaned. Likely a no-op (brand deletes them). Decision needed: leave / bulk-delete / one-time backfill. Recommend leave.
- **OQ-3 (read-back confirmation):** the business-app wizard renders AI stops with no client change per source trace (`edit.tsx:72`). TEST must confirm on device/sim that a snapped→confirmed experience opens in "Set up & publish" with its stops + summed price visible. If a gap is found → stop-and-amend (a small client change, possible OTA).
- **OQ-4 (experience count):** SPEC caps at 6 curated experiences (down from 20). Confirm Seth wants "a few" ≈ 3–6, not a fixed number.

## 11. Downstream routing

**Next = `mingla-implementor` (backend/edge + AI).** Inputs: this SPEC + the investigation, ORCH-1151, worktree `~/Desktop/mingla-orchs/orch-1151-[curated-experiences-stops]` on branch `orch-1151-curated-experiences-stops`. Hard constraints: cores stay SEPARATE; gate everything on `hasStops`; no DDL; no wizard/RPC/checkout/consumer change; preserve canonical-vibes + no-GBP; deploy edge fns from MERGED main. Output: implementation report under `Mingla_Artifacts/reports/`. **Then = `mingla-tester`** (verify SC-1..SC-10 + OQ-3 read-back on sim/device + fails-on-revert). **Then = orchestrator CLOSE** (flip `I-PROPOSED-1151-SNAP-STOPS-PRICE-IS-SUM` ACTIVE + the amended I-1146-AI-EXPERIENCE-STAYS-DRAFT, World Map + registry sync).

### Allowlist (implementor MAY change)
- `supabase/functions/_shared/geminiMenuParser.ts`
- `supabase/functions/_shared/geminiActivitiesParser.ts`
- `supabase/functions/parse-restaurant-menu/index.ts`
- `supabase/functions/parse-play-activities/index.ts`
- `supabase/functions/_shared/agentTools.ts` (`createExperience` only)
- `supabase/functions/_shared/__tests__/orch_1146_create_experience_field_completeness.test.ts` (T6 amend only)
- NEW: `supabase/functions/_shared/__tests__/orch_1151_curated_experiences_stops.test.ts` (+ `.tester-adversarial.test.ts`)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (amend + pre-stage)

### DO-NOT-TOUCH
- `mingla-business/src/components/experience/*` (wizard UI), `experienceWizardTypes.ts`, `app/experience/[id]/edit.tsx` — read-back already works.
- `supabase/migrations/*` — no DDL.
- `biz_create_experience` RPC, `ticket-checkout-create`, `publicExperienceService.ts`, `experienceDetailService.ts`.
- `.github/scripts/strict-grep/orch-1146-no-gbp-currency-default.mjs` + the canonical-vibes path (`canonicalExperienceIntents.ts`) — preserved.
- `app-mobile/*` (consumer).
- Any other agent tool in `agentTools.ts` (`createBrand`, `createEvent`, etc.).
