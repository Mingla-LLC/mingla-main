# INVESTIGATE — ORCH-1146 Snapped-Draft Field Audit (read-only)

**Mode:** INVESTIGATE (read-only, no code changes)
**Date:** 2026-06-16
**Brand under test:** "Leggo This" — `brands.id = 22a18413-bfbf-4087-9ba7-45f70deba0f3`, `venue_category = NULL`, `default_currency = USD`, slug `leggothis`.
**Question:** For a snapped experience (ORCH-1146 parser → `create_experience`), EXACTLY which fields get populated, which are left blank, and WHY for the blanks. Specifically: is "stops/itinerary not built out" by-design or a gap?

---

## Plain-English answer (read this first)

When Seth snapped the "Leggo This" food menu, each menu item became its OWN draft experience (he got ~20 — one per dish: "Duck", "Veal Scallopini", "Coho Salmon", …). For each draft the parser + `create_experience` executor fills only the handful of things a menu photo can honestly support: **title, description (the dish narrative), event_type=experience, status/visibility=draft (never published), brand_id, created_by, currency (USD, from the brand), timezone=UTC, location_mode=single, pricing_mode=whole**, and it creates the **one `ticket_types` "Standard" row** the wizard reads back (here `is_free=true`, `price_cents=0`, unlimited). Everything that a menu photo cannot honestly produce is left blank **on purpose**: **stops, itinerary, dates, cover media, exact address/geo, real ticket price, capacity, and the vibe tags** (`experience_intents`). The price is blank because the menu only gave a single per-item price (a min, no max → no midpoint), and the vibes are blank because the raw parser tags for these dishes were `["food","entree"]`, which map to NONE of the 4 canonical vibe ids, and the no-fabrication invariant forbids inventing one.

**Stops / itinerary is BY DESIGN, not a gap.** The parser schema never even asks the AI for stops, and the `create_experience` executor never writes the `experience_stops` table. A single-venue menu has no multi-stop itinerary, and the I-1/I-2/I-4 invariants forbid the AI producing a published, dated, structured-itinerary experience. The draft is a *shell* that the brand finishes (add stops + a date + a real price) in the wizard before publishing. Ground truth confirms: 0 rows in `experience_stops` and 0 rows in `event_dates` for all 20 snapped drafts; the only experiences for this brand that DO have stops are two manually-built test experiences (`ai_source = NULL`).

