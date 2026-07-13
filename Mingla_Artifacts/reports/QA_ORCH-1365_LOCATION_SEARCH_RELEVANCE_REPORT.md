# QA — ORCH-1365 [location-search-relevance]

**Verdict: CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 (documented+accepted) · P3: 1 · P4: 2
**Branch:** `1365-location-search-relevance` · **Worktree:** `~/Desktop/mingla-orchs/1365-[location-search-relevance]/`
**Fix commit under test:** `ffd16a817` · **Tester commits:** `66a19ad88` (adversarial test + CI reg) · `993276216` (evidence)
**Mode:** TARGETED + SPEC-COMPLIANCE. **Deployment target:** consumer OTA (edge fn deploy is merge-gated → orchestrator-owned).

The CONDITIONAL is NOT for a defect. Zero P0/P1. It reflects that the two **UI-polish** criteria
(SC-7 scrollable list, SC-8 text-clip) are behind auth + the **I-1315 Mingla+ paywall** and I have no
Mingla+ sim account + no clean Metro for this worktree, so they are **eyeball-conditional for Seth's
device** (a deferral the dispatch itself sanctions), plus the deployed-fn end-to-end curl is
orchestrator-owned post-merge. The CORE relevance fix is **runtime-proven end-to-end**.

---

## 1. What I proved at runtime (not source-only)

**End-to-end through the ACTUAL exported edge `handler()` against LIVE Mapbox, from a non-Lagos
origin** (`Mingla_Artifacts/evidence/ORCH-1365/tester_e2e_edge_handler_live_mapbox.txt`). This
exercises the real code path: `handler` → switch → `handleSuggestPlaces` → `parseTrailingCountry` →
`buildPlaceSuggestUrl` → real fetch → normalize. Stronger than the committed forensics (which hit
Mapbox directly, bypassing the edge code).

| Query (via `suggest_places`) | Result #1 / #2 | Proves |
|---|---|---|
| `lekki` | Lekki Phase 2 (Lagos) / Lekki Phase 1 (Lagos), **no POIs** | SC-1, SC-3 |
| `lekki nigeria` | Lekki Phase 2 (Lagos) / Lekki Phase 1 (Lagos) | **SC-2 — the exact ORCH-1361 gap, fixed** |
| `lekki london` | London (Greater London, UK) | SC-6 (city not over-stripped) |
| `lekki phase` | Lekki Phase 2 (Lagos) | SC-6 (non-country word not stripped) |
| **business** `suggest` `lekki nigeria` | Lekki London **Restaurant** (POI), literal "Nigeria" places | **SC-5 — business path unchanged (POIs still resolve)** |

Emitted upstream URLs captured in the same evidence file:
`…/suggest?q=lekki&…&types=place,locality,neighborhood,region,district&country=ng&limit=8` (place, **no proximity**) vs
`…/suggest?q=lekki%20nigeria&…&limit=5` (business, filter-free, byte-identical to pre-1365).

**Client request capture** (`tester_client_request_capture.txt`) — proves **Provable-NOW #1**: the
Preferences field posts `{action:"suggest_places", query, session_token, limit:8}` with **NO
proximity key**, and business `autocompleteMapbox` still posts `{action:"suggest"}` with no proximity.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | non-Lagos "lekki" → Lekki Lagos #1, POIs absent | **PASS (proven)** | live edge handler evidence, row 1 |
| SC-2 | non-Lagos "lekki nigeria" → Lekki Lagos #1 (strip→`country=ng`) | **PASS (proven)** | live edge handler, row 2; `parseTrailingCountry("lekki nigeria")={query:"lekki",country:"ng"}` |
| SC-3 | no `feature_type=poi` for place-mode query | **PASS (proven)** | live results contain zero POIs; `types=place,locality,neighborhood,region,district` |
| SC-4 | Preferences sends no `proximity` | **PASS (proven)** | client capture (no proximity key) + emitted URL has no `&proximity=` |
| SC-5 | business `suggest` byte-identical; POIs still returned | **PASS (proven)** | T-5 byte-equals + scoped gate exit 0 + live business path returns pre-1365 POI results |
| SC-5-iOS / SC-5-Android | business apps unchanged | **PASS (source no-op)** | business wrapper omits `searchMode`→default `venue`; venue path byte-identical (no sim needed — provable no-op) |
| SC-6 | "lekki phase"/"lekki london" not over-stripped | **PASS (proven)** | live edge handler rows 3-4; T-4 |
| SC-7 / -iOS / -Android | 8 suggestions scroll; row 8 reachable | **EYEBALL-CONDITIONAL** | correct diff (`BottomSheetScrollView` injected, `maxHeight` bounds the scroll viewport, `keyboardShouldPersistTaps`/`nestedScrollEnabled`); source-structure T-9b. **Not sim-proven** — field behind Mingla+ paywall, no Plus sim account |
| SC-8 / -iOS / -Android | descenders not clipped | **EYEBALL-CONDITIONAL** | correct diff (`lineHeight:24` removed; Android `textAlignVertical:"center"`); source-structure T-9c. **Not sim-proven** — same paywall gate |
| SC-9 | free users hit I-1315 paywall; field unreachable | **PASS (source-proven)** | `isLocked={!canAccess('custom_starting_point')}` + `!useGpsLocation && !isLocked` guard preserved (diff + T-8c); paywall wiring UNTOUCHED by 1365 |
| SC-10 | pick resolves via `retrieve`, stores custom_lat/lng | **PASS (source no-op)** | `retrieve`/`handleRetrieve`/`onPickLocation` untouched (DO-NOT-TOUCH honored) |

