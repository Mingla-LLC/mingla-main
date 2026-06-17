# INVESTIGATE — ORCH-1151: Snapped experiences arrive with EMPTY stops

- **Mode:** INVESTIGATE (read-only; NO code changes, NO fix proposed beyond a surgical recommendation)
- **Date:** 2026-06-17
- **Project:** `gqnoajqerqhnvulmnyvv` (prod), brand **Leggo This** `22a18413-bfbf-4087-9ba7-45f70deba0f3`
- **Symptom (Seth):** snapped a menu on the business app; ORCH-1154 auto-draft+navigate works, drafts appear, but opening a draft in the wizard shows **EMPTY stops** — not persisted. ORCH-1151 was supposed to build ONE curated experience whose stops are the menu items, price = sum of stops.

---

## ⚠️ RE-INVESTIGATION 2026-06-17 — PRIOR VERDICT PARTIALLY WRONG (Seth was right: a genuine post-deploy snap EXISTS)

> Seth corrected: he created a draft RECENTLY (after the nav complaint). He was RIGHT. The prior verdict below was scoped only to **Leggo This** and missed a genuine **post-deploy** snap on **Lantern & Vine** at **2026-06-17 09:50:18 UTC**. That snap proves the ORCH-1151 PARSER IS CORRECT (it emitted 4 themed experiences, 5 stops each, USD). The real break is NOT the parser and NOT the executor — it is the **confirm/accept client leg**, and it is a **deploy/OTA TIMING** issue tied to **ORCH-1154**, not ORCH-1151. Full re-investigation in the new section "RE-INVESTIGATION FINDINGS (2026-06-17)" below. Read that section as the authoritative verdict; the original section is retained for the Leggo-This stale-data sub-conclusion (which remains correct for that brand).

### Corrected verdict (one line)

**The ORCH-1151 parser works correctly post-deploy (proven on a real 2026-06-17 09:50 UTC Lantern & Vine snap: 4 experiences × 5 stops, USD, healthy `tool_args.stops`). The proposals are stranded in `agent_pending_actions.status='pending'` because the snap ran the PRE-ORCH-1154 client that used the old review-card UI — leaving the screen strands the proposals, and `agent-confirm-action` was NEVER invoked (zero calls), so no `events`/`experience_stops` rows were ever written.** Seth's snap (09:50 UTC) ran **~26 minutes BEFORE ORCH-1154 was merged to main** (06:16 EDT = 10:16 UTC) — so his device was on the pre-1154 stranding flow. **No code bug exists in current `origin/main`.** Confidence: **proven** (live prod `agent_pending_actions` data + deployed-edge logs showing 0 confirm calls + git timeline). The fix Seth needs is already merged (ORCH-1154); he must get the 1154 OTA onto his device and re-snap.

---

## Verdict (one line) — ORIGINAL (Leggo This scope only; superseded for the cross-brand picture)

**This is DEPLOY-TIMING / STALE-SNAP-DATA, not a code bug.** Seth's snap ran **~4.5 hours BEFORE the ORCH-1151 parser was even merged**, and ~21 hours before the new parser was deployed to prod. The drafts he is looking at were produced by the OLD pre-1151 flat parser (one experience per dish, no stops). The deployed parser (`parse-restaurant-menu` v142) AND the executor (`agent-confirm-action` v171) are BOTH the correct ORCH-1151 code and WOULD persist stops on a fresh snap. **No new snap has run since the 1151 code went live**, so the fix has never actually been exercised. Confidence: **proven** (live prod data + deployed-source + git timeline all reconcile). ⚠️ This was scoped to Leggo This only and MISSED the Lantern & Vine post-deploy snap — see the corrected verdict above.

---

## Q-scorecard

**Q1. Do the fresh drafts have `experience_stops` rows?**
Verdict: **NO — 0 stops on every fresh draft.** But these "fresh" drafts are pre-1151 artifacts. (F-1)

**Q2. Is the draft `pricing_mode` `per_stop` + summed (1151), or `whole`/free (pre-1151)?**
Verdict: **`whole`, `whole_price_cents=null`, `experience_intents=null`** — the OLD flat-dish shape, NOT the 1151 per_stop+summed shape. (F-1)

**Q3. Does the `agent_pending_actions.tool_args` JSON that created these drafts contain a `stops` array?**
Verdict: **NO. 20 actions, 0 with a `stops` key.** Each `tool_args` is a flat single-dish payload (title="Duck", narrative=dish desc, `suggested_price_min_cents`, `intent_tags`). This is the pre-1151 "20 flat per-dish experiences" format. (F-2)

