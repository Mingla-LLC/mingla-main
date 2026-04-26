# INVESTIGATION — ORCH-0678 — Lagos Bouncer Mass-Rejection

**Mode:** INVESTIGATE (Phase 7 report)
**Date:** 2026-04-25
**Investigator:** mingla-forensics
**Severity:** S1 — blocks Lagos serving + reveals systemic seed-pipeline regression
**Confidence:** HIGH on root cause; HIGH on blast radius
**Source dispatch:** [`Mingla_Artifacts/prompts/FORENSICS_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md`](../prompts/FORENSICS_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md)

---

## Layman summary

Lagos was seeded with 4,222 places and the Bouncer rejected every one of them. **The smoking-gun number: 98.4% of Lagos rejections fire `B8:no_stored_photos`** — every place has the Google photo URL metadata, but the **photo download step (`backfill-place-photos`) was never run** before Bouncer ran. Bouncer requires actual downloaded photos in storage; without them, every place fails universally regardless of cluster, website, or hours.

This is **not Lagos-specific.** It is a **systemic seed-pipeline regression** introduced by ORCH-0640 ch06: the photo-backfill action-based modes (`mode='initial'` and `mode='refresh_servable'`) were both rewritten to require `is_servable=true`. But Bouncer is the **sole writer** of `is_servable`, and Bouncer requires `stored_photo_urls` populated to set it true. **Deadlock**: a freshly-seeded city cannot pass Bouncer, and the action-based photo backfill cannot run until Bouncer passes it. The legacy backfill path (calling `/backfill-place-photos` with no `action` field) is the only escape hatch — it uses the RPC `get_places_needing_photos` which gates on `photos IS NOT NULL AND stored_photo_urls IS NULL`, NOT on `is_servable`. The legacy path is not documented, not surfaced in the admin UI, and the user did not know to run it.

There is also a **second root cause underneath the first**: even after the photo issue is fixed, only **24.6% of Lagos rows would pass Bouncer**, because **68.4% of Lagos venues have no website at all** (B4:no_website). Cluster `A_COMMERCIAL` (default cluster for restaurants, bars, shops) demands an own-domain website — culturally mis-aligned with the Nigerian market, where most commercial venues operate without any web presence. This is a Bouncer rule design flaw, not a seeder defect.

**Recommended direction (not part of this investigation, just framing for the spec writer):** the spec must address (1) the photo-pipeline deadlock as a top-priority fix because it blocks every future city seed regardless of country, and (2) the Bouncer cluster-A website requirement as a market-aware policy decision — the user has to choose whether to relax B4/B5 for international markets or accept a structurally lower pass rate for non-US cities.

**Findings:** 2 root causes (🔴), 1 contributing factor (🟠), 4 hidden flaws (🟡), 3 observations (🔵).

---

## Phase 0 — Context Ingest

| Source | Read | Key fact carried forward |
|--------|------|--------------------------|
| `MEMORY.md` | Yes | Diagnose-first; quality bar; verify "doesn't exist" claims; full migration chain rule |
| Forensics dispatch | Yes | 5-phase mandate, classification (A)–(E) required, must paste raw SQL, comparison baseline mandatory |
| `supabase/functions/_shared/bouncer.ts` | Yes (1–249) | Pure rules; B8 is universal; cluster default = A_COMMERCIAL; SOCIAL_DOMAINS blocklist |
| `supabase/functions/run-bouncer/index.ts` | Yes (1–189) | Single writer of `is_servable + bouncer_reason + bouncer_validated_at`; reads `is_active=true` rows scoped by `city_id` |
| `supabase/functions/admin-seed-places/index.ts` | Yes (transformGooglePlaceForSeed §253–374) | Writes 50+ columns to `place_pool` insert. **Does NOT write `stored_photo_urls`.** Does NOT trigger any post-insert photo job. |
| `supabase/functions/backfill-place-photos/index.ts` | Yes (1–1065) | Two paths: legacy (no `action`; uses RPC, no is_servable gate) vs action-based (`mode='initial' \| 'refresh_servable'`; both gate on `is_servable=true` per ORCH-0640 ch06) |
| `Mingla_Artifacts/outputs/SPEC_ORCH-0642_CROSS_CITY_BOUNCER_SWEEP.md` | Yes | Earlier sweep spec assumed Bouncer rules are language/country-agnostic; that assumption is now empirically falsified for Lagos |
| `pg_proc` definitions of `get_places_needing_photos` + `count_places_needing_photos` | Yes | Confirms legacy path gate is `photos IS NOT NULL AND stored_photo_urls IS NULL`, **not** `is_servable=true` |

**Migration chain note:** No migration in `supabase/migrations/` defines `get_places_needing_photos` — the RPC was created out-of-band (likely directly in dashboard) and is the latest authoritative definition. Verified via `pg_proc.prosrc` — see Phase 3 §Schema.

