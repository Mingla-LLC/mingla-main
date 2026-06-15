# INVESTIGATE — ORCH-1146 [experience-parser field completeness]

**Skill:** mingla-forensics · **Phase:** INVESTIGATE (brainstorm gap-analysis) · **Date:** 2026-06-15
**Surface:** Mingla Business app (`mingla-business/`) + Supabase edge functions / RPCs. Experiences ONLY.
**Mode:** code audit — no reproducer, no runtime symptom; this is a forward-looking field-gap matrix.
**Constraints from dispatch:** NO code changes, NO spec, NO solutioning beyond a one-line recommendation column. Every claim cites `path:line`.

> **The question:** Seth wants a snapped menu/activities photo to return an experience with EVERY wizard
> field the AI can reasonably infer ALREADY filled, leaving only genuinely-uninferable fields blank
> (Constitution #9 — never fabricate). This investigation proves the exact gap across three layers and
> classifies each field A/B/C/D. It proposes nothing.

**Live-fire exemption:** No symptom/reproducer (the parsers work; the ask is "fill more fields"). Per
Prime Directive 7's "code audit only" exemption, no simulator repro required. Confidence is `proven`
for all structural facts (read verbatim) and `proven` for the inferability classification (reasoned from
the source-of-truth = a photo of a menu / activities sheet, stated honestly per field).

**COMMS ledger:** read on entry. One BLOCK exists (COMMS-0006 → ORCH-0980, historical 2026-05-26, not me/ALL).
No OPEN BLOCK/WARN entry targets `mingla-forensics`, `ORCH-1146`, or `ALL` requiring action this turn.

---

## TL;DR

The parsers are not the bottleneck — **`create_experience` is.** Both parsers already extract more than the
confirm path can structurally persist. The confirm path (`agentTools.ts` `createExperience.executor`) writes a
**minimal 14-column `events` draft shell** and dumps everything else into a `theme.experience_meta` JSON blob
that the structured edit wizard does **not** read back as prefill (`experienceDetailService.ts:236` reads the
typed columns, not the blob — only `when_draft` round-trips). So today even the fields the parser DOES extract
(intent_tags, capacity, time-of-day) are **silently dropped** as far as the wizard is concerned.

- **Class A** (inferable + parser fills it + it sticks): effectively **0** structured fields. Title/narrative
  are the only two that survive cleanly into a usable draft. Price survives into `whole_price_cents` (midpoint).
- **Class B** (inferable but parser does NOT extract it): the opportunity — **~7** fields.
- **Class C** (parser extracts it BUT `create_experience` drops it from structured columns): **3–4** fields —
  intent_tags, capacity (Ve6), suggested_time_of_day (Ve6), and arguably the price *range* (collapsed to a
  midpoint). Wasted extraction.
- **Class D** (genuinely uninferable from a photo → correct to leave blank): **~6** fields — exact street
  address/Mapbox pick, cover photo/video, dates/timezone, multi-stop itinerary, per-stop geo, fee/tax switches.

The two highest-leverage findings: **(1) the Layer-2 plumbing gap** — `create_experience` must forward more
fields into the structured RPC path before any prompt change matters; and **(2) the intent-vocabulary
mismatch** — parsers emit the WRONG taxonomy for the column the wizard actually validates.

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1144_UNIVERSAL_EXPERIENCE_PARSER_CHOOSER.md` | prior | Sealed facts: ownership-only gate, draft-only write, confirm path |
| 2 | `supabase/functions/parse-restaurant-menu/index.ts` | edge fn | Ve5 entry + the `tool_args` it builds |
| 3 | `supabase/functions/_shared/geminiMenuParser.ts` | edge fn | Ve5 responseSchema + system prompt + normalizer |
| 4 | `supabase/functions/parse-play-activities/index.ts` | edge fn | Ve6 entry + the `tool_args` it builds |
| 5 | `supabase/functions/_shared/geminiActivitiesParser.ts` | edge fn | Ve6 responseSchema + system prompt + normalizer |
| 6 | `supabase/functions/_shared/playIntentTags.ts` | edge fn | Ve6 intent vocabulary |
| 7 | `supabase/functions/agent-confirm-action/index.ts` | edge fn | The confirm→execute path for pending actions |
| 8 | `supabase/functions/_shared/agentTools.ts` | edge fn | `create_experience` tool def + executor (Layer 2 bottleneck) |
| 9 | `mingla-business/src/services/experienceGenerationService.ts` | service | parse/confirm/reject client; pending-row read |
| 10 | `mingla-business/src/components/experience/ExperienceReviewCards.tsx` | component | How proposals are reviewed/accepted |
| 11 | `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx` | component | Which proposal fields are shown/editable pre-accept |
| 12 | `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` | component | Layer-1 full authoring field set (`buildPayload`) |
| 13 | `mingla-business/src/components/experience/experienceWizardTypes.ts` | types | Stop draft fields |
| 14 | `mingla-business/src/hooks/useExperienceDraftAdapter.ts` | hook | When-step field subset |
| 15 | `mingla-business/src/constants/experienceIntents.ts` | const | Wizard/DB intent vocabulary (the canonical one) |
| 16 | `mingla-business/src/services/experienceDetailService.ts` | service | What the edit wizard reads BACK (proves blob is dropped) |
| 17 | `supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql` | schema | `events` experience columns + `experience_stops` + INSERT column list |
| 18 | `supabase/migrations/20260828000000_meta_orch_1059_experience_intents_multi.sql` | schema | `events.experience_intents text[]` column + CHECK (1–4 ids) |
| 19 | `supabase/migrations/20260829000000_meta_orch_1059_draft_roundtrip_cover_neverends.sql` | schema | 7 `cover_media_*` columns persisted by the experience RPCs |

---

## Layer 1 — The full experience authoring field set

The manual wizard is `ExperienceCreatorWizard.tsx`; its `buildPayload` (`ExperienceCreatorWizard.tsx:356-407`)
is the authoritative enumeration of what an experience captures. It maps to the `biz_create_experience` /
`biz_publish_experience` RPC payload, which persists to the `events` row + `experience_stops` + one
`ticket_types` + `event_dates`. Full field set:

| # | Layer-1 field | Where it lives (wizard) | DB column / table |
|---|---------------|-------------------------|-------------------|
| L1 | **title** | `ExperienceCreatorWizard.tsx:203,746-753`, payload `:360` | `events.title` (`20260824…:410,417`) |
| L2 | **description / narrative** | `:204,755-763`, payload `:361` | `events.description` (`20260824…:410`) |
| L3 | **experience_intents** (curated vibes, MULTI, ≥1 at publish; vocab `adventurous`/`first-date`/`romantic`/`group-fun`) | `:208-218,771-804`; payload `experience_intents` `:362` | `events.experience_intents text[]` + back-compat `experience_intent` (`20260828…:43,57-70`); CHECK 1–4 ids `:57-62` |
| L4 | **currency** | derived from brand `:199`; payload `:363` | `events.currency` (`20260824…:411`) |
| L5 | **location_mode** (`single`/`per_stop`) | `:221-223`; payload `:364` | `events.location_mode` (`20260824…:42,413`) |
| L6 | **pricing_mode** (`whole`/`per_stop`) | `:224-226`; payload `:365` | `events.pricing_mode` (`20260824…:43,413`) |
| L7 | **whole_price_cents** | `:234-236,283-293`; payload `:366` | `events.whole_price_cents` + the ONE `ticket_types.price_cents` (`20260824…:44,490-499`) |
| L8 | **is_free** | `:237`; payload `:367` | `ticket_types.is_free` (`20260824…:492,500`) |
| L9 | **capacity** (per-experience total) | `:238`; payload `:368` | `ticket_types.quantity_total` / `is_unlimited` (`20260824…:492,499-500`) |
| L10 | **pass_tax / pass_mingla_fee / pass_service_fee** (3 switches) | `:240-246`; payload `:369-371` | `events.pass_tax/pass_mingla_fee/pass_service_fee` (`20260824…:412,422-424`) |
| L11 | **stops[]** (2–5; per stop: place_id, place_name, address, city, region, country_code, lat, lng, image_urls[≤5], start_time, price_cents, ai_description) | `:227-231,372-389`; `experienceWizardTypes.ts:13-36` | `public.experience_stops` (1 row/stop) (`20260824…:78-100,472-485`) |
| L11a | — stop place_name | stop `:373-375` | `experience_stops.place_name NOT NULL` (`…:83`) |
| L11b | — stop address (Mapbox formatted) | stop `:376` | `experience_stops.address NOT NULL` (`…:84`) |
| L11c | — stop place_id (validated Mapbox pick) | stop `:374` | `experience_stops.place_id` (`…:82`) |
| L11d | — stop lat/lng | stop `:380-381` | `experience_stops.lat/lng` (`…:88-89`) |
| L11e | — stop city/region/country_code | stop `:377-379` | `experience_stops.city/region/country_code` (`…:85-87`) |
| L11f | — stop image_urls[≤5] | stop `:382` | `experience_stops.image_urls` (`…:90`) |
| L11g | — stop start_time (HH:mm) | stop `:383` | `experience_stops.start_time time` (`…:91`) |
| L11h | — stop ai_description (per-stop blurb, ≤280, req at publish) | stop `:388`; `experienceWizardTypes.ts:30-35` | `experience_stops.ai_description` (`…:93`) |
| L12 | **whenMode / when / multiDates / recurrence_rules / timezone** (dates) | `:266,828-837`; `useExperienceDraftAdapter.ts:46-53,186-210`; payload `:390-394` | `events.is_recurring/is_multi_date/recurrence_rules/timezone` + `event_dates` rows materialised at publish (`20260824…:414,509-559`) |
| L13 | **cover** (7 fields: coverMediaUrl/Type/Provider/SourceUrl/Credit/CreditUrl/Alt — image/video/gif) | `:263,398-406,887-896`; `ExperienceCoverStep` | 7 `events.cover_media_*` columns (`20260829…:338-359`) |
| L14 | **venue address / venue_tax_address** (tax-source venue) | NOT in wizard payload (server venue-sourced; memory: `events.venue_tax_address`) | `events.venue_tax_address` (server, venue-sourced; out of parser scope) |
| L15 | **slug** | derived server-side from title | `events.slug` (`20260824…:410,417`) |
| L16 | **duration** | NOT a discrete field — derived from stop `start_time` + when `endsAt` | none discrete |

**Note (L3 vocabulary):** the canonical experience-intent ids are EXACTLY four —
`adventurous | first-date | romantic | group-fun` (`experienceIntents.ts:45-48`), enforced by the
`events_experience_intents_chk` CHECK (`20260828…:57-62`). This is the taxonomy the wizard validates and the
deck queries. **Neither parser emits these ids** (see Layer 3 + the vocabulary-mismatch finding F-2).

---

## Layer 2 — What `create_experience` actually accepts and persists (THE BOTTLENECK)

A parser's pending action carries `tool_name: "create_experience"` (`parse-restaurant-menu/index.ts:212`,
`parse-play-activities/index.ts:223`). On accept, `agent-confirm-action` looks up the tool and runs its
executor with the (optionally edited) `tool_args` (`agent-confirm-action/index.ts:183-200`). **It does NOT
call `biz_create_experience`.** The executor is `createExperience` in `agentTools.ts:645-813`.

**What the executor accepts as parameters** (`agentTools.ts:656-676`): `brand_id`, `title`, `narrative`,
`suggested_price_min_cents`, `suggested_price_max_cents`, `currency`, `intent_tags`, `capacity_min`,
`capacity_max`, `suggested_time_of_day`, `confidence`. (Only `brand_id`/`title`/`narrative` required `:658`.)

**What the executor actually WRITES to structured `events` columns** (`agentTools.ts:780-795`):

```
brand_id, created_by, title, slug, description, event_type='experience',
status='draft', visibility='draft', published_at=null, timezone='UTC',
location_mode='single', pricing_mode='whole', whole_price_cents=<midpoint>, theme
```

Everything else is buried in `theme.experience_meta` (`agentTools.ts:735-763`): `intent_tags`,
`suggested_price_min/max_cents`, `currency`, `confidence`, `ai_source`, and (Play only) `capacity_min/max`,
`suggested_time_of_day`, `ai_metadata`.

**Critical: the blob is a dead end for the wizard.** The edit wizard seeds from `experienceDetailService`,
which reads the **typed columns** —
`"id, …, currency, …, cover_media_url, cover_media_type, location_mode, pricing_mode, experience_intent, experience_intents, whole_price_cents, …, theme"`
(`experienceDetailService.ts:236`) — and parses `theme.experience_meta.**when_draft**` ONLY
(`experienceDetailService.ts:62,96,177,275`). It does **not** map `experience_meta.intent_tags`,
`capacity_min/max`, `suggested_time_of_day`, or the price range into the wizard's structured intents / capacity
/ price fields. So whatever the parser put in the blob is invisible to the structured editor.

**Therefore the Layer-2 acceptance reality, per Layer-1 field:**

| Layer-1 field | `create_experience` sets it as STRUCTURED data? | Evidence |
|---|---|---|
| title | YES → `events.title` | `agentTools.ts:783` |
| description/narrative | YES → `events.description` | `agentTools.ts:785` |
| whole_price_cents | YES → midpoint of min/max | `agentTools.ts:770-778,793` |
| currency | YES → `events.currency`? **NO** — currency is computed (`:704-706`) but the INSERT row (`:780-795`) has **no `currency` column**; it relies on the events default. The blob keeps it. | `agentTools.ts:780-795` (no currency key) |
| location_mode / pricing_mode | YES but HARDCODED `single`/`whole` (not from args) | `agentTools.ts:791-792` |
| experience_intents (L3) | **NO** — `intent_tags` go to the blob; the typed `experience_intents` column is never written by the executor | `agentTools.ts:736,780-795` (no `experience_intents` key) |
| is_free / capacity (L8/L9) | **NO** — no `ticket_types` row written at all by this executor | `agentTools.ts:797-799` inserts only `events` |
| stops[] (L11) | **NO** — no `experience_stops` rows written | `agentTools.ts:797-799` |
| dates (L12) | **NO** — `timezone='UTC'` hardcoded; no `event_dates`; no when | `agentTools.ts:790` |
| cover (L13) | **NO** — no `cover_media_*` in the INSERT | `agentTools.ts:780-795` |
| pass_tax/fee/service (L10) | **NO** | `agentTools.ts:780-795` |
| capacity_min/max, time_of_day (Play) | **NO structured** — blob only (`experience_meta.capacity_min/...`) | `agentTools.ts:753-756` |

**Bottom line:** `create_experience` is a thin "title + narrative + (price midpoint) draft shell" writer. It is
the binding constraint. **No prompt/schema change to either parser can fill a structured wizard field that this
executor doesn't forward.** Any field-completeness work is FIRST a Layer-2 plumbing job.

---

## Layer 3 — What each parser outputs today

### Ve5 `parse-restaurant-menu`
- **responseSchema** (`geminiMenuParser.ts:35-56`): `title`, `narrative`, `suggested_price_min_cents`,
  `suggested_price_max_cents`, `currency`, `intent_tags[]`, `confidence`. Required: `title`, `narrative`.
- **System prompt** (`geminiMenuParser.ts:58-63`): single-intent offerings; cap 20; **"Use GBP if currency unclear"** (`:61`); no invented items.
- **Normalizer** (`geminiMenuParser.ts:80-111`): clamps; intent_tags free-text (≤40 chars, ≤12 tags `:97,108`).
- **tool_args built** (`parse-restaurant-menu/index.ts:193-203`): `brand_id, title, narrative, suggested_price_min_cents, suggested_price_max_cents, currency, temporaryCategory, intent_tags, confidence`.

### Ve6 `parse-play-activities`
- **responseSchema** (`geminiActivitiesParser.ts:40-64`): Ve5 set PLUS `capacity_min`, `capacity_max`, `suggested_time_of_day`.
- **System prompt** (`geminiActivitiesParser.ts:66-74`): Play offerings; cap 20; **"Use GBP if currency unclear"** (`:69`); intent_tags constrained to `friends_chill, group_activity, date_night_active, family_friendly, solo_exploration` (`:72`); capacity + time-of-day when implied (`:73-74`).
- **Normalizer** (`geminiActivitiesParser.ts:96-132`): adds `asCapacity` + min/max swap (`:91-94,109-115`); intent_tags filtered to the Play vocabulary via `filterPlayIntentTags` (`:118`, `playIntentTags.ts:3-9`).
- **tool_args built** (`parse-play-activities/index.ts:204-217`): Ve5 set PLUS `capacity_min, capacity_max, suggested_time_of_day`.

### Shared Gemini constraints (bound both parsers)
- Model `gemini-2.5-flash` (`geminiMenuParser.ts:3`, `geminiActivitiesParser.ts:5`).
- `maxOutputTokens: 8192` (`:8` / `:10`) — caps TOTAL JSON across up to 20 experiences. More fields/experience eats this budget; adding many text fields × 20 experiences risks truncation.
- `temperature: 0.2` (`:9` / `:11`) — deliberately low (extraction, not creativity). Good: keeps it grounded. Bad: low temp + "do not invent" means it will (correctly) leave a field blank rather than guess.
- Structured `responseSchema` + `responseMimeType: "application/json"` (`:174-176` / `:192-197`) — Gemini honors the schema; adding a field = add to schema + prompt. Required list is only `[title, narrative]`, so all extras are best-effort/nullable already.
- Up to 5 files / 10 MB total (`index.ts:11-12` / `:14-15`); 20/day rate limit (`:14-15` / `:17-18`).

---

## The gap matrix (one row per Layer-1 field)

Legend — Inferable: **YES** (clearly on a menu/activities photo) / **PARTIAL** (sometimes implied) / **NO**
(not on a photo). Class: **A** inferable+filled+sticks · **B** inferable, parser doesn't extract = OPPORTUNITY ·
**C** parser extracts but `create_experience` drops from structured columns = PLUMBING GAP · **D** uninferable →
correct to leave blank.

| Field | Ve5 fills today? | Ve6 fills today? | `create_experience` persists (structured)? | Inferable Ve5 (menu) | Inferable Ve6 (activities) | Class | One-line recommendation |
|---|---|---|---|---|---|---|---|
| **title** (L1) | YES `geminiMenuParser.ts:43`; `index.ts:195` | YES `geminiActivitiesParser.ts:48`; `index.ts:206` | YES `agentTools.ts:783` | YES (menu names dishes/deals) | YES | **A** | Leave as-is |
| **narrative** (L2) | YES `:44`/`:196` | YES `:49`/`:207` | YES `agentTools.ts:785` | YES (item descriptions) | YES | **A** | Leave as-is |
| **price** whole/midpoint (L7) | YES min/max `:45-46`/`:197-198` | YES `:50-51`/`:208-209` | PARTIAL — midpoint only `agentTools.ts:770-778`; **range collapsed** | YES (prices printed) | YES | **A/C** | Plumbing: also persist whether free + keep range as wizard prefill |
| **is_free** (L8) | NO | NO | NO `agentTools.ts:797-799` | PARTIAL ("free entry", "no cover") | PARTIAL ("free play hour") | **B** | Extend BOTH prompts+schema with `is_free`; plumb into ticket_types |
| **currency** (L4) | YES `:47`/`:199` BUT **GBP fallback** `geminiMenuParser.ts:61,91` | YES `:52`/`:210` (GBP fallback `:69,107`) | NO structured (no currency in INSERT) `agentTools.ts:780-795` | YES (symbols on menu) | YES | **C** + correctness gap | Plumb currency into the INSERT; **replace GBP fallback with brand.default_currency** (F-3) |
| **experience_intents** (L3) | NO (emits free-text `intent_tags`, WRONG vocab) `:48` | NO (emits Play vocab, WRONG vocab) `:53,72` | NO `agentTools.ts:736` (blob, not column) | PARTIAL (cuisine→vibe, e.g. tasting menu→romantic) | PARTIAL (bowling→group-fun) | **B/C** | Map to the 4-id canonical vocab in-prompt; plumb into `experience_intents` column (F-2) |
| **capacity** total (L9) | NO | PARTIAL via `capacity_min/max` `:54-55`/`:213-214` (blob only) | NO `agentTools.ts:753-756` (blob) | NO (menus rarely state group size) | PARTIAL ("lanes seat 6", "escape room max 8") `geminiActivitiesParser.ts:73` | **C** (Ve6) / **D** (Ve5) | Ve6: plumb capacity_max→ticket capacity; Ve5: leave blank |
| **suggested_time_of_day** (L12 hint) | NO | YES `:56`/`:215` (blob only) | NO `agentTools.ts:756` (blob) | PARTIAL ("Sat brunch", "happy hour 4-6") | PARTIAL ("Friday evening") | **C** (Ve6) / **B** (Ve5) | Useful as a DATE/when HINT, but date itself is uninferable (see L12); keep as soft hint only |
| **start_time** per stop (L11g) | NO | NO | NO (no stops written) `agentTools.ts:797-799` | PARTIAL (menu service times) | PARTIAL (session times) | **B** | Low value until stops are plumbed; defer |
| **stops[] / itinerary** (L11) | NO | NO | NO | NO (a menu is one venue, not a multi-stop route) | NO | **D** | Leave manual — a single venue is ONE stop; the 2–5 itinerary is a human design choice |
| **stop place_id / address / lat / lng** (L11a-e) | NO | NO | NO | NO (exact Mapbox pick not on a photo) | NO | **D** | Leave manual — requires a validated Mapbox pick (`stopHasValidatedLocation` `experienceWizardTypes.ts:72-73`) |
| **stop image_urls** (L11f) | NO | NO | NO | NO (menu text ≠ venue photos) | NO | **D** | Leave manual |
| **ai_description** per stop (L11h) | NO | NO | NO | PARTIAL (could draft a blurb) | PARTIAL | **B** | Only meaningful once stops exist; defer with stops |
| **dates / when / timezone** (L12) | NO | NO | NO — `timezone='UTC'` hardcoded `agentTools.ts:790` | NO (a menu has no event date) | NO | **D** | Leave manual — Constitution #9; recurring weekly deals are a human pick |
| **cover media** (L13) | NO | NO | NO `agentTools.ts:780-795` | NO (no shippable cover image in a menu photo) | NO | **D** | Leave manual (or future: generated/Pexels — out of scope) |
| **location_mode / pricing_mode** (L5/L6) | NO | NO | YES but HARDCODED single/whole `agentTools.ts:791-792` | PARTIAL (single venue→single) | PARTIAL | **A** (defaults correct) | Leave default — single/whole is the right default for a one-venue snap |
| **pass_tax/fee/service** (L10) | NO | NO | NO | NO (brand pricing policy, not on a menu) | NO | **D** | Leave manual (brand-level default applies) |
| **confidence** | YES `:49`/`:200` | YES `:57`/`:216` | blob only `agentTools.ts:744-746` | n/a (AI self-rating) | n/a | meta | Keep (drives review-card trust UX) |

---

## Class tally

| Class | Count | Fields |
|---|---|---|
| **A** — inferable + filled + sticks | **~3** | title, narrative, price-midpoint (+ defaulted location/pricing mode) |
| **B** — inferable but parser does NOT extract = OPPORTUNITY | **~7** | is_free, intents-mapping (also C), suggested_time_of_day on Ve5, per-stop start_time, per-stop ai_description, (Ve6 capacity is more C than B), currency-as-structured |
| **C** — parser extracts BUT create_experience drops from structured columns = PLUMBING GAP | **3–4** | `intent_tags`, `capacity_min/max` (Ve6), `suggested_time_of_day` (Ve6), currency (computed but not written to column); price *range* collapsed to midpoint |
| **D** — genuinely uninferable from a photo → correct to leave blank | **~6** | exact stop address/Mapbox pick + geo, cover photo/video, dates/timezone, multi-stop itinerary, per-stop images, fee/tax switches |

> The headline: **the biggest blocker is Class C, not Class B.** The parsers already extract intent_tags,
> capacity, and time-of-day; `create_experience` throws them into a blob the wizard ignores. Fix the plumbing
> before (or alongside) widening the prompts, or new extracted fields will leak into the same blob.

---

## Top class-B opportunities (inferable but unfilled), highest value first

1. **`is_free`** — extend BOTH responseSchemas + prompts. A menu/activities sheet routinely signals "free entry",
   "no cover charge", "free play hour". Today neither parser asks; `create_experience` can't set it
   (`agentTools.ts:797-799` writes no ticket row). High value: removes a manual toggle on most casual offerings.
2. **Intent → canonical 4-id vocabulary** (also the C-3 plumbing gap) — both parsers emit the WRONG taxonomy
   (`geminiMenuParser.ts:48` free-text; `geminiActivitiesParser.ts:72` Play vocab) for the column the wizard
   validates (`adventurous|first-date|romantic|group-fun`, `experienceIntents.ts:45-48`). Highest value: intents
   are REQUIRED at publish (`ExperienceCreatorWizard.tsx:343,805-807`) — pre-filling them removes a hard gate.
3. **Currency as a structured field, off the brand default** — Ve5/Ve6 already extract `currency` but
   `create_experience`'s INSERT never sets the `events.currency` column (`agentTools.ts:780-795`), and the
   prompt GBP fallback is wrong vs `brand.default_currency`. Value: WYSIWYP pricing correctness on first render.
4. **`suggested_time_of_day` for Ve5** (Ve6 already has it) — brunch/happy-hour windows are explicit on most
   menus; useful as a soft "When" hint. Lower value than 1–3 because the actual date stays uninferable.
5. **Ve6 capacity → ticket quantity** — Ve6 already extracts `capacity_max` (`geminiActivitiesParser.ts:54-55`)
   but it dies in the blob. Plumbing it into `ticket_types.quantity_total` pre-fills the capacity step for Play.
6. **Per-stop `ai_description` (auto-blurb)** and **per-stop `start_time`** — only meaningful AFTER stops are
   plumbed; defer behind the stops question. Listed for completeness.

---

## Every Class-C plumbing gap (wasted extraction today)

| C# | Field parser extracts | Where extracted | Where it dies | Fix direction (recommendation only) |
|---|---|---|---|---|
| C-1 | `intent_tags` (both parsers) | `parse-restaurant-menu:201`, `parse-play-activities:212` | `agentTools.ts:736` → `experience_meta.intent_tags` blob; `experience_intents` column never written `:780-795`; wizard reads column not blob `experienceDetailService.ts:236` | Map to canonical 4 ids + write the `experience_intents` column in the executor |
| C-2 | `capacity_min` / `capacity_max` (Ve6) | `parse-play-activities:213-214` | `agentTools.ts:753-755` → blob; no `ticket_types` row written `:797-799` | Forward capacity into a ticket_types capacity at confirm |
| C-3 | `suggested_time_of_day` (Ve6) | `parse-play-activities:215` | `agentTools.ts:756` → blob; wizard `when` reads `experience_meta.when_draft` not this key | Map to a When hint / `when_draft`, or surface as a prefill |
| C-4 | price RANGE min+max (both) | `…:197-198` / `…:208-209` | `agentTools.ts:770-778` collapses to a single midpoint `whole_price_cents`; min/max only in blob | Acceptable as a midpoint default, but keep the range visible as wizard prefill rather than silently dropping it |
| C-5 | `currency` (both) | `…:199` / `…:210` | computed in executor `agentTools.ts:704-706` but the `events` INSERT has no `currency` key `:780-795` | Write `currency` into the INSERT column |

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | Constitution #9 (never fabricate) + memory `[[project_orch_1034_currency_de_gbp_scope]]` (de-GBP-ify) + `[[feedback_brand_kind_decommissioned]]` (universal authoring). | The parser prompts' hardcoded "Use GBP if currency unclear" (`geminiMenuParser.ts:61`, `geminiActivitiesParser.ts:69`) CONTRADICTS the de-GBP direction. Flagged (F-3), not fixed. |
| **Schema** | `events.experience_intents text[]` CHECK = exactly the 4 ids (`20260828…:57-62`); `experience_stops`/`ticket_types`/`event_dates`/7 `cover_media_*` columns exist (`20260824…`, `20260829…`). | Schema is RICH; the executor uses almost none of it. The gap is the executor, not the schema. |
| **Code** | `createExperience.executor` writes 14 columns + a blob (`agentTools.ts:780-795`); the wizard reads typed columns back (`experienceDetailService.ts:236`). | **Load-bearing contradiction:** the executor's blob (`experience_meta.intent_tags/capacity/time_of_day`) is write-only — nothing reads it into the structured wizard. Extracted data is silently inert. |
| **Runtime** | Not run (code-audit exemption). The pending → confirm → draft-shell path is proven by source. | n/a |
| **Data** | Parser `intent_tags` vocab ≠ `experience_intents` vocab (free-text/Play vs 4 canonical ids). | The vocab mismatch (F-2) means even if the column were written from `intent_tags`, the CHECK would reject most values. |

---

## Findings (six-field)

### F-1 — `create_experience` is the field-completeness bottleneck (CONFIRMED ROOT CAUSE)
1. **Symptom:** Parser-extracted fields beyond title/narrative/price do not pre-fill the structured wizard.
2. **Layer:** code.
3. **Probe:** read `agentTools.ts:677-812` executor + `experienceDetailService.ts:236,275` read-back.
4. **Evidence:** INSERT row `agentTools.ts:780-795` contains only `brand_id, created_by, title, slug, description, event_type, status, visibility, published_at, timezone, location_mode, pricing_mode, whole_price_cents, theme`. No `experience_intents`, no `currency`, no `ticket_types`/`experience_stops`/`event_dates`/`cover_media_*`. The wizard re-seed reads typed columns (`experienceDetailService.ts:236`) + only `experience_meta.when_draft` (`:275`).
5. **Mechanism:** The executor dumps extra fields into `theme.experience_meta` → the structured editor never reads that blob → extracted data is inert → any parser-side enrichment lands in the same dead blob.
6. **Severity:** CONFIRMED ROOT CAUSE (the central plumbing gap; Class-C generator).

### F-2 — Intent-vocabulary mismatch between parsers and the wizard column (SECONDARY ROOT CAUSE)
1. **Symptom:** Even if intents were plumbed, the values wouldn't satisfy the column.
2. **Layer:** schema vs code.
3. **Probe:** compared parser vocab to `events_experience_intents_chk`.
4. **Evidence:** Ve5 emits free-text tags (`geminiMenuParser.ts:48,97`); Ve6 emits `friends_chill|group_activity|date_night_active|family_friendly|solo_exploration` (`geminiActivitiesParser.ts:72`, `playIntentTags.ts:3-9`). The column accepts ONLY `adventurous|first-date|romantic|group-fun` (`experienceIntents.ts:45-48`, CHECK `20260828…:57-62`).
5. **Mechanism:** Two disjoint taxonomies → a plumb of `intent_tags`→`experience_intents` would be rejected by the CHECK for non-matching ids → intents stay empty → publish stays gated (`ExperienceCreatorWizard.tsx:343`).
6. **Severity:** SECONDARY ROOT CAUSE (must be solved jointly with F-1 for the highest-value B opportunity).

### F-3 — GBP fallback in parser prompts contradicts de-GBP-ify + brand currency (SUSPECTED CONTRIBUTOR)
1. **Symptom:** Snapped experiences default to GBP when the Gemini reading is unclear, even for non-GBP brands.
2. **Layer:** code vs docs.
3. **Probe:** read both prompts + normalizer fallbacks.
4. **Evidence:** "Use GBP if currency unclear" (`geminiMenuParser.ts:61`, `geminiActivitiesParser.ts:69`); normalizer `defaultCurrency` defaults to "GBP" at multiple call sites (`geminiMenuParser.ts:117,146`; `geminiActivitiesParser.ts:137,167`). The edge entry DOES pass `brand.default_currency` (`parse-restaurant-menu:158`, `parse-play-activities:165`) but ALSO falls back to "GBP" there (`|| "GBP"`).
5. **Mechanism:** Brand's real `default_currency` is available but the prompt instructs GBP and the chain re-defaults to GBP, contradicting `[[project_orch_1034_currency_de_gbp_scope]]`.
6. **Severity:** SUSPECTED CONTRIBUTOR (correctness gap; flagged per dispatch, NOT to fix here).

### F-4 — Gemini output-token budget bounds field-count realism (RULED OUT as a hard blocker)
1. **Symptom:** Could adding many fields truncate the JSON?
2. **Layer:** code/runtime.
3. **Probe:** read generationConfig.
4. **Evidence:** `maxOutputTokens: 8192` shared by up to 20 experiences (`geminiMenuParser.ts:7-8`, `geminiActivitiesParser.ts:9-10`).
5. **Mechanism:** Adding ~5–8 short scalar fields per experience is cheap; risk only materialises with many long text fields × 20 experiences. The proposed B-fields are mostly scalars/enums → low token cost.
6. **Severity:** RULED OUT as a blocker (a real but minor constraint; note for the brainstorm, not a gate).

---

## Differences: what Ve5 vs Ve6 each could/should infer

- **Ve5 (food menu):** strong on price, item/deal narrative, cuisine→vibe, meal-window time-of-day (brunch/
  happy hour), is_free (cover/no-cover). Weak/none on group capacity (menus rarely state party size) → capacity
  is Class D for Ve5. Already has NO capacity field (correctly).
- **Ve6 (activities/packages sheet):** everything Ve5 has PLUS genuine group-capacity signals ("lanes seat 6",
  "escape room max 8" — `geminiActivitiesParser.ts:73`) and session time-of-day. So Ve6's extra
  `capacity_min/max` + `suggested_time_of_day` are RIGHT to exist; they're just stuck in the blob (Class C).
- **Symmetry recommendation (direction only):** add `is_free` to BOTH; add canonical-intent mapping to BOTH;
  add `suggested_time_of_day` to Ve5 (Ve6 already has it); keep `capacity_*` Ve6-only.

---

## Gemini model / token / structured-output constraints (for the brainstorm)

- `gemini-2.5-flash`, `responseSchema` + `responseMimeType: application/json` → adding a field = add to schema +
  prompt; Gemini honors it. Only `[title, narrative]` are required, so all new fields are nullable/best-effort
  by construction (`geminiMenuParser.ts:51`, `geminiActivitiesParser.ts:59`).
- `maxOutputTokens: 8192` across ≤20 experiences — scalar/enum additions are cheap; avoid adding many long free-
  text fields per experience.
- `temperature: 0.2` + "do not invent" prompt — by design the model leaves a field null rather than guess,
  which ALIGNS with the "leave uninferable fields blank" requirement (Constitution #9). This is a feature: it
  means widening the schema is low-risk for fabrication as long as the prompt keeps "do not invent."
- A snap returns up to 20 proposals; capacity/intent/price are PER-proposal, so any plumbing must handle arrays.

---

## Blast radius / cross-surface map

| Surface | In scope for ORCH-1146? | Why |
|---|---|---|
| Business iOS / Android | YES | The parsers + wizard are business-only; the gap lives here |
| Business Web preview (adjacent) | YES (parity) | Same RN-web wizard + same edge functions |
| Consumer iOS / Android | NO | `parse-restaurant-menu`/`parse-play-activities` have zero `app-mobile/` consumers (re-confirmed; ORCH-1144 finding) |
| Buyer/anon Web | NO | Public pages render the PUBLISHED experience; unaffected by authoring prefill |
| Admin Web | NO | No admin experience-authoring surface |

Shared-code note: `create_experience` (`agentTools.ts`) is also reachable via the Ari AI chat path (the same
executor) — any Layer-2 change there affects BOTH the snap-confirm flow AND any Ari "create experience" tool
call. Flag for scope: this is a SHARED executor, not snap-only.

---

## Invariant impact (flagged, not resolved)

- **I-1 / I-2 / I-4 (META-ORCH-1059):** "no AI path produces a published, sellable, dateless experience"
  (`agentTools.ts:647-653`). Any field-completeness work must keep the draft a DRAFT (no dates, no publish) — so
  dates (L12) staying blank is not just "uninferable," it is INVARIANT-REQUIRED to stay blank at this stage.
- **`events_experience_intents_chk`** (`20260828…:57-62`) — any intent plumbing must emit the 4 canonical ids
  or the write fails (F-2).
- **`experience_stops` 2–5 rule** fires only at publish (`20260824…:23`) — a draft may have 0 stops, so NOT
  writing stops from a snap is invariant-safe.
- Proposed (DRAFT, for a future SPEC if Seth proceeds): `I-PROPOSED-1146-PARSER-NO-FABRICATION` — "experience
  parsers MAY fill only fields directly inferable from the source photo; uninferable fields (dates, cover,
  exact address/geo, fee switches) MUST be left null; the confirm executor MUST NOT synthesise them."

---

## Discoveries for Orchestrator (side issues)

1. **The `theme.experience_meta` blob written by `create_experience` is write-only for the structured wizard.**
   `intent_tags`, `capacity_min/max`, `suggested_time_of_day`, price min/max are persisted but never read back
   into the editor (`experienceDetailService.ts:236,275` reads typed columns + only `when_draft`). This is a
   latent "data we capture but never use" smell beyond ORCH-1146's brainstorm — flag for cleanup or wiring.
2. **`create_experience` hardcodes `location_mode='single'`, `pricing_mode='whole'`, `timezone='UTC'`, and writes
   NO `currency` column** (`agentTools.ts:790-795`) — so even an Ari-created experience inherits a possibly-wrong
   timezone/currency. Adjacent to F-3.
3. **GBP fallback appears in 6 places** across the two parser modules + 2 edge entries (F-3) — a single de-GBP
   sweep would need all of them; relates to `[[project_orch_1034_currency_de_gbp_scope]]` (NOT YET STARTED).
4. **ORCH-1144 is in flight on the SAME files** (the parser-chooser rebuild). Any ORCH-1146 work on the parsers
   or `experiences.tsx` must coordinate with ORCH-1144's worktree to avoid a clobber — flag at SPEC/IMPLEMENT.

---

## Confidence

**proven** for all three layers (read verbatim, `path:line` cited) and for the class A/B/C/D classification
(the Layer-2 bottleneck and the intent-vocab mismatch are read end-to-end). The inferability judgments
(YES/PARTIAL/NO) are reasoned honestly from "what is physically present on a menu vs an activities sheet" and
are stated conservatively (dates, cover, exact address, geo, fee switches = genuinely NOT on a photo). No
runtime repro required (code-audit; no symptom).

## Recommended next phase + scope (direction only — NOT a fix, NOT a spec)

This was a brainstorm gap-analysis; the deliverable is the matrix above. IF Seth proceeds, the natural scope
order is: **(1) Layer-2 plumbing first** (extend `create_experience` to forward intents→canonical-vocab column,
currency column, is_free + capacity→ticket, keep dates/cover/stops blank by invariant), THEN **(2) widen Ve5/Ve6
prompts+schemas** for `is_free` + canonical intents (+ Ve5 time-of-day), THEN **(3) the de-GBP currency
correctness** (F-3) folded in or tracked under `[[project_orch_1034_currency_de_gbp_scope]]`. Genuinely-
uninferable fields (Class D) stay manual by design. No solutioning beyond this direction per dispatch.