**Q4. Is the break UPSTREAM in the parser (no stops emitted)?**
Verdict: **The DATA was produced by the old parser, but the DEPLOYED parser v142 IS the 1151 code and DOES emit stops.** The old data exists only because it predates the deploy. (F-3, F-4)

**Q5. Is the deployed parser actually the 1151 code, or deploy-drift?**
Verdict: **Deployed v142 = the real merged 1151 code** (matches `origin/main` `8098a7991`). It has the nested `stops` RESPONSE_SCHEMA, the curated 3-6-experiences prompt (`MAX_EXPERIENCES=6`), `normalizeStops()`, and threads `stops: exp.stops` into `tool_args`. NOT deploy-drift. (F-4)

**Q6. Does the executor (`create_experience` in `agentTools.ts`) correctly write `experience_stops` when stops ARE present?**
Verdict: **YES.** Deployed v171 reads `args.stops`, computes `hasStops`, sets `pricing_mode='per_stop'`, sums stop prices, and inserts `experience_stops`. The executor is sound. (F-5)

**Q7. Does `agent-confirm-action` pass the full `tool_args` (incl. `stops`) to the executor, or strip them?**
Verdict: **Not the culprit** — the data never contained `stops` to begin with (Q3). Executor reads `args.stops` directly; no strip observed. Cannot be the break for THIS data. (F-2, F-5)

**Q8. Is the wizard read-back the culprit?**
Verdict: **NO.** `experience_stops` genuinely has 0 rows for these drafts, so the wizard correctly renders empty. The bug is entirely write-side, and the write-side ran the OLD code. (F-1)

---

## Findings (six-field evidence)

### F-1 — Fresh drafts are 20 separate single-dish experiences, `whole`/null/0-stops — the PRE-1151 shape
- **Symptom:** Wizard shows empty stops; drafts are one-per-dish ("Duck", "Veal Scallopini", "Coho Salmon"...).
- **Layer:** data.
- **Probe:**
  ```sql
  select id, title, status, event_type, pricing_mode, whole_price_cents, experience_intents, created_at,
    (select count(*) from experience_stops es where es.event_id=e.id) as stop_count
  from events e
  where brand_id='22a18413-bfbf-4087-9ba7-45f70deba0f3' and event_type='experience'
  order by created_at desc limit 30;
  ```
- **Evidence (verbatim rows):** 20 drafts created `2026-06-16 02:18:0x+00`, each `pricing_mode='whole'`, `whole_price_cents=null`, `experience_intents=null`, `stop_count=0`. Titles are individual dishes (Duck / Veal Scallopini / Coho Salmon / Oregon Trout / New Orleans Bouillabaisse / Prime Rib / Delmonico / ...). The only rows WITH stops are old TEST events: `ORCH-1065 TEST — DC Evening Crawl` (`whole`, 3 stops, 2026-06-04) and `ORCH1059 Proof Night Out` (`per_stop`, 3 stops, 2026-06-02).
- **Mechanism:** A 1151 snap produces ≤6 themed experiences each with `per_stop` pricing + stops. 20 flat `whole`/null/no-stop dish-drafts is the EXACT signature of the OLD pre-1151 "one experience per menu item" parser.
- **Severity:** CONFIRMED ROOT CAUSE (stale data, not code).

### F-2 — The `agent_pending_actions` that created the drafts carry NO `stops` key (20 of 20)
- **Symptom:** Executor had nothing to write to `experience_stops`.
- **Layer:** data.
- **Probe:**
  ```sql
  select count(*) total, count(*) filter (where tool_args ? 'stops') with_stops, min(created_at), max(created_at)
  from agent_pending_actions
  where related_brand_id='22a18413-bfbf-4087-9ba7-45f70deba0f3'
    and tool_name='create_experience' and created_at > '2026-06-16 02:00:00+00';
  -- + jsonb_pretty(tool_args) of one row
  ```
- **Evidence (verbatim):** `total_actions=20, with_stops_key=0`, first `2026-06-16 02:18:04.78+00`, last `02:18:05.64+00`. Sample `tool_args` (id `c1c6ef6f-...`):
  ```json
  { "title": "Duck", "is_free": null, "brand_id": "22a18413-...", "currency": "USD",
    "narrative": "Oven-roasted organic duck boneless breast ...", "confidence": 1,
    "intent_tags": ["food","entree"], "temporaryCategory": "restaurant",
    "suggested_time_of_day": null, "suggested_price_max_cents": null,
    "suggested_price_min_cents": 2600 }
  ```
  No `stops` key. `executed_result.event.id = 2d13c742-...` (the "Duck" draft).