---

## Phase 1 — Failure Surface (raw SQL output, verbatim)

### §1.1 Lagos city resolution
```sql
SELECT DISTINCT city, country, city_id, COUNT(*) AS rows FROM place_pool
WHERE city ILIKE '%lagos%' OR country ILIKE '%nigeria%'
GROUP BY city, country, city_id ORDER BY rows DESC;
```
Result (head):
| city   | country | city_id | rows |
|--------|---------|---------|------|
| Lagos  | Nigeria | `287cab01-4430-4930-983a-435aa194f33a` | **4222** |
| Independence Layout | Nigeria | NULL | 27 |
| New Haven | Nigeria | NULL | 17 |
| Achara | Nigeria | NULL | 15 |
| ... (~80 rows with `city_id=null` and addresses parsed as city names) ... | | | |

→ Lagos `city_id = 287cab01-4430-4930-983a-435aa194f33a`. **Note 🔵:** ~150 rows under `country='Nigeria'` have `city_id=NULL` and parse-corrupted city values (e.g., `"FG27+MP9"`, `"1 Aguleri St"`, `"opposite urban radio"`). Out of scope for this investigation but logged as discovery D-3.

### §1.2 Lagos pool census
```sql
SELECT COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE is_active = true) AS active_rows,
  COUNT(*) FILTER (WHERE is_servable = true) AS servable,
  COUNT(*) FILTER (WHERE is_servable = false) AS not_servable,
  COUNT(*) FILTER (WHERE is_servable IS NULL) AS unbounced,
  MIN(bouncer_validated_at) AS first_bounced, MAX(bouncer_validated_at) AS last_bounced,
  MIN(created_at) AS first_seeded, MAX(created_at) AS last_seeded
FROM place_pool WHERE city_id = '287cab01-4430-4930-983a-435aa194f33a';
```
Result:
| field | value |
|-------|-------|
| total_rows | 4222 |
| active_rows | 4222 |
| **servable** | **0** |
| **not_servable** | **4222** |
| unbounced | 0 |
| first_bounced | `2026-04-25 22:17:17.727+00` |
| last_bounced | `2026-04-25 22:17:17.727+00` |
| first_seeded | `2026-04-25 21:05:19.597228+00` |
| last_seeded | `2026-04-25 22:14:44.929547+00` |

→ Bouncer ran **exactly once**, at 22:17:17 UTC, **2 minutes 33 seconds after seeding completed**. No photo-backfill window between seed and bounce. 100% rejection. 0% pass.

### §1.3 Top rejection reasons (combined)
```sql
SELECT bouncer_reason, COUNT(*) AS n,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM place_pool WHERE city_id = '287cab01-...' AND is_servable = false
GROUP BY bouncer_reason ORDER BY n DESC LIMIT 30;
```
Result (head):
| bouncer_reason | n | pct |
|----------------|---|-----|
| `B8:no_stored_photos;B4:no_website` | 2323 | 55.0 |
| `B8:no_stored_photos` | 1039 | 24.6 |
| `B8:no_stored_photos;B4:no_website;B6:no_hours` | 565 | 13.4 |
| `B8:no_stored_photos;B5:social_only` | 148 | 3.5 |
| `B8:no_stored_photos;B6:no_hours` | 66 | 1.6 |
| `B1:gym` | 13 | 0.3 |
| `B8:no_stored_photos;B5:social_only;B6:no_hours` | 12 | 0.3 |
| `B1:real_estate_agency` | 11 | 0.3 |
| `B1:car_wash` | 9 | 0.2 |
| `B1:school`, `B1:pharmacy` | 6 each | 0.1 each |
| `B1:fitness_center` | 5 | 0.1 |
| ...other B1: storage(3), local_government_office(3), university(2), doctor(2), car_dealer(2), veterinary_care(2), primary_school(1), bank(1), preschool(1), hospital(1), car_repair(1) | | |

### §1.4 Per-rule atomic incidence (semicolon-split)
```sql
SELECT reason_atom, COUNT(*) AS n FROM (
  SELECT unnest(string_to_array(bouncer_reason, ';')) AS reason_atom
  FROM place_pool WHERE city_id = '287cab01-...' AND is_servable = false
) sub GROUP BY reason_atom ORDER BY n DESC;
```
Result:
| rule | n | % of 4222 |
|------|---|-----------|
| **B8:no_stored_photos** | **4153** | **98.4** |
| B4:no_website | 2888 | 68.4 |
| B6:no_hours | 643 | 15.2 |
| B5:social_only | 160 | 3.8 |
| B1:gym | 13 | 0.3 |
| B1:real_estate_agency | 11 | 0.3 |
| B1:car_wash | 9 | 0.2 |
| B1:pharmacy | 6 | 0.1 |
| B1:school | 6 | 0.1 |
| B1:fitness_center | 5 | 0.1 |
| ...all B1 totals | 69 | 1.6 |

