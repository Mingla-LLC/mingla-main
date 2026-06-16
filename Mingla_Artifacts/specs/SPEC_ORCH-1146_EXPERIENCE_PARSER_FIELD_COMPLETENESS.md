# SPEC — ORCH-1146 [experience-parser field completeness]

**Skill:** mingla-forensics · **Phase:** SPEC · **Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/orch-1146-[experience-parser-field-completeness]` · branch `orch-1146-experience-parser-field-completeness`
**Binding investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1146_EXPERIENCE_PARSER_FIELD_COMPLETENESS.md` (read as ground truth; F-1/F-2/F-3 + the class A/B/C/D matrix).
**Surface:** Mingla Business (`mingla-business/`) authoring + Supabase edge functions. **Experiences ONLY** (Ve5 `parse-restaurant-menu`, Ve6 `parse-play-activities`).
**Decisions LOCKED by Seth** — this SPEC implements them exactly; it does NOT relitigate scope.

> The implementor builds in the LOCKED phase order below. Each phase is independently shippable.
> The implementor MUST NOT touch anything outside the allowlist (§12); to widen scope, stop and request a SPEC amendment.

---

## 1. Executive summary

Today a snapped menu/activities photo yields an experience DRAFT that carries only **title, narrative, and a single midpoint price** into the structured wizard. Everything else the AI already extracts — vibes (`intent_tags`), currency, capacity, time-of-day, and the price range — is dumped into a write-only `theme.experience_meta` JSON blob that the structured edit wizard never reads back (`experienceDetailService.ts:236` reads typed columns, not the blob). So the brand re-enters fields the AI already knew.

This SPEC makes snapped experiences arrive with **every wizard field the AI can reasonably infer already filled in its real typed column**, while leaving genuinely-uninferable fields (dates, cover, exact address/geo, stops, fee/tax switches) blank — and keeping the hard invariant that **no AI path creates a dated or publishable experience** (it stays a draft).

Three phases, in LOCKED order:

- **Phase 1 — plumb `create_experience`** (the `agentTools.ts` executor; the Layer-2 bottleneck). Persist `intent_tags`→`events.experience_intents` (canonical 4-id vocab), `currency`→`events.currency`, `is_free` + `capacity`→a single `ticket_types` row, and keep the price range visible. This is the highest-value change: the AI already extracts these; they're just discarded.
- **Phase 2 — widen Ve5/Ve6 Gemini prompts + responseSchemas** for the remaining inferable class-B fields (`is_free` on both; `suggested_time_of_day` on Ve5; canonical-vibe emission on both — see §4.2). Two cores stay SEPARATE.
- **Phase 3 — currency fix** — replace the hardcoded "Use GBP if currency unclear" parser fallback with the brand's `default_currency`; align with the de-GBP-ify direction.

---

## 2. Scope & non-goals

### In scope
- The `create_experience` executor in `supabase/functions/_shared/agentTools.ts` (Phase 1).
- `supabase/functions/_shared/geminiMenuParser.ts` (Ve5 schema/prompt/normalizer) + `supabase/functions/_shared/geminiActivitiesParser.ts` (Ve6) (Phase 2 + 3).
- `supabase/functions/parse-restaurant-menu/index.ts` + `supabase/functions/parse-play-activities/index.ts` — `tool_args` construction for any newly-extracted field + the GBP-fallback at the edge entry (Phase 2 + 3).
- A new shared vibe-mapping helper `supabase/functions/_shared/canonicalExperienceIntents.ts` (Phase 1; used by the executor).
- A regression-test contract (§9).

### Non-goals (explicitly NOT in this SPEC)
- **NO UI redesign.** No change to the snap sheets, the chooser, the Hub tab, `ExperienceReviewCards.tsx`, `ExperienceConfirmationCard.tsx`, or `ExperienceCreatorWizard.tsx`. The wizard already reads back every column/ticket field this SPEC fills (`experienceDetailService.ts:236,257-259,315-320,338-349`); prefill is automatic once the columns/ticket exist. (UI is ORCH-1144 territory — just closed.)
- **NO dated/publishable experience from any AI path.** Drafts stay drafts; no `event_dates`, no `cover_media_*`, no `experience_stops`, no `published_at`. (I-1/I-2/I-4 META-ORCH-1059 — see §6.)
- **NO stops / per-stop fields** (place_id/address/geo/images/start_time/ai_description) — class D, uninferable from a photo and invariant-safe to leave at 0 stops.
- **NO consumer app, NO public/buyer web, NO admin** — the parsers + wizard are business-only (investigation blast-radius map).
- **NO broad de-GBP-ify sweep** beyond the two parser modules + their two edge entries. Client-side `?? "GBP"` fallbacks elsewhere remain under `[[project_orch_1034_currency_de_gbp_scope]]` (NOT YET STARTED) — out of scope here.
- **NO change to `biz_create_experience` / `biz_publish_experience` RPCs** — the AI confirm path does NOT call them (investigation §Layer 2); leave them untouched.