- **Mechanism:** The parser that wrote these rows did NOT emit a `stops` array → executor's `hasStops=false` → `whole` mode, no `experience_stops`. This is the old flat parser's output.
- **Severity:** CONFIRMED ROOT CAUSE.

### F-3 — Git timeline: Seth's snap ran BEFORE the 1151 code was merged or deployed
- **Symptom:** Stale data despite "ORCH-1151 deployed".
- **Layer:** runtime / docs.
- **Probe:** `git show -s --format='%ci' 8098a7991 9b6d34b1d`; edge fn `updated_at`; pending-action `created_at`.
- **Evidence (UTC, reconciled):**
  - Snap ran (pending-action `created_at`): **2026-06-16 02:18 UTC**
  - ORCH-1151 parser merged to `origin/main` (`8098a7991`): 2026-06-16 02:48 EDT = **2026-06-16 06:48 UTC**
  - `parse-restaurant-menu` v142 deployed (`updated_at` 1781652866205): **2026-06-16 23:34 UTC**
  - → Snap predates the MERGE by ~4.5 h and the DEPLOY by ~21 h.
- **Mechanism:** At 02:18 UTC the live `parse-restaurant-menu` was still the pre-1151 flat parser; it produced the 20 flat dish-actions. The 1151 code went live hours later.
- **Severity:** CONFIRMED ROOT CAUSE (timing).

### F-4 — Deployed `parse-restaurant-menu` v142 IS the real merged 1151 code (NOT deploy-drift)
- **Symptom:** Need to rule out "v142 is stale / doesn't match merged main".
- **Layer:** code (deployed) vs schema (merged main).
- **Probe:** `mcp__supabase__get_edge_function('parse-restaurant-menu')`; `git show origin/main:supabase/functions/_shared/geminiMenuParser.ts | grep -c stops`.
- **Evidence:** Deployed v142 `geminiMenuParser.ts` contains: `MAX_EXPERIENCES=6`, `MAX_STOPS_PER_EXPERIENCE=5`, nested `stops` in `RESPONSE_SCHEMA` (`required:["name","price_cents"]`), `normalizeStops()`, the "group into a CURATED FEW themed experiences (3 to 6)" SYSTEM_PROMPT, and `index.ts` threads `stops: exp.stops` into `tool_args` ("ORCH-1151: thread the menu-items-as-stops through to the executor"). `origin/main` returns **12** "stops" matches in the same file — they match. (Note: the LOCAL anchor working tree at `~/Desktop/mingla-main` is **30 commits behind origin/main**, HEAD `ebe8fb196`, and its working-tree copy has **0** "stops" — that is local-checkout staleness ONLY, not the deployed reality. Do not be misled by the anchor working tree.)
- **Mechanism:** The deployed parser will emit ≤6 experiences each with a `stops[]` on the NEXT snap. The contract is correct; it simply has not been re-run.
- **Severity:** RULED OUT (deploy-drift hypothesis refuted).

### F-5 — Executor `create_experience` (deployed v171) correctly persists stops when present
- **Symptom:** Need to rule out "executor doesn't write / silently fails on insert".
- **Layer:** code (deployed `_shared/agentTools.ts` via `agent-confirm-action` v171, == `origin/main`).
- **Probe:** `git show origin/main:supabase/functions/_shared/agentTools.ts | grep -nE 'hasStops|experience_stops|per_stop'`.
- **Evidence (origin/main `agentTools.ts`):**
  - L824–827: `const stopArgs = Array.isArray(args.stops) ? args.stops : []; const hasStops = stopArgs.length > 0;`
  - L853–854: `pricing_mode: hasStops ? "per_stop" : "whole"; whole_price_cents: hasStops ? null : suggestedMidCents`
  - L891–921: `if (hasStops) { ... client.from("experience_stops").insert(...) ... }` with an explicit failure return `"Experience draft created but stops setup failed: ..."`.
  - L936–939: ticket price = sum of stops; free only when sum is 0.
