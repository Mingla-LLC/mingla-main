# SPEC — ORCH-0735: Bouncer fast-food + chain + cheap-snack exclusion (Path A code-constant approach)

**Status:** BINDING
**Date:** 2026-05-05
**Author:** mingla-forensics (SPEC mode)
**Severity:** S1-high (production rerank blocker; ORCH-0734 CLOSE gates on this)
**Parent dispatch:** [`prompts/SPEC_ORCH-0735_BOUNCER_CHAIN_FAST_FOOD_RULES.md`](../prompts/SPEC_ORCH-0735_BOUNCER_CHAIN_FAST_FOOD_RULES.md)
**Parent investigation:** [`reports/INVESTIGATION_ORCH-0735_BOUNCER_CHAIN_GAP.md`](../reports/INVESTIGATION_ORCH-0735_BOUNCER_CHAIN_GAP.md) (REVIEW APPROVED)
**Operator-review interim deliverable:** [`specs/SPEC_ORCH-0735_INTERIM_OPERATOR_REVIEW_CHAIN_LIST.md`](SPEC_ORCH-0735_INTERIM_OPERATOR_REVIEW_CHAIN_LIST.md) (operator markup 2026-05-05 — locked)

---

## 1. Layman summary

Replaces the bouncer's quiet failure on fast-food and chain restaurants with three explicit deterministic rules (B10/B11/B12) backed by 4 code-constant lists. New module `bouncerChainRules.ts` houses ~120 fast-food/snack/coffee chain patterns + ~31 casual chain patterns + ~34 upscale chain allowlist + 5 primary-type blocklist. `bounce()` gains B10 (type), B11 (fast-food/snack name), B12 (casual chain name with allowlist bypass). Implementor adds 40+ test fixtures including explicit Cava + Le Pain Quotidien admit cases (operator-flagged regression guards). Re-bounce sweep runs through `run-bouncer` after deploy to clean ~600-1000 existing servable chains. Stranded rules-engine database tables remain untouched — ORCH-0736 decommissions them ~1 week post-CLOSE.

---

## 2. Locked operator decisions (BINDING)

### 2.1 From parent dispatch (D-1 through D-10) — verbatim

| ID | Decision |
|---|---|
| D-1 | Path A — code-constants in `supabase/functions/_shared/bouncer.ts`. NOT wire DB consumer. |
| D-2 | Coffee chains EXCLUDE entirely (Starbucks, Dunkin', Tim Hortons, Costa, Pret a Manger, Greggs, Krispy Kreme). |
| D-3 | Full-service casual chains EXCLUDE (NEW rule_set name `CASUAL_CHAIN_BLACKLIST`). |
| D-4 | Pizza-chain matching word-boundary regex; independent pizzerias survive. |
| D-5 | Operator-review step before SPEC LOCK ✅ COMPLETED 2026-05-05. |
| D-6 | Mid-tier chains BLANKET-EXCLUDE for v1; UPSCALE_CHAIN_ALLOWLIST absorbs upscale exceptions. |
| D-7 | Cheap snack shops scope: primary_types (`snack_bar`, `food_court`, `cafeteria`, `convenience_store`) + chain patterns (pretzel kiosks, cookies, cinnabon, yogurt, bagels, hot dogs). |
| D-8 | DO NOT blanket-exclude `bakery` / `ice_cream_shop` / `donut_shop` primary_types — independents survive. |
| D-9 | Decommission sequenced (NOT bundled). ORCH-0736 handles rule_sets cleanup ~1 week later. |
| D-10 | Re-bounce sweep IN scope for ORCH-0735. |

### 2.2 From operator markup (post-D-5 review, locked 2026-05-05)

| ID | Decision |
|---|---|
| **D-11** | **Lagos chains all 5 ADDED to FAST_FOOD_NAME_PATTERNS:** `chicken republic`, `mr bigg's`, `tantalizers`, `sweet sensation`, `the place`. |
| **D-12** | **9 borderline-upscale chains → UPSCALE_CHAIN_ALLOWLIST:** Cote / Cote Brasserie, Hawksmoor, Cipriani, Carbone, Gordon Ramsay restaurants, The Ivy, J. Alexander's, Houston's / Hillstone, Daniel Boulud / DB Bistro. |
| **D-13** | **Cava REMOVED** from FAST_FOOD_NAME_PATTERNS. The existing DB rule entry `cava ` (trailing space) does NOT propagate to the code-constant list. Cava admitted via default bouncer rules. |
| **D-14** | **Le Pain Quotidien NOT ADDED** to FAST_FOOD_NAME_PATTERNS. Admitted via default bouncer rules. |
| **D-15** | **Default-accept on all other proposed entries** — all remaining 121 entries from interim deliverable §B/§C/§D/§E/§F/§G/§H/§I/§J/§K ship as proposed. |

If implementor finds any contradiction with D-1..D-15 during code-write, STOP and surface to orchestrator BEFORE deviating.

---

## 3. Scope, non-goals, assumptions

### 3.1 In scope (binding)

1. **NEW file:** `supabase/functions/_shared/bouncerChainRules.ts` containing all 4 code-constant lists (full content per §6.B).
2. **MOD:** `supabase/functions/_shared/bouncer.ts` — add B10/B11/B12 rules + helper functions; import from `bouncerChainRules.ts`.
3. **MOD:** `supabase/functions/run-bouncer/index.ts` — add `re_bounce_all_servable` action with `{city_id?: uuid, batch_size?: number}` body.
4. **MOD:** `supabase/functions/_shared/__tests__/bouncer.test.ts` — add 40+ test fixtures (positive + negative + regression guards for D-13 / D-14).
5. **NO migration** — re-bounce mechanism is edge-fn driven, not schema-changing.
6. NEW invariant `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS` declared (orchestrator ratifies at CLOSE per Step 5e).
7. NEW memory file `feedback_bouncer_chain_rules_in_code.md` pre-written DRAFT during implementation, flipped ACTIVE at CLOSE.

### 3.2 Non-goals (explicit)

1. **No DB schema changes.** No drops on `rule_sets` / `rule_set_versions` / `rule_entries` / sibling tables. Those orphan-data tables remain untouched. ORCH-0736 handles them.
2. **No admin UI changes.** The rule-editor admin page (if exists) remains decoupled. ORCH-0736 retires.
3. **No signal scorer changes.** `types_includes_fast_food_restaurant: -40` in `scorer.test.ts` remains. Out of scope.
4. **No category mapping changes.** `categoryPlaceTypes.ts` and `seedingCategories.ts` chain-related entries remain. Out of scope.
5. **No CI strict-grep workflow.** Post-deploy SQL probe documented in §11; the GitHub Action gate (per existing 17b registry pattern) is deferred to a separate ORCH.
6. **No mobile changes.** Zero mobile files touched.
7. **No bouncer cluster restructure.** B10/B11/B12 are added rules; existing A_COMMERCIAL / B_CULTURAL / C_NATURAL / EXCLUDED clusters stay as-is.
8. **No Path B wiring.** Operator chose Path A. Don't propose alternative architecture.

### 3.3 Assumptions

1. `bouncer.ts` rules execute in CPU-constant time (existing pattern). Adding ~120 regex matches per place is acceptable — bouncer runs at place-write time, not per-request.
2. Chain-name regex matching is case-insensitive (per existing `CHILD_VENUE_NAME_PATTERNS` `'i'` flag).
3. Re-bounce sweep is operator-triggered (admin button or curl) NOT auto-fired on deploy.
4. `I-BOUNCER-DETERMINISTIC` is preserved (no AI judgment in B10/B11/B12; pure type+regex matching).
5. `I-TWO-PASS-BOUNCER-RULE-PARITY` is preserved (B10/B11/B12 fire identically in both pre-photo and final passes; no photo dependency).
6. `bouncerChainRules.ts` will be imported by both `bouncer.ts` and the test file.

---

## 4. Database layer

**No migration in this SPEC.** Re-bounce sweep is an edge-fn invocation.

---

## 5. Module layer (`bouncerChainRules.ts` — NEW)

**Path:** `supabase/functions/_shared/bouncerChainRules.ts`

**Header comment block (verbatim):**
```ts
// ORCH-0735 — bouncer chain/fast-food/snack rules.
//
// Code-constant lists for B10/B11/B12 bouncer rules. Path A (per DEC-107):
// these lists are the canonical source of truth; the parallel rule_sets
// database tables (FAST_FOOD_BLACKLIST + UPSCALE_CHAIN_PROTECTION + sibling
// rule_sets) are decoupled and scheduled for decommission per ORCH-0736
// (~1 week post-ORCH-0735 CLOSE). DO NOT add a runtime loader that reads
// from rule_sets — that would re-introduce the very stranded-DB pattern
// ORCH-0735 fixes.
//
// Adding a new chain: open a code PR adding to the appropriate array below,
// add a corresponding test fixture in __tests__/bouncer.test.ts, deploy.
//
// Operator-review trail: every entry below was confirmed in the interim
// review at specs/SPEC_ORCH-0735_INTERIM_OPERATOR_REVIEW_CHAIN_LIST.md
// (locked 2026-05-05). Cova and Le Pain Quotidien are explicitly admitted
// (D-13/D-14); regression guards in test fixtures prevent re-blacklisting.
//
// I-BOUNCER-DETERMINISTIC preserved: pure type/regex matching, no AI.
// I-TWO-PASS-BOUNCER-RULE-PARITY preserved: applies identically in both
// pre-photo and final passes.
```

### 5.1 `EXCLUDED_FAST_FOOD_TYPES` (B10 type-blocklist) — 5 entries

```ts
export const EXCLUDED_FAST_FOOD_TYPES: ReadonlyArray<string> = [
  'fast_food_restaurant',  // Generic fast food (when properly tagged by Google)
  'snack_bar',              // Cheap snack shops (per D-7)
  'food_court',             // Mall food courts (per D-7)
  'cafeteria',              // Institutional cafeterias (per D-7)
  'convenience_store',      // 7-Eleven / Wawa / Sheetz (per D-7)
];
```

### 5.2 `FAST_FOOD_NAME_PATTERNS` (B11 fast-food / snack / coffee) — ~120 entries

Implementor builds the array in regional groupings, each with a `label` for the rejection reason. Use case-insensitive substring matching with word-boundary semantics where collision risk exists. Verbatim entry list:

```ts
const FF_PATTERN = (substr: string, label: string) => ({
  pattern: new RegExp(`\\b${substr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
  label,
});

