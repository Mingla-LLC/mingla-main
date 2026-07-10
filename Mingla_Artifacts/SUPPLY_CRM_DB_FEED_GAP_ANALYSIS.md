# Supply CRM ← DB Feed — Gap Analysis (ORCH-1324)

**Date:** 2026-07-09 · **Owner:** orchestrator · **Status:** ✅ SHIPPED / CLOSED 2026-07-09

## CLOSE (2026-07-09)
- **CRM schema:** Supply CRM (list `901417374441`) extended +14 fields via ClickUp REST (token creates fields; can't delete — one probe field cleaned by Seth in UI). Geo (legacy, shared) left in place; superseded by City+Market.
- **Skill:** `.claude/skills/supply-intake/` built (SKILL.md + reference/crm_map.md + reference/seed_query.sql). Mirrors influencer-intake; live-fetch → rank highest-first → dedup on Place Pool ID → land `prospect`.
- **Score-source correction:** rank on `place_pool.ai_signal_scores` (jsonb, 0–100, ~99% coverage), NOT the sparse legacy `place_scores` table (32 NY rows / 12 Paris — would bury NY/Paris). Skill + query fixed. Memory `reference_clickup_mcp_and_marketing_space` updated.
- **Seed:** 292 cards live in `prospect` — **10 restaurants + 10 play + 10 creative-arts per city** across all 10 markets (Durham/Cary play = 6, only 6 exist), plain place-name titles, round-robin markets, ranked score-desc → rating → review count. All scored 95–100 (top band; no cutoff). Parks/nature excluded.
- **Data caveats carried forward:** email not in DB (human researches from website); no phone for Paris/Brussels (email/visit); `city` labels metro-wide/dirty (seed keyed off city pattern; strict city-limits available on request).
- **No PR/deploy:** ops tooling only — skill is local (`.claude/` gitignored), CRM is external, no product-code touch.

**Goal:** Build a `supply-intake` skill that feeds the ClickUp **Supply CRM** from the database —
mirroring `influencer-intake` — seeding the highest-scoring deck-eligible **places** (restaurants,
play, creative-arts venues) across 10 markets, and supporting **cold call / cold email / physical visit**.

**Verdict (one line):** The Supply CRM in its **current shape CANNOT truly hold this data yet**.
It is missing ~10 outreach fields, its Geo dropdown covers only 6 of 10 markets, and — more
importantly — the **database itself has two data blockers** (no email anywhere; zero phone for
Paris + Brussels) plus dirty city labels. All are fixable, but they are prerequisites to the skill.

---

## 1. Sources examined
- **ClickUp Supply CRM** list `901417374441` (Marketing Space `90145094911`) — fields + statuses + description.
- **ClickUp Influencer CRM** list `901417374444` — the working model + its `crm_map.md`.
- **`influencer-intake` skill** — the end-to-end pattern to copy (step-0 live-fetch, research, create/update card, fill fields, land status).
- **DB (prod `gqnoajqerqhnvulmnyvv`):** `place_pool`, `place_scores`, `session_deck_cards`, `session_deck_versions`, `brand_place_pipeline_state`, `curated_places_cache`.

---

## 2. Supply CRM — current shape

**Purpose (from list desc):** "Business supply pipeline. One card per prospect/account." One list for all cities; geography via title prefix `[City | Market] Prospect — ICP`. The description ITSELF flags: *"Pending admin cleanup … create or expose dropdown fields for `City` and `Market`."*

**Statuses:** `to do → prospect → contacting → meeting set → onboarded → live → active → at risk → churned → not applicable`. (Account lifecycle; channel-agnostic.)

**Custom fields (only 8):**
| Field | Type | Note |
|---|---|---|
| Lead Type | dropdown | Creator, Venue, Promoter, Trip Host, Restaurant, Gallery, Campus/Diaspora Org, Local Partner |
| Geo | dropdown | **Raleigh, Cary, Durham, DC, New York, Lagos — only 6** |
| Category | short_text | free text |
| Decision Maker Contact | text | free text (not a real phone/email field) |
| Number Of Live Offerings | number | |
| Last Touch | date | |
| Feedback | text | |
| Hypothesis | task-relation | links to Experiments |

---

## 3. What the DB actually holds (`place_pool`)

Deck-eligibility proxy used here: `is_servable = true AND deleted_at IS NULL` (the durable filter;
the live swipeable deck in `session_deck_cards` is per-session, generated from scored, servable places).

**Present & usable:** `id` (uuid — dedupe key), `name`, `address` (visits), `lat`/`lng` + `google_maps_uri` (visits/maps), `national_phone_number` (calls), `website`, `city`/`country`/`city_id`, `primary_type`/`primary_type_display_name`/`types` (category), `rating`/`review_count`, `price_tier`, `editorial_summary`/`generative_summary`, `is_claimed`/`claimed_by`, `ai_signal_scores` (jsonb). Score detail also in `place_scores` (`place_id`, `signal_id`, `score`, `contributions`).

**Absent:** **no email column anywhere.** Website is the only web contact.

---

## 4. Market coverage — empirical (servable places, deck-eligible proxy)

| Market | Servable | With phone | With website | Notes |
|---|---|---|---|---|
| New York | 9,902 | 6,110 (62%) | 92% | strong |
| London | 6,528 (+4,140 mislabelled "London E15 2RU" + dozens of postcode variants) | 80% | 91% | **city label fragmented** |
| Paris | 4,464 | **0 (0%)** | 88% | **NO phone — not in column or raw Google payload** |
| Washington (DC) | 2,298 | 57% | 90% | labelled "Washington", not "DC" |
| Brussels | 1,857 | **0 (0%)** | 88% | **NO phone — same as Paris** |
| Raleigh | 1,526 | 86% | 92% | 1 claimed |
| Fort Lauderdale | 958 | 90% | 92% | strong |
| Lagos | 908 | 82% | 80% | strong |
| Cary | 721 | 86% | 91% | |
| Durham | 647 | 83% | 90% | |

All 10 target markets exist with real inventory (~30k servable total). Contact-data quality is the problem, not volume.

---

## 5. Gap matrix — need → DB source → CRM field today → gap

| Outreach need | DB source | Supply CRM field today | Gap |
|---|---|---|---|
| Place name | `name` | task title `[City\|Market] …` | OK |
| Category (restaurant/play/creative-arts) | `primary_type`/`types` | Category (free text) + Lead Type | Partial — Lead Type lacks **Play / Theater / Creative-arts**; add or map |
| City + Market | `city`,`country`,`city_id` | Geo dropdown (6) | **GAP** — missing London, Paris, Brussels, Fort Lauderdale; no Market field |
| Score / rank (seed highest-first) | `ai_signal_scores` / `place_scores.score` | none | **GAP** — add Score + Rank |
| **Phone (cold call)** | `national_phone_number` | none (only free-text "Decision Maker Contact") | **GAP** — add Phone field; **+ DB blocker: 0% for Paris/Brussels** |
| **Email (cold email)** | **not in DB** (website only) | none | **DOUBLE GAP** — add Email field **and** enrich email from website |
| **Address / map (visit)** | `address`, `google_maps_uri`, `lat/lng` | none | **GAP** — add Address + Map link |
| Website | `website` | none | GAP — add Website |
| Source (DB-seed/deck) | n/a | none | GAP (minor) — influencer CRM has it |
| Next action cadence | n/a | Last Touch only | Partial — add Next Action + Next Action Date |
| Channel used (call/email/visit) + outcome | n/a | none; statuses are channel-agnostic | **GAP** — add Channel field (or per-touch log) |
| Dedupe key | `place_pool.id` | none | **GAP** — add Place Pool ID (prevents re-seed dupes) |

---

## 6. Critical blockers (must resolve before/with the skill)

1. **Email is not in the DB.** Cold-emailing requires a 2-step enrichment: derive email from `website` (scrape contact page / MX-verify) or fall back to the site's contact form. No enrichment = no cold email.
2. **Phone missing for entire Paris + Brussels** (verified: 0 in column AND 0 in `raw_google_data`). Cold-calling those two is impossible from current data — needs a Google **Place Details** re-fetch to pull `internationalPhoneNumber`, or a different source.
3. **City labels are dirty.** London is split across `London` + `London E15 2RU` + dozens of postcode strings; DC is stored as `Washington`; `country` is polluted (e.g. `GB邮政编码: …`). A naive `city = 'London'` seed silently drops ~4,140+ London places. **Seeding must key off `city_id`/geofence (lat-lng), not the free-text `city`.**
4. **Geo dropdown covers 6/10 markets.** ClickUp admin must add London, Paris, Brussels, Fort Lauderdale (+ a Market field). Note: MCP cannot create custom fields — this is a manual ClickUp admin step (or REST API with the personal token).
5. **Deck-eligibility threshold is not a single column.** "Scored high enough for the deck" is enforced by the deck generator over `ai_signal_scores`/`place_scores` per session. Pin the exact ranking expression at spec time so "seed highest-first" is reproducible.

---

## 7. Recommended remediation (prerequisites, in order)

**A. Supply CRM schema (ClickUp admin — ~15 min):** add fields — Phone (phone), Email (email), Website (url), Address (text), Map link (url), Score (number), Rank (number), Place Pool ID (short_text, dedupe), Source (dropdown: DB-seed/Deck/Scouted/Referral/Inbound), Channel (dropdown: Cold call/Cold email/Physical visit), Next Action (short_text), Next Action Date (date). Extend **Geo** to all 10 markets + add **Market** dropdown. Extend **Lead Type** with Play/Theater + Creative-arts (or rely on Category).

**B. Data enrichment:** (1) email — website→email enrichment step in the seeding skill; (2) Paris/Brussels phone — Place Details re-fetch for `internationalPhoneNumber`; (3) city normalization — map `city_id`/geofence → canonical Market at seed time.

**C. Build the `supply-intake` skill** (mirrors `influencer-intake`): step-0 live-fetch CRM schema → query `place_pool` for servable places in a chosen Market, rank by score DESC → for each, dedupe by Place Pool ID, enrich email, create/update card with all fields, set Geo/Market/Lead Type, land in `prospect`, set first Next Action per channel. Batch-controlled (Seth approves each market/batch), seed highest-first then down.

---

## 8. Answer to the core question
*"Can this truly hold places data — the high-scoring deck venues — across the 10 markets, for call/email/visit?"*
**Not as-is.** The **volume is there** (~30k servable places, all 10 markets). But the CRM lacks the outreach fields and the DB lacks email everywhere + phone for Paris/Brussels + clean city labels. With the Section-7 fixes it becomes a clean, automatable feed. Cold **calling** works today for 8/10 markets (not Paris/Brussels); cold **email** works everywhere only after website→email enrichment; **physical visits** work everywhere now (address + map present).