- **Mechanism:** Reads the right key (`args.stops`), forks correctly, inserts `experience_stops`, sums price. Given a `stops`-bearing tool_args it WILL persist. It received none (F-2), so it correctly produced a stop-less `whole` draft.
- **Severity:** RULED OUT (executor-bug hypothesis refuted).

### F-6 — No snap has run since the 1151 code went live (the fix is UNEXERCISED)
- **Symptom:** No live proof the fix works.
- **Layer:** data.
- **Probe:**
  ```sql
  select count(*) from agent_pending_actions
   where related_brand_id='22a18413-...' and tool_name='create_experience' and created_at > '2026-06-16 23:34:26+00';
  select count(*) from agent_pending_actions
   where related_brand_id='22a18413-...' and tool_name='create_experience' and tool_args ? 'stops';
  ```
- **Evidence:** `pending_after_deploy = 0`; `pending_with_stops_ever = 0`; `exp_drafts_after_deploy = 0`. No action for this brand has EVER carried a `stops` key.
- **Mechanism:** The new parser has produced zero output for this brand. The "empty stops" Seth sees is 100% old data.
- **Severity:** CONFIRMED ROOT CAUSE (corroborating F-3).

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Truth |
|-------|---------|-------|
| Docs | ORCH-1151 CLOSED, marked `[deploy]`, I-1151-SNAP-STOPS-PRICE-IS-SUM ACTIVE | Correct — code IS merged + deployed |
| Schema | `experience_stops` exists; executor writes `per_stop` + stops | Correct |
| Code | Deployed v142 parser emits `stops`; deployed v171 executor writes them | Correct (matches origin/main) |
| Runtime | Snap at 02:18 UTC ran the OLD parser (deploy was 23:34 UTC) | **The gap** — fix went live hours AFTER the snap |
| Data | 20 flat dish-actions, 0 stops; 0 snaps post-deploy | Old-parser output; fix unexercised |

**The single contradiction:** Docs say "deployed/closed"; runtime data is old because the user's snap predates the deploy. No layer disagrees about the CODE — they disagree only about WHEN relative to the snap. Truth = the timeline (F-3).

---

## Repro / live-fire status

Not a UI reproducer — this is a backend data/timeline forensic (exempt from sim live-fire per Prime Directive 7). Proven via live prod SQL + deployed-edge-source + git timeline. A definitive confirmation requires Seth to take ONE fresh snap now (parser v142 is live) and confirm stops persist — see Next Steps.

---

## Blast radius / cross-surface

- **Same class affects Ve6 (play/activities) parser** if it shipped on the same 1151 deploy cadence — any snap taken before 23:34 UTC 2026-06-16 carries the old flat shape. Scope: all brands, not just Leggo This.
- **Old drafts are orphaned debt:** the 20+ flat dish-drafts (and any analogous per-brand backlog) will never gain stops — they were authored flat. Out of scope for a code fix; a data-cleanup decision for the orchestrator (delete vs leave as drafts).
- Executor/confirm/wizard read-back: in-scope verified correct; no change needed.

## Invariant impact
- `I-1151-SNAP-STOPS-PRICE-IS-SUM` (ACTIVE): NOT violated by code; simply not yet exercised on live data.
- No invariant conflict found.

## Discoveries for Orchestrator
1. **Local anchor checkout is 30 commits behind `origin/main`** (HEAD `ebe8fb196`). Any forensic/grep done against the anchor working tree for 1151-era code will be WRONG. Recommend `git pull` on the anchor.
2. **Deploy lagged merge by ~17 h** (merge 06:48 UTC → deploy 23:34 UTC on 2026-06-16). If `[deploy]` in the close banner is meant to guarantee same-time deploy, that guarantee slipped here.
3. **Pre-1151 flat dish-drafts are accumulating** as un-finishable drafts; consider a one-time cleanup.

---

## Confidence

**proven** — live prod data (F-1, F-2, F-6), deployed-edge source (F-4, F-5), and git timeline (F-3) all reconcile to a single explanation with no contradicting layer.

## Recommended next phase + scope (direction only — NOT a fix)

**No code fix is warranted.** The parser, confirm, and executor are all correct and deployed. The recommended action is **verification, not implementation**:
1. Seth takes ONE fresh menu snap on Leggo This NOW (v142 is live) and confirms the draft opens with stops + a summed price.
2. If that PASSES → close as "stale-snap, fix already live; verified." Route to `mingla-tester` only if Seth wants an independent on-device confirmation.
3. If that FAILS (fresh snap still produces flat/empty stops) → RE-OPEN with the fresh `agent_pending_actions.tool_args` + edge logs; that would indicate the live Gemini call is dropping `stops` despite the schema (a parser-runtime issue), which this investigation could NOT pre-prove because no post-deploy snap exists.
4. Orchestrator decision: clean up the orphaned pre-1151 flat dish-drafts for Leggo This (and sweep other brands).