export const FAST_FOOD_NAME_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // ── B.1 — US/global fast food (existing FAST_FOOD_BLACKLIST minus Cava per D-13) ────
  FF_PATTERN("mcdonald",          'mcdonalds'),
  FF_PATTERN("burger king",       'burger_king'),
  FF_PATTERN("kfc",               'kfc'),
  FF_PATTERN("kentucky fried",    'kentucky_fried'),
  FF_PATTERN("wendy's",           'wendys'),
  FF_PATTERN("subway",            'subway'),
  FF_PATTERN("taco bell",         'taco_bell'),
  FF_PATTERN("chick-fil-a",       'chick_fil_a'),
  FF_PATTERN("five guys",         'five_guys'),
  FF_PATTERN("popeyes",           'popeyes'),
  FF_PATTERN("panda express",     'panda_express'),
  FF_PATTERN("domino's",          'dominos'),
  FF_PATTERN("papa john",         'papa_johns'),
  FF_PATTERN("pizza hut",         'pizza_hut'),
  FF_PATTERN("little caesar",     'little_caesars'),
  FF_PATTERN("sonic drive",       'sonic_drive_in'),
  FF_PATTERN("jack in the box",   'jack_in_the_box'),
  FF_PATTERN("arby's",            'arbys'),
  FF_PATTERN("carl's jr",         'carls_jr'),
  FF_PATTERN("hardee",            'hardees'),
  FF_PATTERN("del taco",          'del_taco'),
  FF_PATTERN("raising cane",      'raising_canes'),
  FF_PATTERN("whataburger",       'whataburger'),
  FF_PATTERN("in-n-out",          'in_n_out'),
  FF_PATTERN("wingstop",          'wingstop'),
  FF_PATTERN("chipotle",          'chipotle'),
  FF_PATTERN("shake shack",       'shake_shack'),
  FF_PATTERN("checkers",          'checkers'),
  FF_PATTERN("rally's",           'rallys'),
  FF_PATTERN("church's chicken",  'churchs_chicken'),
  FF_PATTERN("el pollo loco",     'el_pollo_loco'),
  FF_PATTERN("golden corral",     'golden_corral'),
  FF_PATTERN("bojangles",         'bojangles'),
  FF_PATTERN("cook out",          'cook_out'),
  FF_PATTERN("zaxby",             'zaxbys'),
  FF_PATTERN("panera bread",      'panera_bread'),
  FF_PATTERN("jersey mike",       'jersey_mikes'),
  FF_PATTERN("jimmy john",        'jimmy_johns'),
  FF_PATTERN("firehouse sub",     'firehouse_subs'),
  FF_PATTERN("qdoba",             'qdoba'),
  FF_PATTERN("potbelly",          'potbelly'),
  FF_PATTERN("sweetgreen",        'sweetgreen'),
  FF_PATTERN("tropical smoothie", 'tropical_smoothie'),
  FF_PATTERN("moe's southwest",   'moes_southwest'),
  // [D-13: cava REMOVED — explicit operator admit. Regression test T-CAVA-ADMIT.]

  // ── B.2 — Coffee / cafe chains (per D-2) ────────────────────────────────
  FF_PATTERN("starbucks",         'starbucks'),
  FF_PATTERN("dunkin",            'dunkin'),
  FF_PATTERN("tim horton",        'tim_hortons'),
  FF_PATTERN("costa coffee",      'costa_coffee'),
  FF_PATTERN("pret a manger",     'pret_a_manger'),
  FF_PATTERN("greggs",            'greggs'),
  FF_PATTERN("krispy kreme",      'krispy_kreme'),

  // ── B.3 — Sweet treats / desserts ───────────────────────────────────────
  FF_PATTERN("baskin-robbins",    'baskin_robbins'),
  FF_PATTERN("cold stone creamery", 'cold_stone_creamery'),
  FF_PATTERN("häagen-dazs",       'haagen_dazs'),
  FF_PATTERN("haagen-dazs",       'haagen_dazs_alt'),  // ASCII variant
  FF_PATTERN("insomnia cookies",  'insomnia_cookies'),
  FF_PATTERN("crumbl",            'crumbl'),
  FF_PATTERN("smoothie king",     'smoothie_king'),
  FF_PATTERN("nothing bundt",     'nothing_bundt_cakes'),
  FF_PATTERN("rita's italian ice", 'ritas_italian_ice'),

  // ── B.4 — International (existing) ──────────────────────────────────────
  FF_PATTERN("quick",             'quick_belgium'),     // Belgian — note no trailing space; regex \b handles boundary
  FF_PATTERN("nordsee",           'nordsee'),
  FF_PATTERN("jollibee",          'jollibee'),
  FF_PATTERN("pollo tropical",    'pollo_tropical'),
  FF_PATTERN("pollo campero",     'pollo_campero'),
  FF_PATTERN("telepizza",         'telepizza'),

  // ── C.1 — Cheap snack chains (operator addition per D-7) ───────────────
  FF_PATTERN("auntie anne",       'auntie_annes'),
  FF_PATTERN("wetzel's pretzel",  'wetzels_pretzels'),
  FF_PATTERN("mrs. fields",       'mrs_fields'),
  FF_PATTERN("mrs fields",        'mrs_fields_alt'),
  FF_PATTERN("tiff's treats",     'tiffs_treats'),
  FF_PATTERN("cinnabon",          'cinnabon'),
  FF_PATTERN("pinkberry",         'pinkberry'),
  FF_PATTERN("yogen früz",        'yogen_fruz'),
  FF_PATTERN("yogen fruz",        'yogen_fruz_ascii'),
  FF_PATTERN("menchie's",         'menchies'),
  FF_PATTERN("einstein bros",     'einstein_bros'),     // catches Einstein Bagels too via brand-prefix
  FF_PATTERN("einstein bagel",    'einstein_bagels_alt'),
  FF_PATTERN("bruegger's",        'brueggers'),
  FF_PATTERN("nathan's famous",   'nathans_famous'),
  FF_PATTERN("hot dog on a stick", 'hot_dog_on_a_stick'),

  // ── C.2 — Coffee chain additions ───────────────────────────────────────
  FF_PATTERN("caffè nero",        'caffe_nero'),
  FF_PATTERN("caffe nero",        'caffe_nero_ascii'),
  FF_PATTERN("peet's coffee",     'peets_coffee'),
  FF_PATTERN("second cup",        'second_cup'),
  FF_PATTERN("au bon pain",       'au_bon_pain'),
  FF_PATTERN("tully's coffee",    'tullys_coffee'),

  // ── D — UK chain additions ────────────────────────────────────────────
  FF_PATTERN("leon",              'leon_uk'),           // word-boundary protects independents
  FF_PATTERN("itsu",              'itsu'),
  FF_PATTERN("wasabi",            'wasabi'),            // common word — operator confirmed; review T-NEG fixtures
  FF_PATTERN("eat.",              'eat_uk'),
  FF_PATTERN("patisserie valerie", 'patisserie_valerie'),
  FF_PATTERN("wetherspoons",      'wetherspoons'),
  FF_PATTERN("j d wetherspoon",   'jd_wetherspoon_alt'),
  FF_PATTERN("harvester",         'harvester_uk'),
  FF_PATTERN("bella italia",      'bella_italia_uk'),
  FF_PATTERN("zizzi",             'zizzi_uk'),
  FF_PATTERN("prezzo",            'prezzo_uk'),
  FF_PATTERN("frankie & benny",   'frankie_bennys'),
  FF_PATTERN("las iguanas",       'las_iguanas'),
  FF_PATTERN("toby carvery",      'toby_carvery'),
  // [D-12: Cote / Cote Brasserie REMOVED from blacklist — moved to UPSCALE_CHAIN_ALLOWLIST]

  // ── E — Belgium chain additions ───────────────────────────────────────
  FF_PATTERN("exki",              'exki_belgium'),
  FF_PATTERN("lunch garden",      'lunch_garden_belgium'),
  // [D-14: Le Pain Quotidien REMOVED from blacklist — explicit operator admit. Regression test T-LPQ-ADMIT.]

  // ── F — France chain additions ────────────────────────────────────────
  FF_PATTERN("flunch",            'flunch_france'),
  FF_PATTERN("buffalo grill",     'buffalo_grill_france'),
  FF_PATTERN("la boucherie",      'la_boucherie_france'),
  FF_PATTERN("paul ",             'paul_france_bakery'),  // trailing space intentional — Paul (chain) vs paul (proper noun in name)
  FF_PATTERN("brioche dorée",     'brioche_doree'),
  FF_PATTERN("brioche doree",     'brioche_doree_ascii'),
  FF_PATTERN("class' croute",     'class_croute'),
  FF_PATTERN("classcroute",       'classcroute_alt'),
  FF_PATTERN("pomme de pain",     'pomme_de_pain'),
  FF_PATTERN("léon de bruxelles", 'leon_de_bruxelles'),
  FF_PATTERN("leon de bruxelles", 'leon_de_bruxelles_ascii'),

  // ── G — Germany chain additions ───────────────────────────────────────
  FF_PATTERN("vapiano",           'vapiano'),
  FF_PATTERN("block house",       'block_house_de'),
  FF_PATTERN("backwerk",          'backwerk'),
  FF_PATTERN("wienerwald",        'wienerwald'),
  FF_PATTERN("kamps",             'kamps_bakery'),

  // ── H — Spain chain additions ─────────────────────────────────────────
  FF_PATTERN("lizarrán",          'lizarran_es'),
  FF_PATTERN("lizarran",          'lizarran_ascii'),
  FF_PATTERN("100 montaditos",    '100_montaditos'),
  FF_PATTERN("vips",              'vips_es'),
  FF_PATTERN("tagliatella",       'tagliatella_es'),
  FF_PATTERN("goiko",             'goiko'),

  // ── I — Lagos / Nigeria chain additions (per D-11) ─────────────────────
  FF_PATTERN("chicken republic",  'chicken_republic_ng'),
  FF_PATTERN("mr bigg's",         'mr_biggs_ng'),
  FF_PATTERN("mr biggs",          'mr_biggs_alt'),
  FF_PATTERN("tantalizers",       'tantalizers_ng'),
  FF_PATTERN("sweet sensation",   'sweet_sensation_ng'),
  FF_PATTERN("the place",         'the_place_ng'),     // word-boundary critical — common phrase
];
```

**Implementor note:** the `\b` word-boundary in `FF_PATTERN` helper is the regression guard against false positives (e.g., "Pizzeria Toro" doesn't match `pizza`-prefix patterns; "the place" pattern has `\bthe place\b` which matches "The Place" but NOT "the placebo store"). Test fixtures must include negative cases for each high-collision pattern.

### 5.3 `CASUAL_CHAIN_NAME_PATTERNS` (B12 casual full-service chains) — ~31 entries

```ts
export const CASUAL_CHAIN_NAME_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // ── J.1-21 — existing CASUAL_CHAIN_DEMOTION upgraded to BLACKLIST ───────
  FF_PATTERN("olive garden",      'olive_garden'),
  FF_PATTERN("red lobster",       'red_lobster'),
  FF_PATTERN("outback",           'outback_steakhouse'),
  FF_PATTERN("cheesecake factory", 'cheesecake_factory'),
  FF_PATTERN("applebee",          'applebees'),
  FF_PATTERN("chili's",           'chilis'),
  FF_PATTERN("tgi friday",        'tgi_fridays'),
  FF_PATTERN("denny's",           'dennys'),
  FF_PATTERN("ihop",              'ihop'),
  FF_PATTERN("waffle house",      'waffle_house'),
  FF_PATTERN("cracker barrel",    'cracker_barrel'),
  FF_PATTERN("texas roadhouse",   'texas_roadhouse'),
  FF_PATTERN("red robin",         'red_robin'),
  FF_PATTERN("buffalo wild wings", 'buffalo_wild_wings'),
  FF_PATTERN("longhorn steakhouse", 'longhorn_steakhouse'),
  FF_PATTERN("nando's",           'nandos'),
  FF_PATTERN("wagamama",          'wagamama'),
  FF_PATTERN("yo! sushi",         'yo_sushi'),
  FF_PATTERN("yo sushi",          'yo_sushi_alt'),
  FF_PATTERN("pizza express",     'pizza_express'),
  FF_PATTERN("pizzaexpress",      'pizzaexpress_alt'),
  FF_PATTERN("hippopotamus",      'hippopotamus_france'),

  // ── J.22+ — D-6 mid-tier additions (kept; J. Alexander's + Houston's moved to allowlist per D-12) ──
  FF_PATTERN("california pizza kitchen", 'california_pizza_kitchen'),
  FF_PATTERN("p.f. chang",        'pf_changs'),
  FF_PATTERN("pf chang",          'pf_changs_alt'),
  FF_PATTERN("bonefish grill",    'bonefish_grill'),
  FF_PATTERN("carrabba's",        'carrabbas'),
  // [D-12: J. Alexander's REMOVED — moved to UPSCALE_CHAIN_ALLOWLIST]
  // [D-12: Houston's / Hillstone REMOVED — moved to UPSCALE_CHAIN_ALLOWLIST]
  FF_PATTERN("bj's restaurant",   'bjs_restaurant'),
  FF_PATTERN("maggiano's little italy", 'maggianos_little_italy'),
  FF_PATTERN("yard house",        'yard_house'),
  FF_PATTERN("brio tuscan",       'brio_tuscan'),
  FF_PATTERN("bahama breeze",     'bahama_breeze'),
  FF_PATTERN("seasons 52",        'seasons_52'),
];
```

### 5.4 `UPSCALE_CHAIN_ALLOWLIST` (bypasses B12) — ~34 entries

```ts
// Case-insensitive prefix-or-substring match. If a place's name contains any
// of these strings, B12 (and B11 if it would match) is bypassed.
export const UPSCALE_CHAIN_ALLOWLIST: ReadonlyArray<string> = [
  // ── K.1-24 — existing UPSCALE_CHAIN_PROTECTION ──────────────────────────
  'nobu',
  "morton's",
  'nusr-et',
  'salt bae',
  "perry's steakhouse",
  'capital grille',
  "ruth's chris",
  "fleming's",
  "eddie v's",
  "del frisco's",
  "mastro's",
  'stk ',                 // trailing space — protect against "stkr" type collisions
  'boa steakhouse',
  'peter luger',
  'smith & wollensky',
  'the palm',
  "lawry's",
  'cut by wolfgang',
  'bazaar',                // José Andrés
  'jean-georges',
  'le bernardin',
  'eleven madison',
  'alinea',
  'per se',

  // ── K.25+ — operator-confirmed additions (D-12) ─────────────────────────
  'gordon ramsay',         // D-12: Hell's Kitchen, Bread Street Kitchen
  'the ivy',               // D-12: London upscale chain
  'hawksmoor',             // D-12: UK premium steakhouse
  'daniel boulud',         // D-12
  'db bistro',             // D-12: Daniel Boulud sibling brand
  'cipriani',              // D-12
  'carbone',               // D-12
  'cote brasserie',        // D-12: UK chain French bistro
  'côte brasserie',        // accent variant
  "j. alexander",          // D-12: moved from CASUAL_CHAIN_BLACKLIST to allowlist
  "j alexander",           // ASCII variant
  "houston's",             // D-12: moved from CASUAL_CHAIN_BLACKLIST
  'hillstone',             // sibling brand of Houston's
  'joël robuchon',         // K-31 default-accept proposal
  'joel robuchon',         // ASCII variant
  "l'atelier de joël robuchon",
];
```

---

## 6. Edge function layer

### 6.A `bouncer.ts` modifications

**Imports added (top of file):**
```ts
import {
  EXCLUDED_FAST_FOOD_TYPES,
  FAST_FOOD_NAME_PATTERNS,
  CASUAL_CHAIN_NAME_PATTERNS,
  UPSCALE_CHAIN_ALLOWLIST,
} from "./bouncerChainRules.ts";
```

**NEW exported helper functions (after line 155 `matchChildVenuePattern` definition):**

```ts
/**
 * Returns true if name is in UPSCALE_CHAIN_ALLOWLIST (case-insensitive).
 * Bypasses B11 + B12 — for chains that ARE date-worthy despite being chains.
 */