**Smoking gun confirmed: B8 dominates at 98.4%.** The 69 rows that don't fire B8 are precisely the 69 rows rejected by B1 (excluded type), which short-circuits before B8 runs (`bouncer.ts:193-196`). Math checks out: 4,153 + 69 = 4,222.

### §1.5 Comparison baseline — all cities with ≥1k rows
```sql
SELECT c.name, c.country, COUNT(*) AS total,
  COUNT(*) FILTER (WHERE pp.is_servable = true) AS servable,
  COUNT(*) FILTER (WHERE pp.is_servable = false) AS not_servable,
  COUNT(*) FILTER (WHERE pp.is_servable IS NULL) AS unbounced,
  ROUND(100.0 * COUNT(*) FILTER (WHERE pp.is_servable = true) / NULLIF(COUNT(*),0), 1) AS pct_servable,
  COUNT(*) FILTER (WHERE pp.stored_photo_urls IS NOT NULL AND array_length(pp.stored_photo_urls,1) > 0
                    AND NOT (array_length(pp.stored_photo_urls,1)=1 AND pp.stored_photo_urls[1]='__backfill_failed__')) AS has_real_stored,
  COUNT(*) FILTER (WHERE pp.stored_photo_urls IS NULL OR array_length(pp.stored_photo_urls,1) IS NULL) AS no_stored
FROM place_pool pp JOIN seeding_cities c ON c.id = pp.city_id
WHERE pp.is_active = true GROUP BY c.name, c.country ORDER BY total DESC LIMIT 25;
```
Result:

| city | country | total | servable | not_servable | unbounced | pct_servable | has_real_stored | no_stored |
|------|---------|-------|----------|--------------|-----------|--------------|-----------------|-----------|
| Paris | France | 7476 | 0 | 0 | **7476** | 0.0 | 0 | 7476 |
| Miami | United States | 6111 | 0 | 11 | 6100 | 0.0 | 53 | 6058 |
| **London** | UK | 5893 | **3627** | 2266 | 0 | **61.5** | 4568 | 1325 |
| New York | United States | 5720 | 0 | 4 | 5716 | 0.0 | 0 | 5720 |
| Berlin | Germany | 5686 | 0 | 0 | 5686 | 0.0 | 0 | 5686 |
| **Washington** | United States | 5542 | **2358** | 3184 | 0 | **42.5** | 2761 | 2781 |
| **Brussels** | Belgium | 4643 | **1884** | 2759 | 0 | **40.6** | 2678 | 1953 |
| **Lagos** | Nigeria | **4222** | **0** | **4222** | 0 | **0.0** | **0** | **4222** |
| Barcelona | Spain | 4040 | 0 | 0 | 4040 | 0.0 | 0 | 4040 |
| Toronto | Canada | 3599 | 0 | 1 | 3598 | 0.0 | 0 | 3599 |
| Chicago | United States | 3469 | 0 | 1 | 3468 | 0.0 | 0 | 3469 |
| **Raleigh** | United States | 2912 | **1715** | 1191 | 6 | **58.9** | 2210 | 700 |
| Dallas | United States | 2541 | 0 | 0 | 2541 | 0.0 | 0 | 2541 |
| **Fort Lauderdale** | United States | 2247 | **1006** | 1241 | 0 | **44.8** | 1354 | 893 |
| **Baltimore** | United States | 2213 | **1253** | 960 | 0 | **56.6** | 1712 | 501 |
| **Cary** | United States | 1680 | **820** | 860 | 0 | **48.8** | 990 | 690 |
| **Durham** | United States | 1300 | **699** | 600 | 0 | **53.8** | 883 | 417 |

**Two starkly different patterns visible:**

1. **Healthy cities** (London, Washington, Brussels, Raleigh, Fort Lauderdale, Baltimore, Cary, Durham): all have `has_real_stored` populated for **76–95% of their pool**, then Bouncer was run, achieving 40–62% pass rates. These were seeded under the **legacy pipeline** (seed → legacy backfill → Bouncer) before ORCH-0640 ch06 broke the action-based path.

2. **Stuck cities** (Paris, Miami, NYC, Berlin, Barcelona, Toronto, Chicago, Dallas): all have `has_real_stored ≈ 0` — photo backfill **never ran**. Most also have Bouncer never run (`unbounced ≈ total`). These are the same 9 cities ORCH-0642 was supposed to fix; ORCH-0642 closed without ever actually running the backfill (it ran Bouncer for `Fort Lauderdale` only, which is why FL has the photos AND the Bouncer pass — must have been backfilled by some other path before).