### Assumptions
- The wizard prefill reads typed `events` columns + the single `ticket_types` row + `experience_intents` (proven: `experienceDetailService.ts:236,257-259,315-320,338-349`). Filling those columns/ticket = automatic prefill. No adapter change needed.
- `create_experience` is SHARED with the Ari AI chat (`agent-chat/index.ts` imports `AGENT_TOOLS`; `agent-confirm-action/index.ts` runs the executor). All new fields MUST be additive/optional (§4.1 HARD GUARD).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NO | — | none | n/a — parsers have zero `app-mobile/` consumers |
| 2 | Consumer Android (`app-mobile/` Android) | NO | — | none | n/a — same |
| 3 | Buyer/anon Web | NO | — | none | n/a — public pages render PUBLISHED experiences; authoring prefill unaffected |
| 4 | Business iOS | YES | A snapped experience opened in the wizard arrives with vibes, currency, free/capacity, price prefilled | reads back via shared RN code; no iOS-specific file | automatic (shared edge fns + shared wizard read-back) |
| 5 | Business Android | YES | Same as iOS | same shared RN read-back | automatic (shared) |
| 6 | Admin Web (adjacent) | NO | — | none | n/a — no admin experience authoring |
| 7 | Business Web preview (adjacent) | YES | Same prefill on the RN-web wizard | same shared edge fns + shared wizard | automatic (shared) |

All three covered surfaces (4/5/7) are served by the SAME edge functions + the SAME `experienceDetailService` read-back; parity is automatic. The only code that changes is backend (edge functions) + one shared helper. There is NO per-surface manual parity work.

---

## 4. Layered specification

### 4.0 Field-by-field fill-rules table (the contract spine)

For every field: **source** (parser field / brand column) → **target** (DB column/table) → **transform** → **leave-blank condition**. The executor MUST apply each rule.