export function isUpscaleChainAllowlisted(name: string | null): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return UPSCALE_CHAIN_ALLOWLIST.some((allowed) => lower.includes(allowed.toLowerCase()));
}

/**
 * B11: returns the matching label if the name indicates a fast-food / cheap-snack
 * / coffee chain, else null. Allowlist short-circuits — allowlisted names always
 * return null.
 */
export function matchFastFoodPattern(name: string | null): string | null {
  if (!name) return null;
  if (isUpscaleChainAllowlisted(name)) return null;
  for (const { pattern, label } of FAST_FOOD_NAME_PATTERNS) {
    if (pattern.test(name)) return label;
  }
  return null;
}

/**
 * B12: returns the matching label if the name indicates a full-service casual
 * chain, else null. Allowlist short-circuits.
 */
export function matchCasualChainPattern(name: string | null): string | null {
  if (!name) return null;
  if (isUpscaleChainAllowlisted(name)) return null;
  for (const { pattern, label } of CASUAL_CHAIN_NAME_PATTERNS) {
    if (pattern.test(name)) return label;
  }
  return null;
}
```

**`bounce()` function modifications (line 200-270 region):**

Insert B10/B11/B12 rules AFTER B1 (line 211) but BEFORE B7 (line 235). New ordering:

```ts
export function bounce(
  place: PlaceRow,
  opts?: { skipStoredPhotoCheck?: boolean },
): BouncerVerdict {
  const cluster = deriveCluster(place.types);
  const reasons: string[] = [];

  // B1: type blocklist (short-circuit — no other reasons matter)
  if (cluster === 'EXCLUDED') {
    const matched = (place.types ?? []).find((t) => EXCLUDED_TYPES.includes(t));
    return { is_servable: false, cluster, reasons: [`B1:${matched ?? 'unknown'}`] };
  }

  // B2: business closed
  if (place.business_status === 'CLOSED_PERMANENTLY') {
    return { is_servable: false, cluster, reasons: ['B2:closed'] };
  }

  // B3: data integrity (name + lat + lng required)
  if (!place.name || place.lat == null || place.lng == null) {
    return { is_servable: false, cluster, reasons: ['B3:missing_required_field'] };
  }

  // B9: child-venue (pre-existing, ORCH-0631)
  const childVenueLabel = matchChildVenuePattern(place.name);
  if (childVenueLabel) {
    return { is_servable: false, cluster, reasons: [`B9:child_venue:${childVenueLabel}`] };
  }

  // ─── ORCH-0735 NEW RULES ────────────────────────────────────────────────

  // B10: fast-food / cheap-snack PRIMARY TYPE blocklist (per D-7)
  // Short-circuit — primary_type is structural, no other reasons matter.
  if (place.types?.some((t) => EXCLUDED_FAST_FOOD_TYPES.includes(t))) {
    const matched = (place.types ?? []).find((t) => EXCLUDED_FAST_FOOD_TYPES.includes(t));
    return { is_servable: false, cluster, reasons: [`B10:fast_food_type:${matched ?? 'unknown'}`] };
  }

  // B11: fast-food / coffee / cheap-snack CHAIN-NAME blocklist (per D-2/D-7/D-11)
  // Allowlist (UPSCALE_CHAIN_ALLOWLIST) short-circuits inside helper.
  const fastFoodLabel = matchFastFoodPattern(place.name);
  if (fastFoodLabel) {
    return { is_servable: false, cluster, reasons: [`B11:chain_brand:${fastFoodLabel}`] };
  }

  // B12: casual full-service chain blocklist (per D-3/D-6)
  // Allowlist short-circuits — Cipriani / Carbone / Capital Grille etc. survive.
  const casualChainLabel = matchCasualChainPattern(place.name);
  if (casualChainLabel) {
    return { is_servable: false, cluster, reasons: [`B12:casual_chain:${casualChainLabel}`] };
  }

  // ─── EXISTING B7-B9 quality rules continue below ───────────────────────

  // B7: Google photos required (universal)
  if (!hasGooglePhotos(place)) reasons.push('B7:no_google_photos');

  // B8: stored photos required (universal in final pass; SKIPPED in pre-photo pass)
  if (!opts?.skipStoredPhotoCheck && !hasStoredPhotos(place)) {
    reasons.push('B8:no_stored_photos');
  }

  // Cluster-specific rules (B4/B5/B6) unchanged
  if (cluster === 'A_COMMERCIAL') {
    if (!isOwnDomain(place.website)) {
      reasons.push(place.website ? 'B5:social_only' : 'B4:no_website');
    }
    if (!hasOpeningHours(place)) reasons.push('B6:no_hours');
  } else if (cluster === 'B_CULTURAL') {
    const famousBypass = (place.review_count ?? 0) >= 500 && (place.rating ?? 0) >= 4.5;
    if (!famousBypass) {
      if (!isOwnDomain(place.website)) {
        reasons.push(place.website ? 'B5:social_only' : 'B4:no_website');
      }
    }
    if (!hasOpeningHours(place)) reasons.push('B6:no_hours');
  }

  return {
    is_servable: reasons.length === 0,
    cluster,
    reasons,
  };
}
```

**Rule-order rationale documented in comment block:** B10 (type) → B11 (fast-food name) → B12 (casual name) before B7-B9. Reason: type/name rules are structural (NEVER admit) so they short-circuit; quality rules (photos, hours, website) are subordinate gates that only apply if structural rules pass.

### 6.B `run-bouncer/index.ts` — NO CHANGE (SPEC AMENDMENT 2026-05-05)

**AMENDMENT (2026-05-05) — SPEC §6.B is STRUCK; do NOT add `re_bounce_all_servable` action.**

Discovery during implementor pre-flight: existing `supabase/functions/run-bouncer/index.ts` already does the work this section was specifying. It accepts `{city_id?, all_cities?, dry_run?}`, loops all `is_active=true` rows in batches of 500, runs `bounce()`, writes `is_servable + bouncer_reason + bouncer_validated_at`. After B10/B11/B12 ship in `bounce()`, calling existing function with `{all_cities: true}` automatically applies the new rules to every active place.

**Adding a parallel action would violate Const #2 (one owner per truth) and inflate code/test scope without functional gain.**

Existing return shape is `{success, pass_count, reject_count, by_cluster, by_reason, written, duration_ms}` — richer than the SPEC's originally-proposed shape. Existing scope (all `is_active=true`) is broader and arguably better than SPEC's narrower `is_servable=true` scope (also re-judges rows previously rejected for transient B8 photo issues that might now genuinely qualify; rows that should stay rejected stay rejected as B10/B11/B12 are additive).

**Operator usage post-deploy:**
```bash
# Dry-run first to preview reasons_summary
curl -X POST 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-bouncer' \
  -H 'Authorization: Bearer <admin_token>' \
  -H 'Content-Type: application/json' \
  -d '{"all_cities": true, "dry_run": true}'