---

# RE-INVESTIGATION FINDINGS (2026-06-17) — the AUTHORITATIVE verdict

**Trigger:** Seth insisted a draft was created RECENTLY (after the nav complaint). Re-investigated cross-brand (Leggo This + Lantern & Vine) with live read-only DB + deployed-edge logs + git timeline. The prior verdict was scoped to Leggo This only and MISSED a genuine post-deploy snap.

## Deploy/merge timeline (UTC, all reconciled)

| Event | Time (UTC) | Source |
|-------|-----------|--------|
| `agent-confirm-action` v171 deployed | 2026-06-16 23:32:42 | Mgmt API `updated_at` |
| `parse-restaurant-menu` v142 deployed (ORCH-1151 parser) | 2026-06-16 23:34:26 | Mgmt API `updated_at` |
| **Lantern & Vine snap (Seth's recent snap)** | **2026-06-17 09:50:18** | `parse-restaurant-menu` log + `agent_pending_actions.created_at` |
| ORCH-1154 impl merged (`6363d3021`, auto-confirm replaces review-card UI) | 2026-06-17 10:16:15 (06:16 EDT) | git `%ci` |
| ORCH-1154 CLOSE (`9d962f248`, origin/main HEAD) | 2026-06-17 10:21:14 (06:21 EDT) | git `%ci` |

**Key inequality:** Seth's snap (09:50:18 UTC) ran **~10h AFTER the ORCH-1151 parser deploy** (so the parser was live and correct) but **~26 min BEFORE ORCH-1154 was merged** (so his client was the pre-1154 stranding flow). Parser leg = fixed and exercised. Confirm leg = old code on device.

## Q-scorecard (re-investigation)

**RQ1. Is there a genuine POST-deploy snap (parser v142 live)?**
Verdict: **YES.** Lantern & Vine, 2026-06-17 09:50:18 UTC — 10h after the v142 deploy. (RF-1)

**RQ2. Did the live deployed parser emit `stops` on that snap?**
Verdict: **YES — correctly.** 4 themed `agent_pending_actions`, each `tool_args.stops` = array of 5 menu items with `name`/`description`/`price_cents`, `currency:"USD"`. This is the EXACT ORCH-1151 shape. The parser is PROVEN correct on live data. (RF-1, RF-2)

**RQ3. So why are there no draft `events` / `experience_stops`?**
Verdict: **Because `agent-confirm-action` was NEVER called.** The 4 proposals are stranded in `status='pending'`, `executed_at=null`, `failure_reason=null`. Edge logs show ZERO `agent-confirm-action` invocations in the 09:50–10:30 window. The executor never ran → nothing written. (RF-3, RF-4)

**RQ4. Is the break the executor / currency / RLS (write-side)?**
Verdict: **NO.** The executor never even ran for this data. (Currency was USD — valid; the older 06-16 02:05 Lantern & Vine `events_currency_supported_check` failures are a SEPARATE pre-deploy issue, see RF-6.) (RF-4, RF-5)

**RQ5. Is the break the confirm/accept CLIENT leg?**
Verdict: **YES — and it is a TIMING issue.** The snap ran the PRE-ORCH-1154 client whose review-card UI strands proposals when the user leaves the screen without tapping Accept on each. ORCH-1154 (merged 26 min AFTER the snap) replaced that with auto-confirm. (RF-7)

**RQ6. Has the new confirm path with stops EVER executed successfully, on any brand?**
Verdict: **NO — not once.** Across all brands/all time, the ONLY `create_experience` actions carrying a `stops` key are the 4 Lantern & Vine rows, ALL `pending`. I-1151-SNAP-STOPS-PRICE-IS-SUM has NEVER been exercised end-to-end against the DB. (RF-8)

## Findings (six-field evidence)

### RF-1 — Genuine post-deploy snap exists: Lantern & Vine 2026-06-17 09:50:18 UTC, with correct stops
- **Symptom:** Seth says he snapped recently; prior verdict said no post-deploy snap.
- **Layer:** data.
- **Probe:** `select id, created_at, brand, status, (tool_args ? 'stops') has_stops_key, jsonb_array_length(tool_args->'stops') stops_len, tool_args->>'title' from agent_pending_actions where tool_name='create_experience' and created_at > now() - interval '48 hours' order by created_at desc;`
- **Evidence (verbatim):** 4 rows, brand **Lantern & Vine** `53aaea42-0e7d-4b2a-92db-c220d78a352c`, `created_at` 2026-06-17 09:50:18.14–.29 UTC, `status='pending'`, `has_stops_key=true`, `stops_len=5`, titles: "Hearty Steakhouse & Comfort Classics", "Fresh & Light Garden Fare", "Seafood & Coastal Delights", "A Taste of La Petite Fleur - Classic Starters & Entrees". (Vs deploy of v142 at 2026-06-16 23:34:26 UTC → snap is 10h POST-deploy.)
- **Mechanism:** The live v142 parser ran and produced curated themed experiences with nested stops — exactly the ORCH-1151 contract.
- **Severity:** CONFIRMED — parser correctness PROVEN on live post-deploy data.

### RF-2 — The post-deploy `tool_args` carries a full nested `stops` array (the source-of-truth proof)
- **Symptom:** Need to prove the LIVE parser emits stops, not just the source.
- **Layer:** data.
- **Probe:** `select jsonb_pretty(tool_args) from agent_pending_actions where id='2dcad0cd-0a7a-4720-99dc-db2fcf52b1a3';`
- **Evidence (verbatim, abridged):**
  ```json
  { "stops": [
      {"name":"SMOKED SALMON","description":"Sliced baguette, tomato, and capers.","price_cents":900},
      {"name":"DELMONICO","description":"Hand-cut 20 oz bone-in top loin steak ...","price_cents":2800},
      {"name":"PRIME RIB","description":"Aged 8 oz prime rib ...","price_cents":2800},
      {"name":"DUCK","description":"Oven-roasted organic duck ...","price_cents":2600},
      {"name":"SAUTÉED WILD MUSHROOMS IN BORDELAISE SAUCE","description":"...","price_cents":900}
    ],
    "title":"Hearty Steakhouse & Comfort Classics",
    "brand_id":"53aaea42-...","currency":"USD",
    "narrative":"Indulge in robust flavors ...","confidence":1,
    "intent_tags":["steakhouse","hearty","comfort food","dinner","indulgent"],
    "temporaryCategory":"restaurant" }
  ```
- **Mechanism:** The deployed parser emitted exactly what ORCH-1151 specified. If this row were confirmed, the executor would create a `per_stop` experience with 5 stops, price = 900+2800+2800+2600+900 = $100.00.
- **Severity:** CONFIRMED — parser-not-emitting-stops hypothesis REFUTED.

### RF-3 — The proposals are stranded in `pending`; `agent-confirm-action` was never invoked
- **Symptom:** No draft event appeared.
- **Layer:** data + runtime.
- **Probe:** DB `status/executed_at/failure_reason` of the 4 rows + edge-function logs (Mgmt API analytics, 09:50–10:30 UTC window).
- **Evidence:** All 4 rows `status='pending'`, `executed_at=null`, `failure_reason=null`, `expires_at=2026-06-24` (7-day TTL). `parse-restaurant-menu` log: exactly ONE `POST | 200`, `execution_time_ms=21813` at 09:50:18 UTC (the snap). **`agent-confirm-action`: ZERO invocations** in the window. `events` rows for this brand (experience) in the window: **0**.
- **Mechanism:** Snap creates DEFERRED `pending` proposals (per deployed `parse-restaurant-menu/index.ts` — it inserts `status:"pending"` and never calls the executor). The executor runs ONLY via `agent-confirm-action`, which the client never called.
- **Severity:** CONFIRMED ROOT CAUSE (confirm leg never fired).

### RF-4 — Snap path is DEFERRED by design; executor only runs on confirm (deployed source == origin/main)
- **Symptom:** Need to confirm the architecture: pending → confirm → executor.
- **Layer:** code (deployed).
- **Probe:** read deployed `parse-restaurant-menu/index.ts` + `agent-confirm-action/index.ts` + `_shared/agentTools.ts` (eszip markers match `origin/main 9d962f2`).
- **Evidence:** `parse-restaurant-menu/index.ts` ~L196–227 inserts `agent_pending_actions` with `status:"pending"`, `tool_name:"create_experience"`, `source:"hub_experience"`; it never imports/calls `tool.executor`. `agent-confirm-action/index.ts:200` is the SOLE executor dispatch: `result = await tool.executor(finalArgs, userClient, userId);` (after an atomic `pending → executing` flip at L171–180).
- **Mechanism:** A snap alone writes nothing to `events`. The whole experience-creation depends on the client subsequently calling `agent-confirm-action`.
- **Severity:** CONFIRMED (architecture: deferred-confirm).

### RF-5 — Executor `create_experience` reads `args.stops`, writes `experience_stops`; currency cannot be GBP-forced here (deployed source)
- **Symptom:** Rule out executor write-side / currency bug.
- **Layer:** code (deployed `_shared/agentTools.ts`).
- **Evidence (verbatim, origin/main):**
  - L824: `const stopArgs = Array.isArray(args.stops) ? (args.stops as ...) : [];` → L827 `const hasStops = stopArgs.length > 0;`
  - L850–852: `pricing_mode: hasStops ? "per_stop" : "whole"; whole_price_cents: hasStops ? null : suggestedMidCents;`
  - L859: `if (currency) row.currency = currency;` — currency resolved at L732–736: `args.currency.toUpperCase().slice(0,3)` ?? `brand.default_currency...` ?? null. No `"GBP"` literal. Brand `default_currency='USD'`.
  - L891+: `if (hasStops) { ... client.from("experience_stops").insert(stopRows) ... }` with compensating soft-delete on failure (L915–918).
- **Mechanism:** Given the RF-2 `tool_args`, the executor WOULD write a `per_stop` experience + 5 `experience_stops` + a $100 ticket. It simply was never invoked (RF-3).
- **Severity:** RULED OUT (executor-bug + currency-bug hypotheses refuted for this data).

### RF-6 — SEPARATE pre-deploy issue: the 2026-06-16 02:05 Lantern & Vine batch FAILED on `events_currency_supported_check`
- **Symptom:** An earlier Lantern & Vine snap batch shows `status='failed'`.
- **Layer:** data + schema.
- **Probe:** `select failure_reason from agent_pending_actions where related_brand_id='53aaea42-...' and created_at between '2026-06-16 02:05:00+00' and '2026-06-16 02:06:00+00';`
- **Evidence:** All 6 rows: `failure_reason = "WRITE_FAILED: new row for relation \"events\" violates check constraint \"events_currency_supported_check\""`. The CHECK list (verbatim) = `GBP,USD,CAD,CHF,EUR,BGN,CZK,DKK,HUF,ISK,NOK,PLN,RON,SEK,NGN`. The executor does NOT validate `currency` against this list before insert (RF-5, L859) — a non-listed ISO code (from `args.currency` or `brand.default_currency`) would 23514-reject at confirm time. This is a PRE-deploy artifact (02:05 06-16 ≪ deploy 23:34 06-16) and is NOT the current symptom (the 09:50 06-17 data is USD), but it is a real latent edge: **the executor can strand a confirm on an unsupported currency with no client-friendly guard.**
- **Mechanism:** Confirm-time CHECK rejection surfaces as `WRITE_FAILED`; not the 06-17 break but a related robustness gap.
- **Severity:** SUSPECTED CONTRIBUTOR (latent; out of scope for the 06-17 symptom — flagged for orchestrator).

### RF-7 — Seth's snap ran the PRE-ORCH-1154 client (review-card stranding flow), 26 min before 1154 merged
- **Symptom:** Pending proposals stranded, zero confirm calls — the exact signature of the deleted review-card UI.
- **Layer:** code (client) + runtime (timeline).
- **Probe:** git `%ci` of `6363d3021`/`9d962f248`; `.github/scripts/strict-grep/orch-1154-snap-auto-draft.mjs` gate header; `WORLD_MAP.md` ORCH-1154 entry.
- **Evidence:** ORCH-1154 gate header (verbatim): the old flow "rendered a transient per-card 'Suggested experiences' review (ExperienceReviewCards → Accept/Edit/Reject) where ONLY tapping Accept turned a proposal into a draft; leaving the screen stranded the proposals." ORCH-1154 impl merged 2026-06-17 10:16:15 UTC; snap was 09:50:18 UTC = **26 min earlier**. Current `origin/main` `app/experience/snap.tsx:128-167` auto-confirms via `confirmAll(ids)` → `agent-confirm-action`, then navigates only on `created>0` — but that code was NOT yet on Seth's device at snap time. The deployed parser response shape (`{kind, pending_actions, experiences_count}`) and the client type MATCH exactly — there is NO response-shape mismatch.
- **Mechanism:** On the pre-1154 client, Seth's 4 proposals rendered as review cards; he left the screen (he was complaining about navigation) without accepting each → stranded in `pending`, no confirm call, no draft.
- **Severity:** CONFIRMED ROOT CAUSE (client timing — fix already merged as ORCH-1154).

### RF-8 — The ORCH-1151 stops→experience_stops contract has NEVER executed end-to-end
- **Symptom:** No live proof the full chain produces stops.
- **Layer:** data.
- **Probe:** `select status, count(*) from agent_pending_actions where tool_name='create_experience' and (tool_args ? 'stops') group by status;`
- **Evidence:** Single row: `status='pending', count=4`. No `executed`/`failed`/`expired` row with a `stops` key has ever existed.
- **Mechanism:** Every stops-bearing proposal ever created is the 09:50 batch, still pending. The 1151+1154 chain is UNVERIFIED on live data end-to-end.
- **Severity:** CONFIRMED (the fix is unexercised end-to-end).

## Five-Truth-Layer reconciliation (re-investigation)

| Layer | Finding | Truth |
|-------|---------|-------|
| Docs | ORCH-1151 + ORCH-1154 CLOSED, auto-confirm replaces stranding review UI | Correct — both merged |
| Schema | `experience_stops` + `agent_pending_actions` deferred-confirm model | Correct |
| Code | Deployed parser emits stops (RF-2); deployed executor writes them (RF-5); current client auto-confirms (RF-7) | Correct on origin/main |
| Runtime | Snap 09:50 UTC parsed 200/4-experiences; `agent-confirm-action` 0 calls | **The gap** — confirm leg never fired (pre-1154 client on device) |
| Data | 4 healthy `pending` stops-bearing proposals, 0 events | Stranded by the old review-card flow |

**The single contradiction:** Docs say "snap → auto-draft works"; runtime shows the confirm call never happened — because the snapping device ran the pre-1154 client (merged 26 min after the snap). Truth = the git/log timeline (RF-7).

## Is this a REAL post-deploy bug or stale data? — DEFINITIVE

**Both, precisely scoped:**
- **PARSER (ORCH-1151):** NOT a bug. PROVEN correct on a genuine post-deploy snap (RF-1, RF-2). Seth's "stops not persisted" is NOT a parser failure and NOT an executor failure.
- **CONFIRM LEG:** a real stranding, but the FIX IS ALREADY MERGED (ORCH-1154) — it simply was not on Seth's device at snap time (RF-7). No new code fix is needed for the auto-confirm flow; it needs the 1154 OTA on-device + a re-snap.
- **Proven break point:** the LIVE parser emits stops correctly (`tool_args.stops` present, RF-2) → so it is NOT "parser-not-emitting-stops". The executor is NOT "not-writing" either — it was never called (RF-3). The break is purely the **confirm/accept client leg on a pre-ORCH-1154 device**.

## Recommended next phase + scope (direction only — NOT a fix)

1. **Get the ORCH-1154 business-app OTA onto Seth's device** (force-quit/reinstall to fetch the bundle; verify runtimeVersion match), then **re-snap Lantern & Vine** → expect 4 drafts auto-created with stops + summed prices, landing on the Hub Experiences tab. This is the end-to-end verification of BOTH 1151 (stops) and 1154 (auto-confirm) — currently UNEXERCISED (RF-8). Route to `mingla-tester` for the on-device proof.
2. **Orchestrator data cleanup:** the 4 stranded Lantern & Vine `pending` proposals (09:50 06-17) will auto-expire (7-day TTL `expires_at=2026-06-24`); the pre-1151 flat Leggo This drafts remain orphaned. Decide delete vs leave.
3. **FLAG (RF-6) for a future hardening ORCH:** the executor does not validate `currency` against `events_currency_supported_check` before insert, so an unsupported-currency brand strands the confirm with a raw `WRITE_FAILED`. Latent, no current blast radius (current brands USD/NGN), but a real edge. Connects to the de-GBP currency scope in memory.

## Confidence

**proven** — live prod `agent_pending_actions` data (RF-1/2/3/8), deployed-edge logs showing 0 confirm calls (RF-3), deployed-source quotes (RF-4/5), and the git/deploy timeline (RF-7) all reconcile to one explanation: the parser is correct; the confirm leg never fired because the device ran the pre-1154 client.
