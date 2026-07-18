# Supply CRM Fine-Dining Reset — 2026-07-15

**Operation:** Reshape the Supply CRM (ClickUp list `901417374441`, Marketing Space `90145094911`)
to fine-dining only, seeded 30-per-city for Lagos / New York / Raleigh-Cary / Durham in strict
round-robin (alternating-city) creation order. Ordered by Seth 2026-07-15; parameters confirmed
interactively before execution.

## Confirmed parameters (Seth's answers)

| Question | Decision |
|---|---|
| "Bounced by the bouncer" | Places that **passed** the bouncer (deck-eligible, `is_servable=true`), ranked by the deck scorer `place_scores.score` (rule+AI blend, 0–200, gate ≥120). The literally-bounced pool held only 3 places ≥120 across all 4 cities — could not fill anything. |
| Removal scope | **Categories only** — delete play + creative-arts everywhere; KEEP fine-dining prospects from other markets (London, Paris, DC, Brussels, Fort Lauderdale). |
| Durham shortfall | Seed all **26** that exist at the deck gate (only 26 score ≥120); stay deck-faithful, no backfill below the gate. |
| Removal method | **Hard delete** (ClickUp trash, ~30-day recovery) — seeded prospects are regenerable from DB; full pre-delete backup taken. |

## Pool sizes at the deck gate (score ≥ 120, live prod probe 2026-07-15)

New York 455 · Raleigh-Cary 88 · Lagos 39 · Durham 26. Bounced-but-high-scoring: Lagos 1, Raleigh-Cary 2, NY 0, Durham 0.

## Phase A — removal (verified against live re-fetch)

- 298 cards found → **244 deleted**: 94 play (Venue), 100 creative-arts (Gallery), 50 stale
  fine-dining seeds from the 5 target cities (replaced by the fresh ordered seed).
- **50 kept**: fine-dining prospects, 10 each London / Paris / Washington DC / Brussels / Fort Lauderdale.
- **4 protected, untouched**: Freshie & Creammie (Lagos, `onboarded`), schema probe (`not applicable`),
  2 `[SAMPLE]` cards (`to do`). Delete rule required status=`prospect` + Source=`DB-seed`; anything else flagged.
- 0 failed deletes. Pre-delete backup of all 298 cards with custom fields:
  `Mingla_Artifacts/evidence/SUPPLY_CRM_FINE_DINING_RESET_2026_07_15/supply_crm_pre_delete_backup.json`.

## Phase B — seed (verified: counts, spot-checks, zero duplicate Place Pool IDs)

- **116/116 created**, all status `prospect`: Lagos 30 · New York 30 · Raleigh-Cary 30 (Raleigh 25 + Cary 5,
  one combined bucket ranked together) · Durham 26.
- **Round-robin creation order proven** (Lagos → NY → Raleigh-Cary → Durham; Durham exhausted at
  seq 104, remaining 3 cities continued the cycle to seq 116). First 4: ATIJE (Lagos), Le Bernardin (NY),
  Sullivan's Steakhouse (Raleigh), M Sushi (Durham).
- Fields per card: City (actual city option), Lead Type=Restaurant, Category, Phone, Website, Address,
  Score (deck 0–200), Rank (per-city, 1=top), Place Pool ID, Source=DB-seed, Channel=Cold call (when
  phone exists), Next Action text, `start_date`=2026-07-15, **no due date**. Email / Decision Maker /
  Next Action Date left blank per skill contract.
- 0 substitutions needed (no overlap with surviving cards; Freshie & Creammie's place not in any candidate set).
- 0 cap incidents ("custom field usages" plan cap never hit — the 244 deletions freed headroom first).
- **Phone**: ClickUp rejects raw national formats on the phone field → all 109 phones backfilled in
  E.164 (`+1…`/`+234…`), verified on 5-card sample. 7 cards legitimately phone-less in DB (NY 5, Lagos 2)
  → no Channel, "use email/visit" note in description.
- Data gaps noted in descriptions: 5 NY cards missing map_link + display category in DB.

## Final CRM state (re-fetched)

**170 cards** = 116 new fine-dining seeds (4 cities) + 50 kept other-market fine-dining + 4 protected.
All 166 prospects carry full DB fact sheets + "Research before contact" checklist.

## Operational learnings (routed to skill reference `crm_map.md`)

1. **No "Market" dropdown field exists** on the Supply CRM list — City is the only geo field (crm_map snapshot was stale).
2. **No "Map Link" field exists** — map links go in the card description.
3. **Phone field requires E.164** (`+…`) — raw `national_phone_number` values are rejected on create; convert before writing.
4. **ClickUp MCP OAuth server caps at ~300 calls/24h** — bulk operations (100s of writes) must use REST v2
   with `CLICKUP_API_TOKEN` (standing probe authority); MCP fine for schema/status ingest.

## Evidence

`Mingla_Artifacts/evidence/SUPPLY_CRM_FINE_DINING_RESET_2026_07_15/` — `supply_crm_pre_delete_backup.json`
(all 298 pre-delete cards), `seed_results.json` (per-card task ids/ranks/flags), `phone_backfill.json`.