Post-deploy (orchestrator-owned): the `suggest_places` action is NOT deployed (merge-gated). Curl-verify
`suggest_places` on the deployed fn after merge — my local run against the branch code already proves the
code is correct, so the curl is a deploy-parity check, not a code check.

---

## 3. Findings

### P2 — Country/state-name collision OVER-STRIP (DOCUMENTED + ACCEPTED; not a blocker)
- **Evidence:** live edge handler — `suggest_places "atlanta georgia"` → **HTTP 200, ZERO suggestions**
  (`tester_e2e_edge_handler_live_mapbox.txt`, last row). `parseTrailingCountry("atlanta georgia")` strips
  `georgia`→`ge` (Georgia the country), then Mapbox finds no place named "atlanta" in Georgia → empty.
  Same class (verified via probe): bare multi-word countries whose suffix is an alias-key also over-strip —
  `"great britain"→gb`, `"united arab emirates"→ae`, `"united states of america"→us`, `"dr congo"→cg`.
- **Impact:** a US user typing "City State" where the state name is also a country ("atlanta georgia",
  "savannah georgia") gets **empty results**, not the city. Real for US markets (London/US-cities/Lagos are live).
- **Why not a blocker:** documented in the implementation report §10, and the orchestrator's **OQ-1 ruling**
  scoped the country map to English names + aliases with place-disambiguation **out of scope for v1**. So it is
  an accepted, pre-declared limitation — not an unaccepted P1. The primary fix (Nigeria/London relevance) is
  unaffected and proven.
- **Required follow-on (recommend BEFORE heavy US-market reliance):** a small ambiguous-name exclusion set
  (`georgia`, and suppress suffix-alias over-strip for bare official country forms) as its own ORCH.
- **Guard added:** my adversarial suite **locks** this behavior (`ADV-A1`, `ADV-A4`) so the follow-on updates
  it knowingly and it can never silently drift.

### P3 — Diacritic country names not accent-folded (documented v1 limitation)
- `parseTrailingCountry("abidjan côte d'ivoire")` does not strip (`côte` ≠ map key `cote`). English-only v1
  per OQ-1. Locked in `ADV-A4`. Low impact.

### P4 — Praise / notes
- **Clean code-level isolation wall.** Separate action (`suggest_places`), separate builder
  (`buildPlaceSuggestUrl`), separate handler (`handleSuggestPlaces`), separate country module. `country` is
  server-derived (never client-trusted) — a business caller cannot inject a filter. Textbook.