# Then live sweep
curl -X POST '...' -d '{"all_cities": true, "dry_run": false}'
```

**Existing function deploy required:** `run-bouncer/index.ts` imports `bounce` from `../_shared/bouncer.ts` at module load — after `bouncer.ts` changes go in, redeploy `run-bouncer` (and `run-pre-photo-bouncer` for two-pass parity) to pick up the new B10/B11/B12 rules.

**SC-13 + SC-14 + SC-15 amendment:** these criteria reference `re_bounce_all_servable` action; reinterpret as referencing the existing endpoint with `{all_cities: true}` body. Verifier behavior unchanged: dry_run preserves DB state; live updates verdict-changed rows; post-sweep SQL probe returns 0 violations.

**Files-modified count drops 3 → 2 (only `bouncer.ts` + `bouncer.test.ts` MOD; `run-bouncer/index.ts` UNTOUCHED).** Effort estimate drops ~9.3h → ~7h.

**ORIGINAL SPEC §6.B text (struck — preserved for audit trail):**

~~### 6.B `run-bouncer/index.ts` — NEW `re_bounce_all_servable` action~~

**Input schema:**
```ts
{
  action: "re_bounce_all_servable",
  city_id?: uuid,        // optional — if provided, only re-bounce that city's rows
  batch_size?: number,   // default 500; max 5000
  dry_run?: boolean,     // default false; if true, returns counts but does NOT update is_servable
}
```

**Output schema:**
```ts
{
  ok: boolean,
  scanned: number,                        // total rows checked
  flipped_to_unservable: number,          // count of rows that became is_servable=false
  flipped_to_servable: number,            // count of rows that became is_servable=true (rare; possible if old code was over-conservative)
  unchanged: number,                      // count of rows whose verdict didn't change
  reasons_summary: { [code: string]: number }, // e.g. {"B11:chain_brand:chick_fil_a": 56, "B10:fast_food_type:fast_food_restaurant": 24, ...}
  next_offset?: number,                   // pagination cursor; null when done
  dry_run: boolean,
}
```

**Logic:**
1. Validate input (city_id is uuid if present; batch_size ∈ [50, 5000]).
2. Query `place_pool WHERE is_servable=true [AND city_id=$1]` ordered by `id` with `LIMIT $2 OFFSET $offset`.
3. For each row, run `bounce(place)` (final pass, photos required).
4. If verdict differs from current `is_servable` value: UPDATE the row (unless `dry_run=true`).
5. Aggregate reason counts.
6. Return `next_offset` if more rows exist; null if done.

**Operator usage:** orchestrator-supplied `curl` command in CLOSE protocol. Operator polls until `next_offset=null`. Optional `dry_run=true` first to preview.

**Auth:** existing `run-bouncer` admin-only auth gate applies.

**Cost guard:** none required (all in-DB; no external API calls).

---

## 7. Test cases

Mandatory minimum **45 fixtures** in `supabase/functions/_shared/__tests__/bouncer.test.ts`. Each asserts both verdict AND reason code.

### 7.1 Positive (B10 type-blocklist) — 5 tests

| ID | Scenario | Input | Expected verdict |
|---|---|---|---|
| T-B10-01 | fast_food_restaurant blocked | `{primary_type: "fast_food_restaurant", types: ["fast_food_restaurant", "restaurant"], name: "Chick-fil-A", ...quality OK}` | `{is_servable: false, reasons: ["B10:fast_food_type:fast_food_restaurant"]}` |
| T-B10-02 | snack_bar blocked | `{primary_type: "snack_bar", types: ["snack_bar"], name: "Snack Spot", ...}` | `{is_servable: false, reasons: ["B10:fast_food_type:snack_bar"]}` |
| T-B10-03 | food_court blocked | `{types: ["food_court"], ...}` | `{is_servable: false, reasons: ["B10:fast_food_type:food_court"]}` |
| T-B10-04 | cafeteria blocked | `{types: ["cafeteria"], ...}` | `{is_servable: false, reasons: ["B10:fast_food_type:cafeteria"]}` |
| T-B10-05 | convenience_store blocked | `{types: ["convenience_store"], name: "7-Eleven", ...}` | `{is_servable: false, reasons: ["B10:fast_food_type:convenience_store"]}` |

### 7.2 Positive (B11 chain-name) — 18 tests covering each region

| ID | Place | Expected reason |
|---|---|---|
| T-B11-01 | "McDonald's" / `hamburger_restaurant` | `B11:chain_brand:mcdonalds` |
| T-B11-02 | "Starbucks" / `coffee_shop` | `B11:chain_brand:starbucks` |
| T-B11-03 | "Pizza Hut" / `pizza_restaurant` | `B11:chain_brand:pizza_hut` |
| T-B11-04 | "Domino's Pizza" | `B11:chain_brand:dominos` |
| T-B11-05 | "Cinnabon" / `bakery` | `B11:chain_brand:cinnabon` |
| T-B11-06 | "Auntie Anne's Pretzels" | `B11:chain_brand:auntie_annes` |
| T-B11-07 | "Pinkberry" / `ice_cream_shop` | `B11:chain_brand:pinkberry` |
| T-B11-08 | "Einstein Bros Bagels" | `B11:chain_brand:einstein_bros` |
| T-B11-09 | "Nathan's Famous" | `B11:chain_brand:nathans_famous` |
| T-B11-10 | "Greggs" / UK | `B11:chain_brand:greggs` |
| T-B11-11 | "Wagamama" → goes to B12 (casual chain not B11) | `B12:casual_chain:wagamama` |
| T-B11-12 | "Itsu" / UK | `B11:chain_brand:itsu` |
| T-B11-13 | "Flunch" / France | `B11:chain_brand:flunch_france` |
| T-B11-14 | "Vapiano" / Germany | `B11:chain_brand:vapiano` |
| T-B11-15 | "Lizarrán" / Spain | `B11:chain_brand:lizarran_es` |
| T-B11-16 | "Chicken Republic" / Lagos | `B11:chain_brand:chicken_republic_ng` |
| T-B11-17 | "Mr Bigg's" / Lagos | `B11:chain_brand:mr_biggs_ng` |
| T-B11-18 | "Quick" Belgian fast food | `B11:chain_brand:quick_belgium` |

### 7.3 Positive (B12 casual chain) — 8 tests

| ID | Place | Expected reason |
|---|---|---|
| T-B12-01 | "Olive Garden" | `B12:casual_chain:olive_garden` |
| T-B12-02 | "Applebee's" | `B12:casual_chain:applebees` |
| T-B12-03 | "Cheesecake Factory" | `B12:casual_chain:cheesecake_factory` |
| T-B12-04 | "Buffalo Wild Wings" | `B12:casual_chain:buffalo_wild_wings` |
| T-B12-05 | "Texas Roadhouse" | `B12:casual_chain:texas_roadhouse` |
| T-B12-06 | "California Pizza Kitchen" | `B12:casual_chain:california_pizza_kitchen` |
| T-B12-07 | "P.F. Chang's" | `B12:casual_chain:pf_changs` |
| T-B12-08 | "Pizza Express" / UK | `B12:casual_chain:pizza_express` |

### 7.4 Negative (independents survive) — 8 tests

| ID | Place | Expected verdict |
|---|---|---|
| T-NEG-01 | "Pizzeria Toro" / `pizza_restaurant` (independent) | `is_servable: true, reasons: []` |
| T-NEG-02 | "Lilly's Pizza" / `pizza_restaurant` | `is_servable: true` |
| T-NEG-03 | "Yellow Dog Bread Co." / `bakery` (artisan) | `is_servable: true` |
| T-NEG-04 | "Big Tony's Hot Dogs" / `american_restaurant` (NOT primary_type fast_food_restaurant) | `is_servable: true` |
| T-NEG-05 | "The Placebo Bar" — must NOT match `the place` Lagos pattern | `is_servable: true` |
| T-NEG-06 | "Sublime Donuts" / `donut_shop` (artisan) | `is_servable: true` |
| T-NEG-07 | "Hurts Donut" / `donut_shop` — note "Hurts" not "Krispy Kreme" | `is_servable: true` |
| T-NEG-08 | "Pizzaria Romano's" — must NOT match `pizza` chain patterns | `is_servable: true` |

### 7.5 Allowlist bypass (B11/B12 short-circuit via UPSCALE_CHAIN_ALLOWLIST) — 6 tests

| ID | Place | Expected verdict |
|---|---|---|
| T-ALLOW-01 | "The Capital Grille" | `is_servable: true` (allowlist bypasses B12) |
| T-ALLOW-02 | "Ruth's Chris Steak House" | `is_servable: true` |
| T-ALLOW-03 | "Hawksmoor Spitalfields" | `is_servable: true` (D-12 addition) |
| T-ALLOW-04 | "Cipriani 42nd Street" | `is_servable: true` (D-12 addition) |
| T-ALLOW-05 | "Gordon Ramsay Hell's Kitchen" | `is_servable: true` (D-12 addition) |
| T-ALLOW-06 | "Houston's" / `american_restaurant` | `is_servable: true` (D-12 moved from blacklist) |

### 7.6 Operator-flagged regression guards (D-13/D-14) — 2 tests + extras — CRITICAL

| ID | Scenario | Input | Expected verdict | Why |
|---|---|---|---|---|
| **T-CAVA-ADMIT** | **Cava admitted (D-13)** | `{name: "CAVA Mediterranean", primary_type: "restaurant", ...quality OK}` | `{is_servable: true, reasons: []}` | Operator markup explicitly REMOVED Cava from blacklist. If a future PR re-adds Cava, this test fails — regression guard. |
| **T-LPQ-ADMIT** | **Le Pain Quotidien admitted (D-14)** | `{name: "Le Pain Quotidien", primary_type: "bakery", ...quality OK}` | `{is_servable: true, reasons: []}` | Operator markup explicitly REJECTED proposed E2 Le Pain Quotidien addition. Regression guard. |
| T-CAVA-VARIANT | "Cavalry Pub" must not false-match | `{name: "Cavalry Pub", ...}` | `is_servable: true` | Word-boundary regex must not match "cava" within "cavalry". |
| T-LEON-INDEPENDENT | "Léon Restaurant" (Brussels independent, not chain) | `{name: "Léon Restaurant", ...}` | depends on word-boundary; if pattern is `leon de bruxelles` not just `leon`, this passes | Tests pattern specificity. |

### 7.7 Pre-photo pass parity — 2 tests

| ID | Scenario | Input | Expected |
|---|---|---|---|
| T-PARITY-01 | B10 fires identically in pre-photo pass | T-B10-01 input + `opts.skipStoredPhotoCheck=true` | identical verdict |
| T-PARITY-02 | B11 fires identically in pre-photo pass | T-B11-01 input + `opts.skipStoredPhotoCheck=true` | identical verdict |

### 7.8 Re-bounce sweep — 2 tests

| ID | Scenario | Expected |
|---|---|---|
| T-SWEEP-01 | Existing Chick-fil-A row with `is_servable=true, bouncer_validated_at=2026-04-01` | After `re_bounce_all_servable`: `is_servable=false`, `bouncer_reason="B11:chain_brand:chick_fil_a"`, `bouncer_validated_at >= deploy_date` |
| T-SWEEP-02 | Dry-run mode preserves DB state | After `dry_run=true`: returns reasons_summary; `place_pool` rows unchanged |

### 7.9 Edge cases — 2 tests

| ID | Scenario | Input | Expected |
|---|---|---|---|
| T-EDGE-01 | Empty name | `{name: "", ...}` | B3 fires first (name required); B11/B12 helpers return null on null/empty |
| T-EDGE-02 | Place with multiple chain-matching names "Starbucks at Marriott Hotel" | should match B11:starbucks | `is_servable: false, reasons: ["B11:chain_brand:starbucks"]` (allowlist check first, no allow match → B11 fires) |

**Total: 45+ fixtures.** Implementor may add more if edge cases emerge.

---

## 8. Invariants

### 8.1 NEW invariant (orchestrator ratifies at CLOSE per Step 5e)

**`I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS`** — Every row in `place_pool` with `is_servable=true` and `bouncer_validated_at >= '2026-05-XX'` (post-ORCH-0735 deploy date) MUST satisfy:
- (a) `primary_type` is NOT in `EXCLUDED_FAST_FOOD_TYPES`;
- (b) `name` does NOT match any `FAST_FOOD_NAME_PATTERNS` UNLESS allowlisted by `UPSCALE_CHAIN_ALLOWLIST`;
- (c) `name` does NOT match any `CASUAL_CHAIN_NAME_PATTERNS` UNLESS allowlisted by `UPSCALE_CHAIN_ALLOWLIST`.

Post-deploy CI gate (SQL probe; not implemented as GitHub Action in this SPEC):
```sql
SELECT count(*) FROM place_pool
WHERE is_servable = true
  AND bouncer_validated_at >= 'YYYY-MM-DD'
  AND (
    primary_type IN ('fast_food_restaurant', 'snack_bar', 'food_court', 'cafeteria', 'convenience_store')
    OR (
      LOWER(name) ~ '<joined regex>'
      AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table('<allowlist>', '\|') a WHERE LOWER(name) LIKE '%' || a || '%')
    )
  );
