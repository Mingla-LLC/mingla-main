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

// ─── B10: Primary-type blocklist (per D-7 cheap-snack scope) ────────────────
export const EXCLUDED_FAST_FOOD_TYPES: ReadonlyArray<string> = [
  'fast_food_restaurant',  // Generic fast food (when properly tagged by Google)
  'snack_bar',              // Cheap snack shops (per D-7)
  'food_court',             // Mall food courts (per D-7)
  'cafeteria',              // Institutional cafeterias (per D-7)
  'convenience_store',      // 7-Eleven / Wawa / Sheetz (per D-7)
];

// ─── Helper: word-boundary regex builder ────────────────────────────────────
// Escapes regex special characters in the substring, then wraps with \b
// word-boundary anchors. Case-insensitive matching.
//
// Example: FF_PATTERN("the place", 'the_place') matches "The Place" but not
// "the placebo store" or "in the placement office".
function FF_PATTERN(substr: string, label: string): { pattern: RegExp; label: string } {
  const escaped = substr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    pattern: new RegExp(`\\b${escaped}\\b`, 'i'),
    label,
  };
}

// ─── B11: Fast-food / coffee / cheap-snack chain-name blacklist (~120) ──────
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
  // [ORCH-0735 v3: split "papa john" into both plural forms. The original
  //  "papa john" matched "Papa John's" (apostrophe = non-word boundary) but
  //  NOT "Papa Johns" (s = word char, \b suppressed). Live data has both forms.]
  FF_PATTERN("papa johns",        'papa_johns'),    // plural / no-apostrophe form
  FF_PATTERN("papa john's",       'papa_johns'),    // apostrophe-canonical form
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
  // [ORCH-0735 v3: "firehouse sub" did NOT match "Firehouse Subs" (plural, no
  //  apostrophe). Venue data overwhelmingly uses plural form (Raleigh ×2 leaked).
  //  Singular variant intentionally dropped — re-add via ORCH-0739 if needed.]
  FF_PATTERN("firehouse subs",    'firehouse_subs'),
  FF_PATTERN("qdoba",             'qdoba'),
  FF_PATTERN("potbelly",          'potbelly'),
  FF_PATTERN("sweetgreen",        'sweetgreen'),
  FF_PATTERN("tropical smoothie", 'tropical_smoothie'),
  FF_PATTERN("moe's southwest",   'moes_southwest'),
  // [D-13: cava REMOVED — explicit operator admit. Regression test T-CAVA-ADMIT.]

  // ── B.2 — Coffee / cafe chains (per D-2 EXCLUDE entirely) ──────────────
  FF_PATTERN("starbucks",         'starbucks'),
  FF_PATTERN("dunkin",            'dunkin'),
  FF_PATTERN("tim horton",        'tim_hortons'),
  FF_PATTERN("costa coffee",      'costa_coffee'),
  FF_PATTERN("pret a manger",     'pret_a_manger'),
  FF_PATTERN("greggs",            'greggs'),
  FF_PATTERN("krispy kreme",      'krispy_kreme'),

  // ── B.3 — Sweet treats / desserts ───────────────────────────────────────
  FF_PATTERN("baskin-robbins",    'baskin_robbins'),
  // [ORCH-0735 v3: widened from "cold stone creamery" to "cold stone" — Lagos venue
  //  "Cold Stone Bode Thomas, Surulere" leaked v2. Word-boundary still anchors so
  //  arbitrary "cold stone" prose won't false-match. Label preserved for stability.]
  FF_PATTERN("cold stone",        'cold_stone_creamery'),
  FF_PATTERN("dairy queen",       'dairy_queen'),  // ORCH-0735 v3: missing pattern (Baltimore/FtL/Raleigh leaks)
  FF_PATTERN("häagen-dazs",       'haagen_dazs'),
  FF_PATTERN("haagen-dazs",       'haagen_dazs_alt'),
  FF_PATTERN("insomnia cookies",  'insomnia_cookies'),
  FF_PATTERN("crumbl",            'crumbl'),
  FF_PATTERN("smoothie king",     'smoothie_king'),
  FF_PATTERN("nothing bundt",     'nothing_bundt_cakes'),
  FF_PATTERN("rita's italian ice", 'ritas_italian_ice'),

  // ── B.4 — International (existing) ──────────────────────────────────────
  // [ORCH-0735 v2 rework: `quick` (Belgian) DROPPED — false-positive rate too high; word too common in restaurant names. ~2 chain hits vs ~5 false. Operator may re-add with stricter pattern in future ORCH.]
  FF_PATTERN("nordsee",           'nordsee'),
  FF_PATTERN("jollibee",          'jollibee'),
  FF_PATTERN("pollo tropical",    'pollo_tropical'),
  FF_PATTERN("pollo campero",     'pollo_campero'),
  FF_PATTERN("telepizza",         'telepizza'),

  // ── C.1 — Cheap snack chains (per D-7) ─────────────────────────────────
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
  FF_PATTERN("einstein bros",     'einstein_bros'),
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
  // [ORCH-0735 v2 rework: `leon` (UK Leon chain) DROPPED — `\bleon\b` matched independent restaurants like "Pupuseria Maria de Leon Bus". ~1 chain hit vs ~16 false. Future ORCH may re-add with chain-context anchor. Multi-word `léon de bruxelles` / `leon de bruxelles` kept below — they are precise enough.]
  FF_PATTERN("itsu",              'itsu'),
  // [ORCH-0735 v2 rework: `wasabi` (UK chain) DROPPED — `\bwasabi\b` matched independent Asian/sushi places. ~1-2 chain hits vs ~4-5 false.]
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
  // [ORCH-0735 v2 rework: `paul` (French Paul bakery) DROPPED — `\bpaul\b` matched parks/churches/people/independents (74 hits / ~2 chain / ~72 false). Catastrophic precision; future re-add must be highly specific (e.g., 'paul boulangerie', 'paul bakery').]
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
  FF_PATTERN("the place",         'the_place_ng'),
];

// ─── B12: Casual full-service chain blacklist (~31) ─────────────────────────
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
  FF_PATTERN("ihop",               'ihop'),
  FF_PATTERN("waffle house",      'waffle_house'),
  FF_PATTERN("cracker barrel",    'cracker_barrel'),
  FF_PATTERN("bob evans",         'bob_evans'),    // ORCH-0735 v3: missing pattern (Durham leak)
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

  // ── J.22+ — D-6 mid-tier additions (J. Alexander's + Houston's moved to allowlist per D-12) ──
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

// ─── UPSCALE_CHAIN_ALLOWLIST: bypasses B11 + B12 (~34) ──────────────────────
// Case-insensitive substring match. If a place's name contains any of these
// strings (lowercased), B11/B12 are bypassed.
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
  'stk ',                 // trailing space — protect against "stkr"-type collisions
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