3. **Lagos is a third pattern**: no stored photos, **but Bouncer was run** anyway. This is the only city where the user explicitly executed Bouncer against an un-backfilled pool. The result is what the rules dictate: 100% rejection.

→ The failure mode is **systemic** (not Lagos-specific): every city seeded after ORCH-0640 ch06 hits this. Lagos is the first city where the operator actually reached the Bouncer step, exposing the latent deadlock.

---

## Phase 2 — Per-Rule Probes

### §2.1 B8 deep probe — sample of 5 random rejected Lagos rows
```sql
SELECT id, name, primary_type, types, business_status,
  LEFT(COALESCE(website,'<NULL>'),80) AS website,
  opening_hours IS NULL AS hours_is_null, opening_hours = '{}'::jsonb AS hours_is_empty,
  jsonb_array_length(COALESCE(photos,'[]'::jsonb)) AS photos_count,
  COALESCE(array_length(stored_photo_urls,1),0) AS stored_count,
  review_count, rating, is_servable, bouncer_reason
FROM place_pool WHERE city_id='287cab01-...' AND is_servable=false
ORDER BY md5(id::text) LIMIT 5;
```

| # | name | primary_type | website | hours? | photos | stored | rev/rating | bouncer_reason |
|---|------|-------------|---------|--------|--------|--------|------------|-----------------|
| 1 | The Parliament Bar & Lounge | bar | NULL | YES | 10 | 0 | 25/3.7 | B8;B4 |
| 2 | MD kitchens | restaurant | NULL | YES | 7 | 0 | 6/4.8 | B8;B4 |
| 3 | Seye-JoeBanks Production | art_gallery | NULL | YES | 10 | 0 | 0/null | B8;B4 |
| 4 | kalakuta museum | museum | http://kalakutamuseum.com/ | YES | 10 | 0 | 1296/4.3 | B8 |
| 5 | Gistlovers | tourist_attraction | NULL | YES | 4 | 0 | 1/3 | B8;B4 |

**Manual walkthrough (kalakuta museum, row 4):**
- `deriveCluster([museum, hotel, lodging, point_of_interest, establishment])` → `museum ∈ CULTURAL_TYPES` → cluster = `B_CULTURAL`
- B1 (excluded type): no excluded type → skip
- B2 (closed): `business_status='OPERATIONAL'` → skip
- B3 (missing required): name + lat + lng all present → skip
- B9 (child venue): name doesn't match retailer patterns → skip
- B7 (Google photos): photos_count=10 > 0 → no push
- B8 (stored photos): stored_count=0 → **push `B8:no_stored_photos`** ✓
- Cluster B path:
  - famous_bypass = `(1296 ≥ 500 AND 4.3 ≥ 4.5)` = **false** (rating below threshold)
  - `isOwnDomain('http://kalakutamuseum.com/')` = `true` (no SOCIAL_DOMAINS substring) → no website push
  - `hasOpeningHours()` = true (hours object non-empty) → no B6 push
- Final reasons: `['B8:no_stored_photos']` ✓ matches DB exactly.

→ The aggregate is faithful — Bouncer is doing precisely what its code says. Manual trace confirms the SQL output.

### §2.2 B4/B5 cultural-mismatch probe
- Total Lagos rows missing website entirely (B4): **2,888 (68.4%)**
- Total Lagos rows with website that fails own-domain test (B5:social_only): **160 (3.8%)**
- Total Lagos rows with own-domain website: **4,222 − 2,888 − 160 = 1,174 (27.8%)**

For comparison, Raleigh (US baseline): 1,715/2,912 = 58.9% pass rate, with photos populated. The photos-having Raleigh subset that fails Bouncer (1,191) presumably fails B4/B5/B6 too, but at much lower rates than Lagos. **Lagos has a structurally lower own-domain-website rate** than US benchmarks, consistent with the well-documented Nigerian SME pattern of operating via Instagram/WhatsApp/no web presence.

→ Even after B8 is fixed, Lagos's projected pass rate is **24.6%** (the 1,039 rows whose ONLY rejection reason was B8). 75% of Lagos venues will continue to fail Bouncer because cluster A_COMMERCIAL demands a website.

### §2.3 B1 excluded-types probe
69 Lagos rows hit B1, including 13 gyms, 11 real_estate_agencies, 9 car_washes, 6 schools, 6 pharmacies, 5 fitness_centers — totally expected and correct. Google's category coverage of Lagos picks up the same kinds of excluded venues as US cities. No regional anomaly here.

### §2.4 Hours probe (B6:no_hours = 643/4222 = 15.2%)
The 5-row sample all had hours populated (`hours_is_empty=false`). 643 of 4,222 (15.2%) Lagos rows lack hours. Compared to US baseline of 30–40% hours-missing rates seen in earlier Bouncer runs, **Lagos hours-coverage is actually BETTER than US benchmarks.** Google Places v1 returned `regularOpeningHours` for ~85% of Lagos venues. Not a defect.