-- Expected: 0
```
SPEC includes the probe SQL skeleton; full encoding is implementor-tactical.

### 8.2 Preserved invariants

- **`I-BOUNCER-DETERMINISTIC`** (`bouncer.ts:12`) — preserved. B10/B11/B12 are pure type-list + regex matching; no AI, no external calls, no I/O.
- **`I-TWO-PASS-BOUNCER-RULE-PARITY`** (`bouncer.ts:15-19`) — preserved. New rules are photo-independent; fire identically in both passes.
- **`I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING`** (DEC-099) — preserved. ORCH-0735 is upstream of trial; doesn't touch trial output.
- **`I-TRIAL-RUN-SCOPED-TO-CITY`** (DEC-105 / ORCH-0734) — preserved. ORCH-0735 doesn't modify trial pipeline.

---

## 9. Implementation order

1. **Implementor reads SPEC end-to-end + investigation report** (`reports/INVESTIGATION_ORCH-0735_BOUNCER_CHAIN_GAP.md`).
2. **Pre-write decommission memory** at `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_bouncer_chain_rules_in_code.md` with frontmatter `status: DRAFT — flips to ACTIVE on ORCH-0735 CLOSE`. Documents Path A workflow: "to add new chain, edit `bouncerChainRules.ts` + add test fixture + PR. The DB rule_sets tables are decoupled and scheduled for ORCH-0736 decommission. Editing rule_sets via admin UI does NOT affect production."
3. **Create `supabase/functions/_shared/bouncerChainRules.ts`** with all 4 lists per §5 verbatim.
4. **Modify `supabase/functions/_shared/bouncer.ts`** — add imports, helpers, B10/B11/B12 in `bounce()` per §6.A.
5. **Add 45+ test fixtures to `supabase/functions/_shared/__tests__/bouncer.test.ts`** per §7.
6. **Run Deno test suite locally:** `deno test supabase/functions/_shared/__tests__/bouncer.test.ts`. Confirm all pass before deploy.
7. **Modify `supabase/functions/run-bouncer/index.ts`** to add `re_bounce_all_servable` action per §6.B.
8. **Operator deploys edge fn:** `supabase functions deploy run-bouncer --project-ref gqnoajqerqhnvulmnyvv`.
9. **Operator runs DRY-RUN sweep first:**
   ```bash
   curl -X POST 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-bouncer' \
     -H 'Authorization: Bearer <admin_token>' \
     -H 'Content-Type: application/json' \
     -d '{"action":"re_bounce_all_servable","dry_run":true,"batch_size":1000}'
   ```
   Verify the `reasons_summary` matches expected ~600-1000 chain rejections. If unexpected (e.g., independent pizzeria getting flipped), abort and surface to orchestrator.
10. **Operator runs LIVE sweep** (paginate via `next_offset` until null):
    ```bash
    curl -X POST '...' -d '{"action":"re_bounce_all_servable","batch_size":1000,"dry_run":false}'
    # Repeat with next_offset until next_offset=null
    ```
11. **Post-sweep verification:** orchestrator runs SQL probe from §8.1 to confirm 0 violations.
12. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0735_BOUNCER_RULES_REPORT.md` per standard 15-section template.