| Field | Source (parser/brand) | Target column/table | Transform / mapping | Leave-blank condition | Phase |
|---|---|---|---|---|---|
| **title** | `args.title` | `events.title` | trim, ≤120 | required — error if absent | (existing) |
| **narrative** | `args.narrative` | `events.description` | trim, ≤2000 | required — error if absent | (existing) |
| **vibes** | `args.intent_tags[]` | `events.experience_intents text[]` | map each tag → canonical 4-id via §4.4; dedup; keep order of EXPERIENCE_INTENTS; cap 4; **unmappable → drop** | empty after mapping → write `NULL` (column stays null; publish gate handles it) | 1 |
| **currency** | `args.currency` else `brand.default_currency` | `events.currency` | uppercase, slice(0,3) | never blank — falls back to `brand.default_currency`; if that is also null → omit the key (DB default applies). NEVER hardcode "GBP" in the executor. | 1 |
| **is_free** | `args.is_free` (Phase 2 adds it to the schema) | `ticket_types.is_free` | boolean; if true → `price_cents=0` | if `args.is_free` absent → derive: `is_free = (resolved price <= 0)`. Never fabricate a non-free paid ticket if no price. | 1 (derive) + 2 (explicit field) |
| **capacity** | `args.capacity_max` (Ve6 only) | `ticket_types.quantity_total` + `is_unlimited` | `quantity_total = capacity_max` (>=1); `is_unlimited = (capacity_max is null/<=0)` | Ve5 (restaurant): always `quantity_total=NULL`, `is_unlimited=true` (menus don't state party size — class D). Ve6 with no capacity → unlimited. | 1 |
| **price (whole)** | `args.suggested_price_min_cents` / `max` | `events.whole_price_cents` + `ticket_types.price_cents` | `whole_price_cents = midpoint` (existing logic); ticket `price_cents = whole_price_cents` (or 0 if free) | both null → `whole_price_cents=NULL`, ticket free with price 0 | 1 |
| **price RANGE (min,max)** | `args` min+max | `theme.experience_meta.suggested_price_min/max_cents` (KEEP) | preserve in blob (already done) so the range survives for audit/future prefill; the SELLABLE single value is the midpoint (schema has ONE price). | both null → both null in blob | 1 (note limitation §4.5) |
| **suggested_time_of_day** | `args.suggested_time_of_day` | `theme.experience_meta.suggested_time_of_day` (KEEP in blob) | preserve (already done for Ve6); Phase 2 adds it to Ve5's schema | absent → null | 2 |
| location_mode / pricing_mode | (default) | `events.location_mode='single'`/`pricing_mode='whole'` | hardcoded default (correct for one-venue snap) | n/a | (existing) |
| dates / timezone / cover / stops / fee switches | — | — | NOT WRITTEN (class D + invariant) | always blank | (invariant) |

### 4.1 Phase 1 — plumb the `create_experience` executor

**File:** `supabase/functions/_shared/agentTools.ts` — the `createExperience` AgentTool (`:645-813`), executor body `:677-812`.

**Current state (verbatim, investigation-confirmed):** the INSERT row (`:780-795`) writes only `brand_id, created_by, title, slug, description, event_type, status, visibility, published_at, timezone, location_mode, pricing_mode, whole_price_cents, theme`. It writes **no `currency` column, no `experience_intents`, and no `ticket_types` row at all**. `currency` is computed at `:704-706` but never written to the column. `intent_tags` go to the blob (`:736`). Capacity/time-of-day go to the blob (`:753-756`).

**Required changes (additive — preserve all existing behavior):**

1. **Currency → column.** Add `currency` to the INSERT row object (`:780-795`) using the already-computed `currency` local (`:704-706`). Change the `:704-706` fallback per Phase 3 (§4.3) so it resolves from `brand.default_currency` and does NOT hardcode `"GBP"` in the executor (if `args.currency` absent AND `brand.default_currency` null → omit the `currency` key so the `events` column default applies; do NOT write a literal "GBP").

2. **Vibes → `experience_intents` column.** After computing `intentTags` (`:708-716`), derive the canonical 4-id array via the new shared helper (§4.4):
   - `const canonicalIntents = mapToCanonicalExperienceIntents(args.intent_tags, venueCategory);`
   - Add `experience_intents` to the INSERT row: write `canonicalIntents` when non-empty, else **omit the key (write NULL)** — NEVER write an empty array (the CHECK requires length 1–4 when non-null; `20260828…:57-62`).
   - KEEP `experienceMeta.intent_tags` (the raw tags) in the blob for audit — do not remove it.

3. **`is_free` + capacity → ONE `ticket_types` row.** Today the executor writes NO ticket. Add a SECOND insert (after the `events` insert returns its id), mirroring the RPC's single-ticket shape (`20260824…:489-507`, the I-1 ONE-TICKET spine):
   - Compute `isFree`:
     - if `args.is_free` is a boolean → use it (Phase 2 supplies this);
     - else derive `isFree = (suggestedMidCents === null || suggestedMidCents <= 0)`.
   - Compute capacity (Ve6 only): `quantity_total = (venueCategory === 'play' && capacityMax != null && capacityMax > 0) ? capacityMax : NULL`; `is_unlimited = (quantity_total is NULL)`. For Ve5/restaurant → always `quantity_total=NULL, is_unlimited=true`.
   - INSERT ONE `ticket_types` row: `{ event_id: <new events.id>, name: 'Standard', description: null, price_cents: isFree ? 0 : (suggestedMidCents ?? 0), currency, quantity_total, is_unlimited, is_free: isFree, min_purchase_qty: 1, max_purchase_qty: null, is_hidden: false, is_disabled: false, requires_approval: false, allow_transfers: true, password_protected: false, available_online: true, available_in_person: true, waitlist_enabled: false, display_order: 0 }` — exactly the RPC's defaults (`20260824…:490-507`).
   - **I-1 ONE-TICKET:** write EXACTLY ONE ticket row, never N.
   - **Atomicity:** the executor is two client inserts (events, then ticket_types) — NOT a transaction. If the ticket insert fails after the events insert succeeds, the executor MUST throw `ToolError("WRITE_FAILED", …)` AND best-effort delete the orphan `events` row (soft-delete via `deleted_at` if a hard delete is RLS-blocked) so a snap never leaves a ticket-less draft. (See Open Question §10-Q4 if a single RPC is preferred instead — but the LOCKED decision is: keep the executor's direct-insert style, add the compensating delete.)

4. **Keep `whole_price_cents` midpoint** (`:770-778,793`) unchanged. Keep the price min/max in the blob (`:737-742`).

5. **Invariant preservation (unchanged):** still `status='draft'`, `visibility='draft'`, `published_at=null`, NO `event_dates`, NO `experience_stops`, NO `cover_media_*`. The added ticket row carries no date → still unsellable (matches the RPC's draft contract `20260824…:616` "Drafts … write the events row + stops + ticket but NO event_dates → unsellable until published").

**HARD GUARD — Ari no-regression (MANDATORY).** `create_experience` is shared. The implementor MUST:
- Enumerate every caller: (a) `agent-confirm-action/index.ts:187,197` (snap confirm + Ari confirm both run the same executor) and (b) `agent-chat/index.ts` (Ari tool-call path importing `AGENT_TOOLS`). No other callers exist (grep-confirmed: only `agentTools.ts`, `agent-chat`, `agent-confirm-action`, and the two `__tests__/orch_1103_ari_brand_crud*` import it).
- Prove the Ari path is additive: when Ari calls `create_experience` with only `{brand_id, title, narrative}` (the required set, `:658`), the new code MUST produce the same observable result PLUS a free, unlimited Standard ticket and (if Ari passed no intents) a NULL `experience_intents`. No new required parameter. No throw on absent optional fields. `venue_category` for an Ari-created experience under a non-restaurant/non-play brand → no capacity, no Play-vocab filtering (the existing `:709-716` branch already handles this; preserve it).
- Add the regression assertion in §9 (Ari-path no-regression test).

### 4.2 Phase 2 — widen Ve5/Ve6 Gemini prompts + responseSchemas

**Two cores stay SEPARATE** — own prompt, own schema, own normalizer, own `tool_args`. Each new schema field gets a normalizer + a "leave null if not present in the photo" rule. Keep `temperature: 0.2` + the "do not invent" clause (this is what makes blank-on-unknown safe).

**Ve5 — `geminiMenuParser.ts`:**
- Add to `RESPONSE_SCHEMA.properties.experiences.items.properties` (`:43-49`): `is_free: { type: "boolean" }`, `suggested_time_of_day: { type: "string" }`. Keep `required: ["title","narrative"]`.
- Add to `ParsedMenuExperience` interface (`:16-24`): `is_free: boolean | null; suggested_time_of_day: string | null;`.
- Normalizer (`normalizeExperience` `:80-111`): `is_free` → `typeof raw.is_free === "boolean" ? raw.is_free : null`; `suggested_time_of_day` → `asString(raw.suggested_time_of_day, 80) || null`.
- Prompt (`SYSTEM_PROMPT` `:58-63`): add: *"Set is_free=true ONLY when the menu explicitly signals no charge (e.g. 'free entry', 'no cover charge'); otherwise omit it. Include suggested_time_of_day only when a serving window is stated (e.g. 'Saturday brunch', 'happy hour 4–6pm'); otherwise omit it. Do not guess."*
- `tool_args` (`parse-restaurant-menu/index.ts:193-203`): add `is_free: exp.is_free`, `suggested_time_of_day: exp.suggested_time_of_day`.

**Ve6 — `geminiActivitiesParser.ts`:**
- `suggested_time_of_day` + `capacity_min/max` ALREADY exist (`:54-56`). Add only `is_free: { type: "boolean" }` to the schema (`:48-57`) + the interface (`:18-29`) + the normalizer (`:96-132`): `is_free` → `typeof raw.is_free === "boolean" ? raw.is_free : null`.
- Prompt (`SYSTEM_PROMPT` `:66-74`): add the same is_free instruction.
- `tool_args` (`parse-play-activities/index.ts:204-217`): add `is_free: exp.is_free`.

**Vibes / canonical intents — schema-level decision (LOCKED):** the parsers KEEP emitting their existing `intent_tags` taxonomies (Ve5 free-text; Ve6 the Play vocab `friends_chill|group_activity|date_night_active|family_friendly|solo_exploration`). The canonical 4-id mapping happens deterministically in the **executor** (Phase 1, §4.4) — NOT in the Gemini prompt. Rationale: keeping the mapping in TypeScript (a) is deterministic + testable (no LLM variance), (b) avoids a second source of truth, (c) means the Play prompt's hard `filterPlayIntentTags` allowlist stays intact. (Optionally, the implementor MAY add a one-line prompt hint suggesting the model lean toward tags that map cleanly — but the binding mapping is code, per §4.4. This is the only acceptable prompt-side vibe change.)

**Token budget:** the added fields are scalars/booleans/short strings × ≤20 experiences — cheap against `maxOutputTokens: 8192` (investigation F-4, RULED OUT as a blocker). Do NOT add long free-text fields.

### 4.3 Phase 3 — currency de-GBP fix

Replace every hardcoded `"GBP"` fallback in the TWO parser modules + their TWO edge entries so currency resolves from `brand.default_currency`, never a literal GBP:

| Location | Current | Required |
|---|---|---|
| `geminiMenuParser.ts:61` (prompt) | `Use GBP if currency unclear.` | `If the printed currency is unclear, leave currency empty (do not guess a currency).` |
| `geminiActivitiesParser.ts:69` (prompt) | `Use GBP if currency unclear.` | same as above |
| `geminiMenuParser.ts:91,116,146` (normalizer `defaultCurrency` default + the `if (!currency) currency = defaultCurrency`) | defaults to `"GBP"` | the normalizer keeps using the passed `defaultCurrency` arg; CHANGE the exported `normalizeMenuParsePayload`'s default param from `"GBP"` to a required arg (or default to `""`) so a missing brand currency does NOT silently become GBP. Callers MUST pass the brand currency. |
| `geminiActivitiesParser.ts:107,137,167` | same | same as Ve6 equivalent |
| `parse-restaurant-menu/index.ts:158` | `(brand.default_currency ...)?.trim() || "GBP"` | `(brand.default_currency ...)?.trim() || null` → pass the brand currency through; if null, pass `null`/`""` so the normalizer leaves currency empty and the executor (§4.1-1) falls back to `brand.default_currency` server-side (single source of truth). |
| `parse-play-activities/index.ts:165` | same | same |
| `agentTools.ts:706` (executor) | `(brand.default_currency ?? "GBP")` | `brand.default_currency` (no GBP literal); if null, OMIT the `currency` key from the INSERT (DB default applies) — see §4.1-1. |

**Net rule:** GBP is never a hardcoded default anywhere in the experience-parser path. The brand's `default_currency` is the single source of truth; when truly unknown, the field is left for the DB column default — not forced to GBP. Aligns with `[[project_orch_1034_currency_de_gbp_scope]]`.

> NOTE: the unit-test default-param change (`normalizeMenuParsePayload(payload, defaultCurrency="GBP")`) is the only signature touch. If existing tests call it without the second arg expecting GBP, update those tests in lockstep (they're in the allowlist).

### 4.4 The new shared canonical-vibe mapping helper

**New file:** `supabase/functions/_shared/canonicalExperienceIntents.ts`.

Exports:
```
export const CANONICAL_EXPERIENCE_INTENTS = ['adventurous','first-date','romantic','group-fun'] as const;
export type CanonicalExperienceIntent = (typeof CANONICAL_EXPERIENCE_INTENTS)[number];
export function mapToCanonicalExperienceIntents(rawTags: unknown, venueCategory: string | null): CanonicalExperienceIntent[];
```

**Behavior:** accept the raw `intent_tags` (free-text for Ve5, Play-vocab for Ve6). Lowercase + `trim` + `replace(/\s+/g,'_')` each tag, map via the table below, dedup, preserve the order of `CANONICAL_EXPERIENCE_INTENTS`, cap at 4. **Unmappable tags → DROP (never fabricate).** Return `[]` when nothing maps (executor then writes NULL).

**The canonical-vibe mapping table (LOCKED).** Source = the 4 ids the DB CHECK enforces (`20260828…:57-62`) + the wizard vocab (`experienceIntents.ts:45-48`).

Play-vocab tags (Ve6) → canonical:

| Play tag | → canonical id |
|---|---|
| `group_activity` | `group-fun` |
| `friends_chill` | `group-fun` |
| `family_friendly` | `group-fun` |
| `date_night_active` | `romantic` |
| `solo_exploration` | `adventurous` |

Free-text keyword mapping (Ve5 — substring/keyword match, case-insensitive, after normalization). Apply in order; first match wins per tag:

| Keyword/substring in tag | → canonical id |
|---|---|
| `romantic`, `date_night`, `date-night`, `couple`, `intimate`, `candlelit`, `tasting_menu`, `wine_pairing`, `anniversary` | `romantic` |
| `first_date`, `first-date`, `casual_date`, `meet`, `icebreaker` | `first-date` |
| `adventur`, `explore`, `thrill`, `outdoor`, `active`, `solo`, `discover` | `adventurous` |
| `group`, `friends`, `family`, `party`, `social`, `shareable`, `bottomless`, `brunch`, `happy_hour`, `crew`, `team` | `group-fun` |
| (anything else) | DROP |

> The mapping is intentionally conservative: when in doubt it drops rather than invents (Constitution #9). Ambiguous tags that match multiple rows resolve by the row order above (romantic > first-date > adventurous > group-fun). Edge-case ambiguities are flagged in §10 for the notify-list.

**Why a shared `_shared/` helper (not the business-app `experienceIntents.ts`):** the executor runs in Deno edge-function land and cannot import from `mingla-business/src`. The id list MUST stay byte-identical to `experienceIntents.ts:45-48` + the DB CHECK; add a protective comment in both files cross-referencing each other and the migration.

---

## 5. Success criteria (numbered, observable, testable)

**Phase 1:**
- **SC-1:** Confirming a Ve6 (Play) snap whose `tool_args` carry `intent_tags:['group_activity','date_night_active']`, `currency:'NGN'`, `capacity_max:8`, `suggested_price_min_cents:2000`, `suggested_price_max_cents:4000` produces an `events` row with `experience_intents = {group-fun, romantic}`, `currency='NGN'`, `whole_price_cents=3000`, `status='draft'`, `visibility='draft'`, `published_at IS NULL`, AND exactly one `ticket_types` row with `quantity_total=8`, `is_unlimited=false`, `is_free=false`, `price_cents=3000`.
- **SC-2:** Confirming a Ve5 (restaurant) snap with `intent_tags:['date-night tasting menu']`, no price → `experience_intents = {romantic}` (mapped) OR `{romantic}`; `ticket_types` row `is_free=true`, `price_cents=0`, `quantity_total IS NULL`, `is_unlimited=true`.
- **SC-3:** A snap whose `intent_tags` map to NOTHING (e.g. `['gluten_free']`) writes `experience_intents = NULL` (not an empty array → no CHECK violation) and inserts successfully.
- **SC-4:** Opening any Phase-1 snapped draft in the wizard shows the vibes pre-selected, the currency correct, the free/capacity toggle pre-set, and the price prefilled — with ZERO wizard code change (prefill is via `experienceDetailService.ts` read-back; assert the service returns the populated `experienceIntents`, `currency`, `ticket.{isFree,quantityTotal,isUnlimited}`).
- **SC-5 (invariant):** No Phase-1 snapped draft has any `event_dates` row, any `experience_stops` row, any `cover_media_url`, or `published_at != NULL`.
- **SC-6 (Ari no-regression):** Ari calling `create_experience` with only `{brand_id,title,narrative}` succeeds, produces a draft with `experience_intents=NULL`, a free/unlimited Standard ticket, and is otherwise identical to today's behavior (title/narrative/draft-shell).

**Phase 2:**
- **SC-7:** Ve5 Gemini schema includes `is_free` + `suggested_time_of_day`; a menu image stating "Free entry" yields `is_free=true`; one without yields `is_free=null` (NOT false-fabricated). `suggested_time_of_day` is null when no window is printed.
- **SC-8:** Ve6 Gemini schema includes `is_free`; unchanged capacity/time-of-day behavior preserved.
- **SC-9:** A field absent from the photo is null in the parser output (no fabrication) — verified at the normalizer for `is_free` and `suggested_time_of_day`.

**Phase 3:**
- **SC-10:** Neither `geminiMenuParser.ts` nor `geminiActivitiesParser.ts` nor the two edge entries nor the executor contains a hardcoded `"GBP"` literal as a currency fallback. (`grep -n '"GBP"'` over the 5 files returns no fallback-default occurrences.)
- **SC-11:** A snap under a brand with `default_currency='NGN'` and an unreadable menu currency yields `currency='NGN'` end-to-end (parser leaves currency empty → executor resolves from brand).

Surfaces 4/5/7 are served by identical shared code → no per-surface split needed (§3).

---

## 6. Invariants

| Invariant | How preserved | Verifying test |
|---|---|---|
| **I-1 ONE-TICKET** (META-ORCH-1059; `20260824…:19,489-507`) | The executor writes EXACTLY ONE `ticket_types` row, mirroring the RPC defaults | SC-1 asserts exactly one ticket row |
| **I-2 / I-4 — no AI path produces a published, sellable, dateless experience** (`agentTools.ts:647-653`) | Still `status/visibility='draft'`, `published_at=null`, NO `event_dates`; the added ticket has no date → unsellable | SC-5 |
| **`events_experience_intents_chk`** (`20260828…:57-62`) — array is NULL or 1–4 of the 4 ids | The helper caps at 4 + drops unmappable; executor writes NULL (never `[]`) when empty | SC-3 |
| **`experience_stops` 2–5 fires only at publish** (`20260824…:23`) — a draft may have 0 stops | The executor writes NO stops; draft is invariant-safe | SC-5 |
| **I-BRAND-UNIVERSAL-AUTHORING** (META-ORCH-0972) — no kind gate | The executor keeps `assertBrandOwned` + the venue_category-driven (not kind-gated) branch | SC-6 |

**New invariant (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip):**
- **`I-PROPOSED-1146-PARSER-CANONICAL-VIBES-OR-NULL`** — *"The experience-confirm executor MUST persist parser-extracted vibes only as the canonical 4-id vocabulary (`adventurous|first-date|romantic|group-fun`); unmappable tags are dropped; the `experience_intents` column is written as NULL (never an empty array) when nothing maps. No AI path fabricates a vibe not derivable from the source tags."*
- **`I-PROPOSED-1146-PARSER-NO-GBP-DEFAULT`** — *"The experience-parser path MUST resolve currency from `brand.default_currency`; no hardcoded 'GBP' fallback in the parsers, edge entries, or executor."*
- **`I-PROPOSED-1146-AI-EXPERIENCE-STAYS-DRAFT`** — *"No AI/snap path writes `event_dates`, `experience_stops`, `cover_media_*`, or `published_at` for an experience; those remain unset until the brand finishes the draft in the wizard."* (Restates I-2/I-4 for the parser surface.)

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T1 (happy, Ve6) | Play snap full fields | tool_args §SC-1 | events + 1 ticket as SC-1; vibes `{group-fun,romantic}` | executor |
| T2 (happy, Ve5) | Restaurant snap, no price, romantic tag | `intent_tags:['date-night tasting menu']`, no price | `experience_intents={romantic}`, free unlimited ticket | executor + helper |
| T3 (edge) | Unmappable tags only | `intent_tags:['gluten_free','vegan']` | `experience_intents=NULL`, insert succeeds (no CHECK fail) | executor + helper |
| T4 (edge) | >4 mappable tags | 6 tags mapping to all 4 + dups | array capped at 4, deduped, ordered | helper |
| T5 (Ari no-reg) | Ari minimal call | `{brand_id,title,narrative}` | draft + free/unlimited ticket; `experience_intents=NULL`; no throw | executor (Ari path) |
| T6 (invariant) | Any snap | any | 0 event_dates, 0 stops, null cover, draft visibility | executor |
| T7 (currency) | Brand NGN, currency arg absent | no `args.currency`, brand `default_currency='NGN'` | events.currency='NGN'; ticket currency='NGN' | executor + Phase 3 |
| T8 (no-fabrication) | Ve5 normalizer, no is_free in raw | `{title,narrative}` only | `is_free=null`, `suggested_time_of_day=null` | normalizer |
| T9 (atomicity) | ticket insert fails after events insert | forced ticket error | executor throws WRITE_FAILED + orphan events row soft-deleted | executor |
| T10 (grep gate) | GBP-fallback strict-grep | the 5 files | no hardcoded `"GBP"` currency default | CI |

---

## 8. Implementation order (LOCKED phases)

**Phase 1 (ship first):**
1. Create `supabase/functions/_shared/canonicalExperienceIntents.ts` (§4.4) + its unit test (T2/T3/T4).
2. Edit `agentTools.ts` executor (§4.1): currency→column, vibes→column via helper, ONE ticket_types row (is_free + capacity), compensating orphan-delete. Preserve all existing behavior + the blob.
3. Add the agentTools experience-confirm test file (T1/T2/T3/T5/T6/T7/T9).

**Phase 2:**
4. `geminiMenuParser.ts`: schema + interface + normalizer + prompt for `is_free` + `suggested_time_of_day`; `parse-restaurant-menu/index.ts` tool_args.
5. `geminiActivitiesParser.ts`: schema + interface + normalizer + prompt for `is_free`; `parse-play-activities/index.ts` tool_args.
6. Normalizer unit tests (T8).

**Phase 3:**
7. Replace GBP fallbacks across the 5 files (§4.3) + the normalizer default-param signature change + lockstep test updates; add the strict-grep gate (T10).

Deploy edge functions from MERGED main (clobber hazard, per memory `[[feedback_edge_deploy_and_migration_apply_hazards]]`). **No migration** is required — all target columns/tables (`events.currency`, `events.experience_intents`, `ticket_types`) already exist. Coordinate parser-file edits with the ORCH-1144 worktree if still in flight (investigation Discovery #4).

---

## 9. Regression prevention (fails-on-revert contract)

1. **Structural safeguard:** the canonical-vibe mapping lives in one shared TS helper with a frozen id list + a protective comment cross-referencing the DB CHECK (`20260828…:57-62`) and `experienceIntents.ts:45-48`.
2. **Fails-on-revert test (primary):** `supabase/functions/_shared/__tests__/orch_1146_create_experience_field_completeness.test.ts` runs T1 — asserts the snapped tool_args produce a fully-populated draft (vibes canonicalized + currency column + ticket with is_free/capacity + price) and that dates/cover/stops/published_at are null. This test **FAILS when §4.1 is reverted** (the executor reverts to writing only the 14-column shell, so `experience_intents`/`currency`/the ticket assertions fail) and **PASSES when restored**. Include a protective comment: *"ORCH-1146 — snapped experiences must arrive with every inferable field in its real column; do not collapse the confirm executor back to a title/narrative shell."*
3. **Adversarial tests (MUST also pass):**
   - **Ari no-regression (T5):** asserts the minimal Ari call still works and adds only additive output — fails if a new required param sneaks in.
   - **Unmappable-vibe-dropped (T3):** asserts `experience_intents=NULL` for non-matching tags and that the CHECK is NOT violated.
   - **No-fabrication (T8):** asserts the Ve5/Ve6 normalizers leave `is_free`/`suggested_time_of_day` null when absent from the raw payload.
4. **Strict-grep gate (T10):** a CI script (e.g. `scripts/gates/orch-1146-no-gbp-currency-default.mjs`) greps the 5 parser-path files for a hardcoded `"GBP"` currency fallback and fails the build if reintroduced.

---

## 10. Open questions (for the notify-list)

- **Q1 — vibe-mapping ambiguities:** the Play tag `family_friendly` is mapped to `group-fun` (there is no "family" canonical id). Confirm `group-fun` is the right home, vs dropping it. Likewise `solo_exploration → adventurous` (no "solo" id). LOCKED to the table above unless Seth overrides.
- **Q2 — free-text Ve5 keyword breadth:** the keyword list (§4.4) is a starting set. After ~5–10 real menu snaps, the mapping may need tuning (e.g. cuisine → vibe). Flag as a fast-follow, not a blocker.
- **Q3 — price range has no real schema home:** the schema holds ONE price (`whole_price_cents` + the single ticket's `price_cents`). The SPEC keeps the midpoint as the sellable value and preserves min/max in `theme.experience_meta` only (audit/future prefill). The wizard does NOT prefill a range. If Seth wants the range surfaced, that's a wizard-UI change (out of scope — ORCH-1144 territory).
- **Q4 — executor atomicity:** Phase 1 keeps the executor's two-direct-insert style + a compensating delete on ticket failure (§4.1-3). If Seth prefers true atomicity, an alternative is a thin `biz_create_experience_draft_shell` RPC — but that widens scope and touches the DB; NOT chosen here. Flag for decision.
- **Q5 — `is_free` derive-vs-explicit ordering:** Phase 1 derives `is_free` from price absence; Phase 2 adds an explicit parser `is_free`. Confirm the precedence: explicit `args.is_free` (when present) wins over the price-derived value. (SPEC LOCKED to: explicit wins.)

---

## 11. Downstream routing

**Next = `mingla-implementor` (Mingla Business + Supabase edge).** Build Phases 1→2→3 IN ORDER from this SPEC + the binding investigation, inside `~/Desktop/mingla-orchs/orch-1146-[experience-parser-field-completeness]` on branch `orch-1146-experience-parser-field-completeness` (rebase onto origin/main first). Hard constraints: additive-only on the SHARED `create_experience` executor (prove Ari no-regression), NO dated/publishable experience, NO UI change, NO migration, allowlist in §12. Output = implementation report under `Mingla_Artifacts/reports/`. Then → `mingla-tester` (verify SC-1..SC-11 + fails-on-revert + Ari no-reg, business iOS/Android/web preview) → `mingla-orchestrator` CLOSE (flip the three `I-PROPOSED-1146-*` invariants ACTIVE; reconcile any World Map scope per `[[feedback_shared_worldmap_scope_bleed]]`).

---

## 12. Scoped allowlist + DO-NOT-TOUCH

### Allowlist — MAY add/modify
| File | Phase | Change |
|---|---|---|
| `supabase/functions/_shared/canonicalExperienceIntents.ts` (NEW) | 1 | the shared vibe-mapping helper (§4.4) |
| `supabase/functions/_shared/agentTools.ts` | 1 | `createExperience` executor: currency column, experience_intents column, ONE ticket_types row, compensating delete (§4.1) — executor ONLY |
| `supabase/functions/_shared/geminiMenuParser.ts` | 2,3 | schema/interface/normalizer/prompt for `is_free`+`suggested_time_of_day`; GBP removal |
| `supabase/functions/_shared/geminiActivitiesParser.ts` | 2,3 | schema/interface/normalizer/prompt for `is_free`; GBP removal |
| `supabase/functions/parse-restaurant-menu/index.ts` | 2,3 | tool_args additions; brand-currency passthrough (no GBP literal) |
| `supabase/functions/parse-play-activities/index.ts` | 2,3 | tool_args additions; brand-currency passthrough (no GBP literal) |
| `supabase/functions/_shared/__tests__/orch_1146_*.test.ts` (NEW) | 1,2,3 | the regression + adversarial tests (§9) |
| `scripts/gates/orch-1146-no-gbp-currency-default.mjs` (NEW) | 3 | strict-grep gate (T10) |
| Existing tests that call `normalizeMenuParsePayload`/`normalizeActivitiesParsePayload` with the old GBP default | 3 | lockstep signature update only |

### DO-NOT-TOUCH
- `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx`, `ExperienceReviewCards.tsx`, `ExperienceConfirmationCard.tsx`, `experienceWizardTypes.ts`, `useExperienceDraftAdapter.ts` — NO UI change; prefill is automatic via read-back.
- `mingla-business/src/services/experienceDetailService.ts` — it ALREADY reads back every field this SPEC fills; do not modify.
- `mingla-business/src/constants/experienceIntents.ts` — read-only reference for the id list (add only a cross-ref comment if anything; do not change the ids).
- `supabase/functions/_shared/playIntentTags.ts` — keep the Play allowlist intact (the canonical mapping consumes its output; it does not replace it).
- `biz_create_experience` / `biz_publish_experience` RPCs + all `supabase/migrations/**` — NO migration; the AI confirm path does not call these RPCs.
- `agent-chat/index.ts` / `agent-confirm-action/index.ts` — do NOT modify; only PROVE they're not regressed by the executor change.
- Any consumer app, public/buyer web, admin, marketing surface.

The implementor MUST stop-and-amend (request a SPEC amendment as `SPEC_AMENDMENT_ORCH-1146_*.md` or an in-file append) before touching anything outside the allowlist.