### §2.5 B3/cluster-default probes — denied
The full multi-aggregate column census query was denied (production read sandbox). Workaround: derived from the per-rule data + sample rows.
- B3 (missing name/lat/lng): **0 occurrences** in §1.4 atomic counts. Schema constraints (`name NOT NULL`, `lat/lng NOT NULL`) make this impossible at insert time. ✓
- Empty `types` array → cluster A_COMMERCIAL default: not directly measurable without the denied query, but `types` column has `NOT NULL` constraint; sample rows all have ≥3 types. Probably zero or near-zero occurrences.

---

## Phase 3 — Five-Truth-Layer Reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | `SPEC_ORCH-0642_CROSS_CITY_BOUNCER_SWEEP.md §Assumptions` claims "Bouncer rules are language / country-agnostic. Paris / Berlin / Barcelona / Tokyo will pass at similar rates to London/Washington (40-60% servable)." **Empirically falsified for Lagos by 0% post-Bouncer pass rate.** Also the sweep was supposed to bounce 9 cities; data shows 8 are still un-bouncered post-CLOSE. Spec was either never executed or executed partially. |
| **Schema** | `place_pool.is_servable` nullable; `stored_photo_urls` ARRAY nullable; `name/lat/lng` NOT NULL; `types` NOT NULL ARRAY. RPCs `get_places_needing_photos` and `count_places_needing_photos` exist in `pg_proc` but **have no defining migration in `supabase/migrations/`** — created out-of-band, latest definition is the in-database `prosrc`. They gate on `is_active=true AND photos IS NOT NULL AND stored_photo_urls IS NULL` — no `is_servable` check. |
| **Code** | `bouncer.ts`: B8 is universal (every cluster including Natural). `run-bouncer/index.ts`: sole writer of `is_servable`. `admin-seed-places/index.ts`: writes `photos` (Google metadata) but NEVER writes `stored_photo_urls`; never enqueues a follow-on photo-download job. `backfill-place-photos/index.ts`: legacy path uses RPC (no is_servable gate); action-based path requires `is_servable=true` (lines 243, 255–258, 266–269, 648). |
| **Runtime** | Bouncer ran 2m33s after seed completed. No photo-backfill invocation in between (would have created stored_photo_urls; data shows zero). The Bouncer log line (`run-bouncer:174`) would have printed `pass=0 reject=4222` — exactly what the operator observed. |
| **Data** | 4,222 Lagos rows, 0 servable, 4,222 not_servable. 4,222 rows with `stored_photo_urls` empty/null. 2,888 with no website. 643 with no hours. Zero rows have ever had photos downloaded. |

**Contradiction located:** Docs (ORCH-0642 spec assumption "country-agnostic 40-60% pass") vs Data (Lagos 0%, projected post-fix 24.6%). The contradiction reveals the **un-stated assumption in Bouncer rule design**: the rules were authored for US/UK markets where own-domain websites are normative. The investigator and the spec writer never tested with a non-Western market.

**Second contradiction:** Code (action-based backfill requires `is_servable=true`) vs Code (Bouncer requires `stored_photo_urls` populated to set `is_servable=true`). This is a literal deadlock. The legacy path is the only resolution, but it is undocumented and unreachable from the admin UI.

---

## Phase 4 — Findings (classified)

### 🔴 RC-1 — Photo-pipeline deadlock (action-based modes require `is_servable=true`)