---

## 10. Regression prevention

| Class | Safeguard |
|---|---|
| Future code admits fast food/chains | NEW invariant `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS` ratified at CLOSE; SQL probe verifies. |
| Pizzeria pattern false-positive | Word-boundary `\b` regex per D-4. T-NEG-01/02/08 catch regression. |
| Stale data not re-bounced | Re-bounce sweep step (Step 9-10) mandatory; tester verifies all `is_servable=true` rows have `bouncer_validated_at >= deploy_date`. |
| Cava re-blacklisted by accident | T-CAVA-ADMIT regression guard fixture FAILS if Cava is re-added. |
| Le Pain Quotidien re-blacklisted | T-LPQ-ADMIT regression guard. |
| Operator adds new chain | Code PR adds to `bouncerChainRules.ts` + test fixture. Memory file `feedback_bouncer_chain_rules_in_code.md` documents workflow. |
| Photo-rich chain (Chick-fil-A) sneaks past B8 | B11 catches by name. B8 stays a quality gate but no longer the only filter. |
| ORCH-0736 decommission unblocks | Pre-write `feedback_rule_sets_decommissioned.md` in DRAFT during ORCH-0736 SPEC dispatch (NOT now). |

---

## 11. Success criteria (numbered, observable, testable, unambiguous) — 22 SCs