- **Latent test-coverage gap I found + closed (not a product defect):** the scoped ORCH-1079 gate + T-5 both
  inspect only `handleSuggest`'s BODY. A one-line reroute of the **handler switch** `case "suggest": return
  handleSuggestPlaces(...)` would push business venue-name search through the place-FILTERED handler
  (regressing INV-3) while staying invisible to the gate and T-5. Proven at runtime (MUT-2 below): gate PASS,
  T-5 PASS, **my ADV-B FAIL**. Now CI-guarded.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Ran the implementor's tests myself against true line-mutations of the branch code, then restored (`git checkout`). Working tree verified clean after.

| Mutation | Test | Result | Restored |
|---|---|---|---|
| **MUT-1** `handleSuggest` calls `buildPlaceSuggestUrl` (direct reroute) | scoped ORCH-1079 gate | **exit 1 (RED)** | exit 0 |
| MUT-1 | `mapboxPlaceSuggest.orch1365.test.ts` (T-5) | **1 failed (RED)** | 8/8 |
| **MUT-4** re-add `proximity={proximity}` to the Preferences field | `orch-1365-preferences-places-no-proximity.test.tsx` (T-8) | **1 failed (RED)** | 8/8 |

Both implementor fails-on-revert claims independently reproduced. **Verified at `ffd16a817`.**

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `supabase/functions/mapbox-geocode/__tests__/orch1365-collision-and-switch-isolation.adversarial.test.ts`
  (commit `66a19ad88`; in the closing diff vs origin/main; registered in the `orch-1365-*-deno-tests` CI job).
- **Angle A** — country/state collision matrix (over-strip locked + non-country trailing-word guards +
  casing/diacritics/whitespace/never-empty invariant). **Angle B** — the switch-level isolation the gate + T-5 miss.
- **fails-on-revert PROVEN by the tester:**
  - **MUT-2** (switch reroute `case "suggest"`→`handleSuggestPlaces`): gate **PASS**, T-5 **PASS** (both miss it),
    **my ADV-B FAILED (2)** — the unique coverage. Restored → 18/18.
  - **MUT-3** (neutralize `parseTrailingCountry` strip): **my ADV-A FAILED (6)**. Restored → 18/18.
- 18/18 green standalone; full orch-1365 CI job (5 files) **50 passed / 0 failed** with my test included.

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | no new interactive control (scroll/pick unchanged behavior) |
| 2 | One owner per truth | PASS | `country` derived server-side only; single strip owner |
| 3 | No silent failures | PASS | service returns `[]` on failure = intended type-ahead fallback (documented); edge returns honest `mapbox_<status>`/`suggest_exception` codes |
| 4 | One query key per entity | N/A | no React Query change |
| 5 | Server state server-side | N/A | no Zustand/state change |
| 6 | Logout clears everything | N/A | unchanged |
| 7 | `[TRANSITIONAL]` labeled | PASS | none introduced |
| 8 | Subtract before adding | PASS | proximity effect/state removed cleanly; `enhancedLocationService` import correctly retained (still used by GPS toggle) |
| 9 | No fabricated data | PASS | results are live Mapbox; missing = empty, never faked |
| 10 | Currency-aware | N/A | |
| 11 | One auth instance | N/A | |
| 12 | Validate at right time | PASS | `<3` char guard on both handlers |
| 13 | Exclusion consistency | PASS | place-types filter isolated to consumer; business exclusion-free preserved |
| 14 | Persisted-state startup | N/A | |

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Consumer iOS | **PASS (logic) / EYEBALL-COND (UI)** | relevance proven via edge+client runtime; SC-7/SC-8 need a Mingla+ device |
| Consumer Android | **EYEBALL-COND** | shared code → logic auto-parity; the Android descender (`textAlignVertical`) + gorhom scroll delta explicitly needs a device eyeball |
| Buyer/anon Web | N/A | no location autocomplete on those routes |
| Business iOS | **PASS (byte-identical)** | default `venue` mode; SC-5 proven; provable no-op → no sim required |
| Business Android | **PASS (byte-identical)** | same |
| Admin Web | N/A | — |
| Business Web preview | N/A | — |

**Physical iPhone (HITL):** not run this session — the field is behind the I-1315 Mingla+ paywall and no
Mingla+ sim/device account was available to me. Operator-unblock ask below.

**CityPicker (SC/regression sanity):** untouched (0 diff confirmed); still uses default `venue` mode + its own
proximity (OQ-2 declined) — no runtime regression from 1365.

**Live deploy state:** `suggest_places` NOT yet deployed (merge-gated). `verify_jwt=true` preserved in
`config.toml` (unchanged). Post-deploy curl = orchestrator.

## 8. Discoveries for Orchestrator

1. **Collision over-strip → empty results for US "City State" queries** (P2 above). Recommend a follow-on ORCH
   for an ambiguous-name exclusion set (`georgia`, suffix-alias bare-country guard) before US-market lean.
2. **Diacritic non-fold** (P3) — English-only v1; register as low-priority follow-on if a user reports it.
3. **Switch-level isolation gap** (P4) — the scoped gate + T-5 are body-scoped; my ADV-B now guards the switch.
   Consider folding a switch-routing assertion into the gate itself in a future hardening pass.

## 9. Accepted conditions (CONDITIONAL PASS)

- **SC-7 / SC-8 (UI scroll + text-clip):** source-verified + unit-asserted, **runtime eyeball deferred to
  Seth's Mingla+ device** — the dispatch explicitly sanctions this deferral (field behind I-1315 paywall).
- **Deployed-fn end-to-end curl:** orchestrator-owned post-merge (deploy is merge-gated); branch code already
  runtime-proven against live Mapbox.

**Operator-unblock asks:** (1) a Mingla+ sim/device account to eyeball SC-7/SC-8; (2) confirm the P2
collision (US "atlanta georgia" → empty) is acceptable for v1 or spawn the exclusion-set follow-on.