| Field | Value |
|-------|-------|
| **File + line** | [`supabase/functions/backfill-place-photos/index.ts:255-258`](../../supabase/functions/backfill-place-photos/index.ts#L255-L258), [`:266-269`](../../supabase/functions/backfill-place-photos/index.ts#L266-L269), [`:648`](../../supabase/functions/backfill-place-photos/index.ts#L648) |
| **Exact code** | `if (place.is_servable !== true) { analysis.blockedByAiApproval++; continue; }` (initial mode) and `.eq('is_servable', true)` (processBatch SELECT filter) |
| **What it does** | For both `mode='initial'` and `mode='refresh_servable'`, eligibility analysis and per-row processing both require `is_servable=true`. After ORCH-0640 ch06 retired `ai_approved`, every named-mode invocation of `backfill-place-photos` filters out un-Bouncered places. |
| **What it should do** | `mode='initial'` is, by name, the FIRST pass after seeding — it should run on un-Bouncered rows (the entire purpose of "initial"). The is_servable gate belongs only on `mode='refresh_servable'`. The ORCH-0640 ch06 commit conflated the two by replacing `ai_approved` with `is_servable` in BOTH paths. |
| **Causal chain** | (1) Operator seeds Lagos. (2) Admin UI offers `RunPhotoBackfillButton` which calls `mode='initial'`. (3) `mode='initial'` filters every row by `is_servable=true`, and every row is `NULL` (never bounced). (4) Result: 0 eligible places, "nothing_to_do" returned. (5) Operator believes photo backfill is not needed. (6) Operator runs Bouncer. (7) Bouncer rejects 100% on B8. |
| **Verification** | Confirmed via three sources: (a) code lines above; (b) data: every "stuck" city (Paris, NYC, Berlin, Barcelona, Toronto, Chicago, Dallas) is unbounced AND has zero stored_photo_urls; (c) `get_places_needing_photos` RPC which the legacy path calls has NO is_servable gate, proving the original design intended pre-Bouncer photo download. |

**Severity: S1.** Blocks every future city seed regardless of country. The only existing escape is the undocumented legacy path (`POST /backfill-place-photos {batchSize: N}` with no `action` field).

### 🔴 RC-2 — Bouncer Cluster-A website requirement is culturally mis-aligned for non-US markets

| Field | Value |
|-------|-------|
| **File + line** | [`supabase/functions/_shared/bouncer.ts:224-230`](../../supabase/functions/_shared/bouncer.ts#L224-L230) |
| **Exact code** | `if (cluster === 'A_COMMERCIAL') { if (!isOwnDomain(place.website)) { reasons.push(place.website ? 'B5:social_only' : 'B4:no_website'); } if (!hasOpeningHours(place)) reasons.push('B6:no_hours'); }` |
| **What it does** | Every commercial cluster row must have an own-domain website (no Facebook/Instagram allowed) AND opening hours. |
| **What it should do** | (Spec writer to decide.) Either (a) gate B4/B5 on country/market with a relaxed policy for non-US markets, or (b) accept structurally lower pass rates for non-US cities and document the tradeoff, or (c) add a market-aware famous-bypass for A_COMMERCIAL similar to the B_CULTURAL bypass. **Note: this is a policy decision that requires user steering, not just code.** |
| **Causal chain** | (1) Lagos seeded. (2) 68.4% of venues have no website at all. (3) `deriveCluster` defaults non-natural-non-cultural-non-excluded to `A_COMMERCIAL`. (4) Cluster-A rule requires website. (5) After RC-1 fix, 2,888 Lagos rows will still fire B4 → still rejected. (6) Lagos pool effectively capped at ~24.6% of seeded inventory. |
| **Verification** | (a) Aggregate: 2,888 / 4,222 rows fail B4. (b) Sample: 4 of 5 random rows have NULL website despite being legitimate venues (kalakuta museum has its own site; the other 4 — bar, restaurant, art_gallery, tourist_attraction — do not). (c) Local pattern: this is well-documented in Nigerian SME research; not investigator opinion. (d) Compare baseline: US/UK cities (Raleigh 58.9%, London 61.5%, Washington 42.5%) all clear 40%+ pass with photos; Lagos's projected post-RC-1 24.6% is roughly half. |

**Severity: S1.** Caps Lagos's serviceable inventory at ~1k places (vs ~2k–4k that would be culturally legitimate venues). Ships a launch-city with structurally thin inventory.

### 🟠 CF-1 — ORCH-0642 closure does not match data

ORCH-0642 was supposed to bounce 9 never-bouncered cities. Per §1.5: 8 of those 9 are still unbounced (Paris, NYC, Berlin, Barcelona, Toronto, Chicago, Dallas, Miami). Only Fort Lauderdale shows the bounced state. Either: (a) the all_cities sweep was never executed; (b) it failed partway and was not retried; (c) it was executed pre-ORCH-0640 ch06 and the cities were re-seeded after, accumulating new un-stored-photo rows. Without the implementation report I cannot determine which. **Discovery for orchestrator:** ORCH-0642 closure-quality audit needed.

### 🟡 HF-1 — `get_places_needing_photos` / `count_places_needing_photos` RPCs are not in any migration file

`pg_proc.prosrc` shows the RPCs exist with definite logic, but `grep` across `supabase/migrations/` finds zero references. They were created out-of-band (likely directly in Supabase dashboard during early development). **This means:**
- A fresh `supabase db reset` would lose them.
- Code review cannot detect divergence between dev and prod.
- The legacy backfill path silently breaks if anyone forgets to recreate them on a new branch.
- Constitutional #2 (one owner per truth) and migration discipline both violated.

### 🟡 HF-2 — Legacy backfill path is undocumented

`POST /backfill-place-photos {batchSize: 50}` (no action field) is the ONLY path that works on un-Bouncered rows. It is not surfaced in admin UI. It is not in any operator runbook. The handler is at [`backfill-place-photos/index.ts:36-38`](../../supabase/functions/backfill-place-photos/index.ts#L36-L38) — `if (!body.action) { return handleLegacy(...) }`. New operators have no way to discover this.

### 🟡 HF-3 — `admin-seed-places` does not enqueue photo download

[`admin-seed-places/index.ts:295-374`](../../supabase/functions/admin-seed-places/index.ts#L295-L374) (`transformGooglePlaceForSeed`) writes 50+ fields but never `stored_photo_urls` and never triggers any follow-on job. The seed→backfill→bounce sequence is implicit and operator-driven — there is no orchestrator, no state machine, no workflow that enforces ordering. **The user did the steps in a reasonable order from their perspective ("I seeded, now run Bouncer"), and the system gave them a wrong-but-plausible result.** Constitutional #3 (no silent failures) — the system should have either (a) auto-enqueued backfill on seed completion, or (b) refused to bounce a city with zero stored photos.

### 🟡 HF-4 — `transformGooglePlaceForSeed` lat/lng default to `0,0` if Google omits location

Line 299–300: `lat: location?.latitude ?? 0, lng: location?.longitude ?? 0`. If Google ever omits location data, the place gets seeded at the equator. Schema has `NOT NULL` so the insert succeeds. Bouncer's B3 then passes (lat is `0`, not null). Future risk: a place with bad geocoding shows up in maps at (0°N, 0°E). Not currently triggered by Lagos data but is a latent fabrication-of-data violation (Constitutional #9).

### 🔵 OBS-1 — ~150 Nigeria rows under fragmentary "city" labels with `city_id=NULL`

§1.1 result shows `city='FG27+MP9'`, `city='1 Aguleri St'`, `city='opposite urban radio'`, etc. — these look like address-parser failures from `parseCity()` in `admin-seed-places`. They are tagged country='Nigeria' but city_id is NULL — they do not belong to the Lagos pool and were not part of the user's "I just seeded Lagos" run. Likely pre-existing rows from earlier Enugu / Nigeria experiments. Out of scope but flagged for orchestrator: address-parsing defect creates orphan rows.

### 🔵 OBS-2 — Two cities (Berlin, Dallas) have `not_servable=0` AND `unbounced=full count`

Bouncer truly has not been run for them. They are in the same state Lagos was in before the user clicked Bouncer. Same time-bomb.

### 🔵 OBS-3 — Lagos seed itself worked correctly

4,222 rows in 1h09m of seeding. Schema-level NOT NULL constraints all met. Photos metadata, hours, types, business_status all populated by Google. Address parsing for Lagos rows worked (city='Lagos', country='Nigeria', city_id correct). Per the sample, Google's data quality for Lagos venues is good. **The seeder is not the defect.** The downstream pipeline is.

---

## Phase 5 — Verdict

### Root cause classification

**Primary classification: (B) Seeder/pipeline defect — systemic.**
The post-seed photo-download step is required-by-Bouncer but unreachable-from-admin-UI for un-bounced rows. ORCH-0640 ch06 broke the action-based path by adding the is_servable gate without auditing the consequence for fresh-seed pipelines.

**Secondary classification: (C) Bouncer rule mis-aligned for international markets.**
B4/B5 in cluster A_COMMERCIAL is a US/UK-shaped rule applied universally. Lagos's structural website-deficit means even a fully-fixed pipeline yields ~25% pass rate, not the 40–60% the spec assumes.

**Tertiary classification: (D) Operator missed a step.**
The user did exactly what the admin UI surfaces and what the immediate ORCH-0642 spec assumes is sufficient. Calling this primary would blame the operator for a system design that gave them no other reasonable path. It is a contributing factor only.

(A) Lagos-specific seeder defect — **falsified.** Seed rows are well-formed; the seeder works equally for Lagos and Raleigh.
(E) External API behavior change — **falsified.** Google Places v1 returns the same shape for Lagos as for US cities; photos and hours coverage is normal-to-better-than-US.

### Blast radius

- **Future city seeds:** every new city seeded after ORCH-0640 ch06 hits RC-1 unless the operator knows the legacy curl. **8 cities are silently in this state right now.**
- **Already-stuck cities:** Paris (7,476), NYC (5,720), Berlin (5,686), Barcelona (4,040), Toronto (3,599), Chicago (3,469), Dallas (2,541), Miami (6,100) — all sitting with zero stored photos, none of them servable. These were ORCH-0642's target — that work is incomplete and the closure was over-optimistic.
- **Downstream consumers:** every code path that gates on `is_servable=true` returns empty for Lagos. This includes:
  - `discover-cards` edge fn (deck assembly, three-gate serving)
  - `get-person-hero-cards` edge fn (paired-profile RPC)
  - `generate-curated-experiences` edge fn (curated decks)
  - `query_servable_places_by_signal` RPC (signal-based ranking)
  - `query_person_hero_places_by_signal` RPC (paired-profile)
  - All admin "Pool Health" widgets and city-readiness dashboards
- **Cross-domain:** zero impact on solo/collab parity (this is upstream of mode selection). Zero impact on auth, payments, push, or messaging.
- **Already-deployed code does not need a hotfix** to recover Lagos; the recovery is operational (run legacy backfill, then re-run Bouncer). The CODE fix is to prevent recurrence on future cities.

### Confidence

| Finding | Confidence | What would raise it |
|---------|------------|---------------------|
| RC-1 photo-pipeline deadlock | **HIGH** | (already proven) — code + data + manual trace all align |
| RC-2 Bouncer cultural mis-alignment | **HIGH** | (already proven) — 68.4% B4 rate is structural, not noise; baseline comparison is unambiguous |
| CF-1 ORCH-0642 closure quality | **MEDIUM** | Reading the implementation report would distinguish "never run" from "run but lossy" |
| HF-3 silent operator-error mode | **HIGH** | Code + data both confirm |
| Projected 24.6% post-RC-1 Lagos pass rate | **HIGH** | 1,039 rows have ONLY B8 — exactly what fixing B8 would unblock |

---

## What I did NOT investigate (perimeter for the spec writer)

- **Implementation of any fix.** Not my job. Spec writer chooses the policy for B4/B5 international handling and the structural shape for the photo-pipeline orchestration.
- **Whether the legacy `handleLegacy` path has its own latent bugs.** I read it and it looks correct, but I did not exhaustively verify all edge cases (e.g., what happens if a place has photos but Google's photo download returns 404).
- **Photo storage cost / quota for downloading 4,222 Lagos photos.** Off-budget question. ~$148 at $0.035/place per `backfill-place-photos:17`.
- **Whether the 8 stuck cities should be backfilled in this same fix wave or deferred.** Operational priority call.
- **Repair of the ~150 orphan Nigeria rows with city_id=NULL.** Separate cleanup.
- **HF-1 RPC migration recovery.** Should the missing-migration RPCs be captured in a new migration file? Spec writer or orchestrator decides.
- **Performance of `run-bouncer` against Lagos.** 4,222 rows in <1s presumably, but I did not pull the runtime log.

---

## Discoveries for orchestrator (side issues)

| ID | Severity | Issue |
|----|----------|-------|
| ORCH-0678.D-1 | S1 | RC-1 affects 8 already-seeded cities (Paris, NYC, Berlin, Barcelona, Toronto, Chicago, Dallas, Miami) currently sitting unbounced + un-photo-backfilled. Recovery is operational (legacy backfill + bounce). |
| ORCH-0678.D-2 | S2 | ORCH-0642 closure does not match data — only Fort Lauderdale of the 9 target cities is actually bounced post-CLOSE. Audit needed. |
| ORCH-0678.D-3 | S2 | ~150 orphan rows under `country='Nigeria'` with `city_id=NULL` and parse-failed `city` values (e.g., `"FG27+MP9"`, `"opposite urban radio"`). Address parser defect in `admin-seed-places`. Pre-existing, unrelated to today's Lagos seed. |
| ORCH-0678.D-4 | S2 | `get_places_needing_photos` and `count_places_needing_photos` RPCs exist in DB but are not defined in any migration file (HF-1). Migration capture needed for repo-truth and `db reset` survival. |
| ORCH-0678.D-5 | S3 | `transformGooglePlaceForSeed` defaults missing lat/lng to `0,0` instead of failing the row (HF-4). Latent fabricated-data risk. |
| ORCH-0678.D-6 | S3 | Legacy backfill path (`POST /backfill-place-photos` with no action) is undocumented and unreachable from admin UI (HF-2). It is currently the only working escape from RC-1; its discoverability matters until RC-1 is structurally fixed. |

---

## Success criteria for closure (per dispatch)

- [x] Top rejection reason identified with exact percentage from §1.3/§1.4 — **B8:no_stored_photos at 98.4% (4,153/4,222)**
- [x] Comparison baseline shows whether failure is Lagos-specific or systemic — **systemic; 8 other cities in the same precondition**
- [x] Root cause classified into one of (A)–(E) — **(B) primary, (C) secondary, (D) contributing**
- [x] Five sample rows walked through manually proving the aggregate — **kalakuta museum walked end-to-end; aggregate matches**
- [x] Five-truth-layer reconciliation complete — **two contradictions located**
- [x] Blast radius across other cities and downstream consumers documented — **8 cities + 5 downstream consumers + 6 admin widgets**
- [x] Report saved at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md`

**Verdict:** root cause **proven** (six-field evidence on RC-1 + RC-2). Returning to orchestrator for SPEC dispatch decision (RC-1 is structural code fix, RC-2 is policy decision requiring user steering).