1. **SC-01:** `bouncerChainRules.ts` exists and exports `EXCLUDED_FAST_FOOD_TYPES` (5 entries), `FAST_FOOD_NAME_PATTERNS` (~120 entries), `CASUAL_CHAIN_NAME_PATTERNS` (~31 entries), `UPSCALE_CHAIN_ALLOWLIST` (~34 entries).
2. **SC-02:** `bouncer.ts` imports from `bouncerChainRules.ts` and exports `matchFastFoodPattern`, `matchCasualChainPattern`, `isUpscaleChainAllowlisted` helpers.
3. **SC-03:** `bounce()` applies B10/B11/B12 in correct order: B10 (type) → B11 (fast-food name) → B12 (casual chain) AFTER B1/B2/B3/B9 but BEFORE B7-B9 quality rules.
4. **SC-04:** B10 returns short-circuit verdict `{is_servable: false, reasons: ["B10:fast_food_type:<type>"]}` when `place.types` includes any `EXCLUDED_FAST_FOOD_TYPES`.
5. **SC-05:** B11 returns short-circuit verdict `{is_servable: false, reasons: ["B11:chain_brand:<label>"]}` when name matches FAST_FOOD_NAME_PATTERNS AND not allowlisted.
6. **SC-06:** B12 returns short-circuit verdict `{is_servable: false, reasons: ["B12:casual_chain:<label>"]}` when name matches CASUAL_CHAIN_NAME_PATTERNS AND not allowlisted.
7. **SC-07:** Allowlist bypass — UPSCALE_CHAIN_ALLOWLIST short-circuits both B11 and B12. Capital Grille / Hawksmoor / Cipriani / Carbone / Houston's all admit despite chain status.
8. **SC-08:** **Cava admitted regression guard** — T-CAVA-ADMIT passes; "CAVA Mediterranean" returns `is_servable: true`.
9. **SC-09:** **Le Pain Quotidien admitted regression guard** — T-LPQ-ADMIT passes; "Le Pain Quotidien" returns `is_servable: true`.
10. **SC-10:** Word-boundary regex prevents false-positives — "Pizzeria Toro" / "Lilly's Pizza" / "The Placebo Bar" / "Pizzaria Romano's" all admit.
11. **SC-11:** Pre-photo pass parity — B10/B11/B12 fire identically with `opts.skipStoredPhotoCheck=true`. T-PARITY-01/02 pass.
12. **SC-12:** All 45+ fixtures in `bouncer.test.ts` pass via `deno test`.
13. **SC-13:** `run-bouncer` edge fn accepts `re_bounce_all_servable` action with input schema validation.
14. **SC-14:** Re-bounce sweep `dry_run=true` mode does NOT modify any `place_pool` row; returns `reasons_summary` for inspection.
15. **SC-15:** Re-bounce sweep `dry_run=false` updates rows whose verdict changed; updates `bouncer_validated_at` to current timestamp; updates `bouncer_reason` to the new verdict.
16. **SC-16:** Post-sweep SQL probe (§8.1) returns 0 violations.
17. **SC-17:** I-BOUNCER-DETERMINISTIC preserved — no AI/network calls in B10/B11/B12.
18. **SC-18:** I-TWO-PASS-BOUNCER-RULE-PARITY preserved — new rules photo-independent.
19. **SC-19:** Memory file `feedback_bouncer_chain_rules_in_code.md` exists with `status: DRAFT — flips to ACTIVE on ORCH-0735 CLOSE`.
20. **SC-20:** No mobile files modified. Verified via `git diff --stat | grep app-mobile/` returns empty.
21. **SC-21:** No DB schema migration files in this implementation. Verified via `git diff --stat supabase/migrations/` returns empty.
22. **SC-22:** Implementation report saved at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0735_BOUNCER_RULES_REPORT.md` covering all 22 SCs.

---

## 12. Estimated effort

| Phase | Effort |
|---|---|
| Read SPEC + investigation | 0.5 hr |
| Pre-write decommission memory | 0.3 hr |
| Create `bouncerChainRules.ts` | 1.5 hr (transcribe + verify entry counts) |
| Modify `bouncer.ts` + helpers | 1.0 hr |
| Add 45+ test fixtures | 2.0 hr |
| Modify `run-bouncer/index.ts` for re_bounce action | 1.5 hr |
| Run Deno test suite + iterate | 0.5 hr |
| Implementation report | 1.0 hr |
| Buffer for unknowns | 1.0 hr |
| **Total** | **~9.3 hours (1-day session)** |

Operator-side post-deploy: ~30 min (deploy + dry-run sweep verify + live sweep paginate).

---

## 13. Open questions for orchestrator

**Zero open questions.** All 15 operator decisions (D-1..D-15) locked. F-3/F-11 word-boundary regex risk addressed via T-NEG fixtures + helper pattern. F-9 stale-data trap addressed via mandatory re-bounce sweep. F-10 three-tier preservation honored via UPSCALE_CHAIN_ALLOWLIST.

**One implementation-time clarification flagged for implementor awareness (NOT a blocker):**
- §5.2 entry list uses `\b` word-boundary semantics in the `FF_PATTERN` helper. Some patterns benefit from explicit anchoring (e.g., "the place" must use `\bthe place\b` not `\bplace\b`). Implementor verifies regex anchoring per pattern; T-NEG-05 tests the highest-risk case ("the placebo bar").

---

## 14. SPEC-author signoff

This SPEC is BINDING. Implementor follows it exactly; deviations require orchestrator escalation BEFORE coding.

**Operator confirmation chain:**
- ORCH-0735 INTAKE 2026-05-05 (operator: "the bouncer is supposed to bounce all fast food, and chains")
- D-1..D-7 confirmed 2026-05-05 ("Path A. Please also add cheap snack shops")
- D-8/D-10 SPEC-author judgment per investigation §F-11
- D-9 confirmed 2026-05-05 ("confirm proceed" on sequenced ORCH-0735 → ORCH-0736)
- D-11..D-15 markup confirmed 2026-05-05 (Lagos correct + 9 upscale allowlist + Cava + Le Pain Quotidien)

**End of SPEC. Ready for orchestrator REVIEW + IMPLEMENTOR dispatch.**