**One important nuance:** the local anchor checkout (`main` @ `fb27338d3`) does **not** contain the ORCH-1146 merge (`c15895b9c`, PR #494) — `git merge-base --is-ancestor` returns NO. The code that actually ran for Seth's snap is the **deployed post-1146** edge function, which I read via `git show c15895b9c:…`. The live DB rows match that post-1146 code exactly. The audit below is against the deployed (post-1146) behavior.

---

## Real row evidence (ground truth, read-only SQL against `gqnoajqerqhnvulmnyvv`)

Three of the 20 drafts snapped `2026-06-16 02:18` (`status=draft`, `visibility=draft`, `published_at=NULL`):

| col | "Duck" (`2d13c742…`) | "Veal Scallopini" (`36ddeb3b…`) | "Coho Salmon" (`121106e5…`) |
|---|---|---|---|
| title | Duck | Veal Scallopini | Coho Salmon |
| description | "Oven-roasted organic duck boneless breast…" | "Thinly pounded grilled veal chop…" | "Over-roasted line-caught salmon…" |
| event_type | experience | experience | experience |
| status / visibility | draft / draft | draft / draft | draft / draft |
| published_at | NULL | NULL | NULL |
| currency | USD | USD | USD |
| whole_price_cents | **NULL** | **NULL** | **NULL** |
| pricing_mode | whole | whole | whole |
| location_mode | single | single | single |
| timezone | UTC | UTC | UTC |
| experience_intent (text) | **NULL** | **NULL** | **NULL** |
| experience_intents (array) | **NULL** | **NULL** | **NULL** |
| vibe_tags (array) | **[]** | **[]** | **[]** |
| location_text / location_geo / departure_geo | **NULL / NULL / NULL** | NULL/NULL/NULL | NULL/NULL/NULL |
| cover_media_url / type / provider | **NULL / NULL / NULL** | NULL/NULL/NULL | NULL/NULL/NULL |
| show_on_discover | false | false | false |
| theme.experience_meta | `{currency:USD, ai_source:business_snap, confidence:1, intent_tags:[food,entree], suggested_price_min_cents:2600, suggested_price_max_cents:null}` | `{… min:2900, max:null}` | `{… min:2300, max:null}` |

`ticket_types` (the ONE row per draft, created by the executor):

| event | name | price_cents | currency | is_free | is_unlimited | quantity_total |
|---|---|---|---|---|---|---|
| Duck | Standard | 0 | USD | true | true | NULL |
| Veal Scallopini | Standard | 0 | USD | true | true | NULL |
| Coho Salmon | Standard | 0 | USD | true | true | NULL |

Related-table counts:
- `experience_stops` for the 3 sampled drafts: **0**. Across ALL 23 brand experiences: 6 stop rows total — all 6 belong to **2 manually-built `ai_source=NULL` test experiences** ("ORCH-1065 TEST — DC Evening Crawl", "ORCH1059 Proof Night Out", both `status=scheduled`). **Zero snapped drafts have any stop.**
- `event_dates` for the 3 sampled drafts: **0**.
- Brand experience totals: 23 total; **20 snapped today** (Seth's test batch).

---

## Field-by-field table

`PARSER` = `geminiMenuParser.ts` (post-1146, `git show c15895b9c:…`). `EXEC` = `create_experience` executor in `_shared/agentTools.ts` (post-1146). `MAP` = `_shared/canonicalExperienceIntents.ts` (new in 1146).

### POPULATED columns

| Field | Value on the real row | Source (parser → executor path) |
|---|---|---|
| `title` | "Duck" / "Veal Scallopini" / "Coho Salmon" | PARSER `title` (schema `required`) → EXEC writes `title: args.title.trim()` (`agentTools.ts:805`). |
| `slug` | "duck" / "veal-scallopini" / "coho-salmon" | Derived in EXEC `deriveSlug(args.title)` (`:756`). |
| `description` | dish narrative | PARSER `narrative` (schema `required`) → EXEC `description: args.narrative.trim()` (`:807`). |
| `event_type` | experience | Hardcoded in EXEC row (`:808`). |
| `status` / `visibility` | draft / draft | Hardcoded in EXEC (`:809-810`) — DRAFT SHELL contract (META-ORCH-1059 Sub-A). |
| `published_at` | NULL | Hardcoded NULL (`:811`) — preserves I-2/I-4 (no AI-published experience). |
| `timezone` | UTC | Hardcoded (`:812`). |
| `location_mode` | single | Hardcoded (`:813`) — seeds the wizard. |
| `pricing_mode` | whole | Hardcoded (`:814`) — seeds the wizard. |
| `currency` | USD | EXEC resolves `args.currency` (parser) ELSE `brand.default_currency` (USD here), uppercased (`:714-718`); written to the column only when resolved (`:820`). **This is the ORCH-1146 de-GBP fix working** — no "GBP" literal. |
| `brand_id` / `created_by` | brand / snapping user | EXEC row (`:803-804`). |
| `theme.experience_meta` | full blob (see table) | EXEC builds `experienceMeta` (`:757-783`) and writes `theme = { experience_meta }` (`:816`). `ai_source = "business_snap"` because `venue_category` is NULL (neither "play" nor "restaurant"). Raw `intent_tags:[food,entree]`, `suggested_price_min_cents`, `confidence` are retained here for audit. |
| `ticket_types` row (1) | Standard / price 0 / USD / is_free true / unlimited | EXEC inserts the single ticket (`:860-885`) — ORCH-1146 Phase 1. `is_free` derived true because `whole_price_cents` is NULL (`:851-853`); `quantity_total` NULL ⇒ unlimited (Ve5 restaurants never state party size). One ticket only (I-1 ONE-TICKET). |

### BLANK columns

| Field | Value | Why blank — category |
|---|---|---|
| `experience_intents` (array) | NULL | **(a) blank by design / no-fabrication.** PARSER emitted raw `intent_tags=["food","entree"]`. `MAP.mapToCanonicalExperienceIntents` maps to the 4 canonical ids (`adventurous`, `first-date`, `romantic`, `group-fun`); "food"/"entree" match NONE (not canonical, not Play-vocab, no keyword rule) → DROPPED → `[]`. EXEC writes the column ONLY when ≥1 tag maps (`:824`); empty ⇒ key OMITTED ⇒ column stays NULL (the DB CHECK forbids an empty array). Per Constitution #9 / I-PROPOSED-1146-CANONICAL-VIBES, the AI never invents a vibe. *Note: dish names genuinely carry no vibe signal — this is correct behavior, though it means menu-item snaps will almost always land vibe-less.* |
| `vibe_tags` (array) | [] (DB default) | **(a) by design.** Not written by EXEC at all; column default `[]`. (Distinct legacy column from `experience_intents`.) |
| `experience_intent` (text) | NULL | **(a) by design.** Legacy singular column; EXEC writes the plural `experience_intents` only. |
| `whole_price_cents` | NULL | **(a) by design (price honesty).** EXEC sets `whole_price_cents = suggestedMidCents`, and `suggestedMidCents` is non-null ONLY when BOTH min AND max are present (`:792-800`). The menu gave a single per-dish price → parser set `min=2600, max=null` → no midpoint → NULL. The brand sets the real price in the wizard. |
| `ticket_types.price_cents` | 0 (is_free=true) | **(a) by design, consequence of the above.** With no resolved price the executor defaults the ticket to free/$0 (`:851-864`) so the draft is internally consistent; the brand sets the real price + flips is_free in the wizard before publishing. |
| `experience_stops` (table) | EMPTY (0 rows) | **(a) by design — the headline.** PARSER schema has NO stops field; the AI is never asked for stops. EXEC never touches `experience_stops`. A single-venue menu has no multi-stop itinerary; I-1/I-2/I-4 forbid an AI-built dated/structured/published itinerary. The 2–5-stop gate fires only at publish, in the wizard. |
| `event_dates` (table) | EMPTY (0 rows) | **(a) by design.** PARSER has no date field; EXEC writes no date. A dateless draft is unsellable by design (I-2/I-4). Brand adds the date in the wizard. |
| `cover_media_url` / `cover_media_type` / `cover_media_provider` / alt / credit | NULL | **(a) by design.** A menu photo is not the experience's hero image; no cover is fabricated. The brand picks a cover (Library/Giphy/Pexels) in the wizard. |
| `location_text` / `location_geo` / `departure_geo` | NULL | **(a) by design.** The experience inherits the venue's address at publish/render; the parser cannot read a precise street address off a menu and must not invent geo. `location_mode=single` is seeded so the wizard knows it's a single-venue experience. |
| capacity | (no `events` column; not in `ticket_types` either → unlimited) | **(a) by design for Ve5.** `events` has no capacity column. Capacity is a Play-only (Ve6) signal; restaurants never state party size, so `quantity_total=NULL ⇒ is_unlimited=true` (`:854-859`). Not a gap. |
| tax / fee fields (`venue_tax_address`, processing) | NULL | **(a) by design.** Tax stays venue-sourced server-side at checkout (ORCH-1130/1147); never on a draft, never buyer-facing. |
| `show_on_discover` | false | **(a) by design.** A draft is not discoverable until published. |
| `suggested_time_of_day` | not on this row | **(a) by design / not-stated.** Parser emits it ONLY when the menu states a serving window; these à-la-carte dishes stated none → omitted (Play stores it in the blob; Ve5 restaurants don't surface it). |

There are **no category-(c) findings** (extracted-but-not-persisted) for this brand's snap. The only fields the parser extracts that did not land in a real column are `confidence` and the raw `intent_tags` / `suggested_price_*`, which are intentionally retained in `theme.experience_meta` for audit. Category-(b) (inferable-but-not-wired) does not apply to stops/dates/cover/address either — those are inherently un-inferable from a menu photo, so they are correctly (a).

---

## STOPS / ITINERARY — plain verdict

**Expected by design. Not a gap.**

1. **The parser never attempts stops.** `geminiMenuParser.ts` (post-1146) `RESPONSE_SCHEMA.experiences.items.properties` = `{title, narrative, suggested_price_min_cents, suggested_price_max_cents, currency, intent_tags, is_free}` with `required:["title","narrative"]`. No `stops`, no `itinerary`, no `date`. The system prompt asks for "single-intent experience offerings," never an itinerary.
2. **The executor never writes stops.** `create_experience` inserts exactly one `events` row + one `ticket_types` row. It does not reference `experience_stops` or `event_dates` anywhere.
3. **Ground truth confirms.** 0 `experience_stops` rows and 0 `event_dates` rows for all 20 snapped drafts; the only stop rows for this brand (6) belong to 2 manually-built `ai_source=NULL` experiences.
4. **The invariants require it.** META-ORCH-1059 Sub-A made `create_experience` a DRAFT SHELL precisely so no AI path produces a published, dated, multi-stop, sellable experience (I-1 ONE-TICKET / I-2 / I-4). The 2–5-stop requirement is enforced at PUBLISH in the wizard, where the brand builds the stops + adds the date + sets the real price.

So "STOPS and ITINERARY were not built out" is the system working as designed: a snap produces a finishable draft shell, and the human completes the itinerary before publishing. The exact table is **`experience_stops`** (`event_id` FK); dates are **`event_dates`** (`event_id` FK).

---

## Five-truth-layer reconciliation

| Layer | Finding |
|---|---|
| Docs | Memory + ORCH-1146/1059 artifacts: snap creates a DRAFT SHELL; vibes/currency/is_free/capacity persist to real columns; stops/date/price finished in wizard. Matches behavior. |
| Schema | `events` has `experience_intents` (array, CHECK 1–4 canonical), `currency`, `whole_price_cents`; NO is_free/capacity/address columns on `events`. `experience_stops` + `event_dates` are separate FK tables. `ticket_types` carries is_free/quantity. All consistent with the writes. |
| Code | Post-1146 `create_experience` writes title/slug/description/currency/whole_price_cents(conditional)/experience_intents(conditional)/theme + one ticket_types row; never stops/dates/cover/geo. |
| Runtime | The DEPLOYED (post-1146) edge function ran for Seth's snap; the anchor checkout `main@fb27338d3` is behind the 1146 merge (`c15895b9c` is NOT an ancestor of HEAD) — read deployed source via `git show`. |
| Data | 20 drafts: experience_intents NULL, vibe_tags [], whole_price_cents NULL, currency USD, theme blob populated, 1 free unlimited ticket each, 0 stops, 0 dates. Exactly what the post-1146 code produces. |

**Contradiction flagged (not a bug in 1146):** the LOCAL anchor `main` is behind the ORCH-1146 merge. Anyone reading `supabase/functions/_shared/agentTools.ts` on the current checkout sees the PRE-1146 executor (no `experience_intents`/`is_free`/`ticket_types` write) and could wrongly conclude 1146 didn't ship. It did ship and is live; the checkout is stale. This is a checkout-sync observation for the orchestrator, not a defect in the snap.

---

## Discoveries for the orchestrator (side issues, not in scope to fix)

1. **Menu-item snaps land vibe-less by nature.** Because dish-name tags ("food", "entree", "entree") map to none of the 4 canonical vibe ids, `experience_intents` will be NULL for essentially every food-menu snap. This is correct per no-fabrication, but it means the parser's `intent_tags` for à-la-carte menus carry no usable vibe signal — worth noting if discoverability/vibe-gating expects populated vibes. (No action; design choice.)
2. **One-dish-per-draft granularity.** The snap produced ~20 drafts, one per menu item, rather than a few "experience" concepts (e.g. "Date-night tasting menu"). The prompt asks for "single-intent experience offerings," but Gemini returned per-dish rows. If Seth expected a handful of curated experiences rather than 20 dish-drafts, that is a parser-prompt/UX expectation question — register separately, out of scope here.
3. **Local checkout is behind PR #494 (ORCH-1146).** Recommend `git fetch && rebase` the anchor so on-disk source matches deployed reality.

---

## Confidence

**Proven** for the field-by-field audit and the stops/itinerary verdict: backed by the live DB rows (read-only), the deployed post-1146 source (`git show c15895b9c:…`), and the related-table counts. No simulator repro needed — this is a backend/data audit (Prime-Directive-7 exemption: pure backend/SQL/edge-function investigation). No fix proposed.

## Recommended next phase

None required for a defect — the snap behaves as designed. If Seth wants menu snaps to (a) infer vibes from dish/cuisine context or (b) collapse per-dish rows into fewer curated experiences, those are NEW scope items (parser-prompt changes) for a fresh ORCH, not fixes to 1146.
