# Interim Operator Review — ORCH-0735 Chain Coverage

**Status:** PRE-SPEC operator review (per D-5)
**Date:** 2026-05-05
**Author:** mingla-forensics (SPEC mode)
**Action required:** Operator marks up additions/removals/upgrades-to-allowlist. SPEC LOCKS after this review.

---

## How to use this document

For each region's section, mark each line with one of:

- ✅ **KEEP** — entry stays as is (default if unmarked)
- ❌ **REMOVE** — entry should NOT be in the blacklist
- ⬆️ **UPGRADE** — move from BLACKLIST to UPSCALE_CHAIN_ALLOWLIST (legit chain)
- ✏️ **EDIT: <new value>** — change the matching pattern

For each "Proposed additions" section, mark each line with:

- ✅ **ADD** — include in blacklist
- ❌ **SKIP** — do not include
- 🛡️ **ALLOWLIST** — add to UPSCALE_CHAIN_ALLOWLIST instead

**Add custom entries** anywhere with `+ "<name>"` lines — operator-discovered chains we missed.

Time budget: ~30 minutes. Don't overthink edge cases — we can always add chains in a follow-up commit. The goal is "catch the obvious chains in each region, ship the v1, learn from production."

---

## A. EXCLUDED_FAST_FOOD_TYPES (B10 type-blocklist)

These are Google Places primary_types that get rejected regardless of name.

| # | Type | Coverage | Mark |
|---|---|---|---|
| 1 | `fast_food_restaurant` | Generic fast food (McDonald's, etc. when properly tagged) | ___ |
| 2 | `snack_bar` | Cheap snack shops (per D-7) | ___ |
| 3 | `food_court` | Mall food courts (per D-7) | ___ |
| 4 | `cafeteria` | Institutional cafeterias (per D-7) | ___ |
| 5 | `convenience_store` | 7-Eleven / Wawa / Sheetz hot food (per D-7) | ___ |

**Borderline types (NOT proposed; operator may add):**
- ❌ `bakery` — many independent artisan bakeries are date-worthy
- ❌ `ice_cream_shop` — artisan gelaterias survive
- ❌ `donut_shop` — artisan donut shops (Sublime / Hurts) survive
- ❌ `hamburger_restaurant` — many independent burger joints are legit; chains caught by name pattern
- ❌ `pizza_restaurant` — independent pizzerias are core date food; chains caught by name pattern
- ❌ `sandwich_shop` — independents survive
- ❌ `cafe` / `coffee_shop` — independents survive (chain coffee patterns catch Starbucks etc.)

If operator wants any of these blanket-excluded by primary_type, mark + ADD them to the table above.

---

## B. FAST_FOOD_NAME_PATTERNS — current entries (66, by region)

### B.1 — US/global fast-food (existing, already in DB FAST_FOOD_BLACKLIST)

| # | Pattern (lowercase substring match) | Mark |
|---|---|---|
| 1 | `mcdonald` | ___ |
| 2 | `burger king` | ___ |
| 3 | `kfc` | ___ |
| 4 | `kentucky fried` | ___ |
| 5 | `wendy's` | ___ |
| 6 | `subway` | ___ |
| 7 | `taco bell` | ___ |
| 8 | `chick-fil-a` | ___ |
| 9 | `five guys` | ___ |
| 10 | `popeyes` | ___ |
| 11 | `panda express` | ___ |
| 12 | `domino's` | ___ |
| 13 | `papa john` | ___ |
| 14 | `pizza hut` | ___ |
| 15 | `little caesar` | ___ |
| 16 | `sonic drive` | ___ |
| 17 | `jack in the box` | ___ |
| 18 | `arby's` | ___ |
| 19 | `carl's jr` | ___ |
| 20 | `hardee` | ___ |
| 21 | `del taco` | ___ |
| 22 | `raising cane` | ___ |
| 23 | `whataburger` | ___ |
| 24 | `in-n-out` | ___ |
| 25 | `wingstop` | ___ |
| 26 | `chipotle` | ___ |
| 27 | `shake shack` | ___ |
| 28 | `checkers` | ___ |
| 29 | `rally's` | ___ |
| 30 | `church's chicken` | ___ |
| 31 | `el pollo loco` | ___ |
| 32 | `golden corral` | ___ |
| 33 | `bojangles` | ___ |
| 34 | `cook out` | ___ |
| 35 | `zaxby` | ___ |
| 36 | `panera bread` | ___ |
| 37 | `jersey mike` | ___ |
| 38 | `jimmy john` | ___ |
| 39 | `firehouse sub` | ___ |
| 40 | `qdoba` | ___ |
| 41 | `potbelly` | ___ |
| 42 | `sweetgreen` | ___ |
| 43 | `tropical smoothie` | ___ |
| 44 | `moe's southwest` | ___ |
| 45 | `cava ` (trailing space) | ___ |

### B.2 — Coffee / cafe chains (existing, per D-2 EXCLUDE)

| # | Pattern | Mark |
|---|---|---|
| 46 | `starbucks` | ___ |
| 47 | `dunkin` | ___ |
| 48 | `tim horton` (Canada) | ___ |
| 49 | `costa coffee` (UK) | ___ |
| 50 | `pret a manger` (UK) | ___ |
| 51 | `greggs` (UK) | ___ |
| 52 | `krispy kreme` (US/global) | ___ |

### B.3 — Sweet treat / dessert chains (existing)

| # | Pattern | Mark |
|---|---|---|
| 53 | `baskin-robbins` | ___ |
| 54 | `cold stone creamery` | ___ |
| 55 | `häagen-dazs` | ___ |
| 56 | `insomnia cookies` | ___ |
| 57 | `crumbl` | ___ |
| 58 | `smoothie king` | ___ |
| 59 | `nothing bundt` (cakes) | ___ |
| 60 | `rita's italian ice` | ___ |

### B.4 — International / regional (existing)

| # | Pattern | Region | Mark |
|---|---|---|---|
| 61 | `quick ` (trailing space) | Belgium | ___ |
| 62 | `nordsee` | Germany (fish fast food) | ___ |
| 63 | `jollibee` | Philippines / global | ___ |
| 64 | `pollo tropical` | US/Caribbean | ___ |
| 65 | `pollo campero` | Latin America | ___ |
| 66 | `telepizza` | Spain | ___ |

---

## C. PROPOSED ADDITIONS — fast-food / cheap-snack chains NOT yet in DB

### C.1 — D-7 cheap snack chains (operator added)

| # | Pattern | Coverage | Mark |
|---|---|---|---|
| C1 | `auntie anne` | US pretzel kiosk | ___ |
| C2 | `wetzel's pretzel` | US pretzel kiosk | ___ |
| C3 | `mrs. fields` / `mrs fields` | US cookie chain | ___ |
| C4 | `tiff's treats` | US cookie chain | ___ |
| C5 | `cinnabon` | US/global cinnamon roll | ___ |
| C6 | `pinkberry` | US/global yogurt | ___ |
| C7 | `yogen früz` / `yogen fruz` | US/Canada yogurt | ___ |
| C8 | `menchie's` | US yogurt | ___ |
| C9 | `einstein` (catches Einstein Bros / Bagels) | US bagel chain | ___ |
| C10 | `bruegger's` | US bagel chain | ___ |
| C11 | `nathan's famous` | US hot dog | ___ |
| C12 | `hot dog on a stick` | US mall kiosk | ___ |

### C.2 — Coffee chains NOT in current blacklist

| # | Pattern | Coverage | Mark |
|---|---|---|---|
| C13 | `caffè nero` / `caffe nero` | UK coffee chain | ___ |
| C14 | `peet's coffee` | US coffee chain | ___ |
| C15 | `second cup` | Canada coffee chain | ___ |
| C16 | `au bon pain` | US bakery-cafe chain | ___ |
| C17 | `tully's coffee` | US/Japan coffee chain | ___ |

---

## D. PROPOSED ADDITIONS — UK chains (current coverage thin)

| # | Pattern | Coverage | Mark |
|---|---|---|---|
| D1 | `leon` | UK healthy fast food | ___ |
| D2 | `itsu` | UK Asian fast casual | ___ |
| D3 | `wasabi` | UK Asian fast casual | ___ |
| D4 | `eat.` (sandwich chain) | UK sandwich chain — defunct? | ___ |
| D5 | `patisserie valerie` | UK bakery-cafe chain | ___ |
| D6 | `wetherspoons` / `j d wetherspoon` | UK chain pub | ___ |
| D7 | `harvester` | UK chain steakhouse | ___ |
| D8 | `bella italia` | UK chain Italian | ___ |
| D9 | `zizzi` | UK chain Italian | ___ |
| D10 | `prezzo` | UK chain Italian | ___ |
| D11 | `frankie & benny` | UK chain American | ___ |
| D12 | `las iguanas` | UK chain Mexican/Latin | ___ |
| D13 | `toby carvery` | UK chain Sunday-roast pub | ___ |
| D14 | `côte` / `cote brasserie` | UK chain French | ___ borderline; may UPGRADE to allowlist |

---

## E. PROPOSED ADDITIONS — Belgium chains

| # | Pattern | Coverage | Mark |
|---|---|---|---|
| E1 | `exki` | Belgian healthy fast casual | ___ |
| E2 | `le pain quotidien` | Belgian bakery-cafe (borderline upscale) | ___ |
| E3 | `lunch garden` | Belgian cafeteria chain | ___ |
| E4 | `pizza belgium` (any pattern?) | Operator know any Belgian pizza chain? | ___ |

---

## F. PROPOSED ADDITIONS — France chains

| # | Pattern | Coverage | Mark |
|---|---|---|---|
| F1 | `flunch` | French cafeteria-style chain | ___ |
| F2 | `buffalo grill` | French chain steakhouse | ___ |
| F3 | `la boucherie` | French chain steakhouse | ___ |
| F4 | `paul ` (with trailing space) | French chain bakery | ___ |
| F5 | `brioche dorée` | French chain bakery | ___ |
| F6 | `class' croute` / `class'croute` | French chain sandwich | ___ |
| F7 | `pomme de pain` | French chain sandwich | ___ |
| F8 | `léon de bruxelles` | France/Belgium mussels chain | ___ |
| F9 | `pizza hut` (already in B.1 #14, applies in France too) | n/a | n/a |

---

## G. PROPOSED ADDITIONS — Germany chains

| # | Pattern | Coverage | Mark |
|---|---|---|---|
| G1 | `vapiano` | German-origin casual Italian (international) | ___ |
| G2 | `block house` | German chain steakhouse | ___ |
| G3 | `backwerk` | German bakery chain | ___ |
| G4 | `wienerwald` | German chicken chain | ___ |
| G5 | `kamps` | German bakery chain | ___ |

---

## H. PROPOSED ADDITIONS — Spain chains

| # | Pattern | Coverage | Mark |
|---|---|---|---|
| H1 | `lizarrán` / `lizarran` | Spanish tapas chain | ___ |
| H2 | `100 montaditos` | Spanish mini-sandwich chain | ___ |
| H3 | `vips ` | Spanish casual diner chain | ___ |
| H4 | `tagliatella` | Spanish chain Italian | ___ |
| H5 | `goiko` | Spanish chain burger | ___ |

---

## I. PROPOSED ADDITIONS — Lagos / Nigeria chains (current coverage near-zero — high priority)

| # | Pattern | Coverage | Mark |
|---|---|---|---|
| I1 | `chicken republic` | Nigerian fast-food chicken | ___ |
| I2 | `mr bigg's` / `mr biggs` | Nigerian fast food / bakery | ___ |
| I3 | `tantalizers` | Nigerian fast food | ___ |
| I4 | `sweet sensation` | Nigerian fast food | ___ |
| I5 | `the place` | Nigerian casual food chain | ___ |
| I6 | `domino's` (already in B.1 #12) | Yes — many Lagos branches | n/a |
| I7 | `kfc` (already in B.1 #3) | Yes — many Lagos branches | n/a |
| I8 | Operator-knowledge gap — **operator please add any Lagos chains we missed** | ___ |

---

## J. CASUAL_CHAIN_BLACKLIST — current entries upgraded from CASUAL_CHAIN_DEMOTION

Per D-3 + D-6 — full-service casual chains BLACKLIST (was DEMOTE-only). 21 entries currently:

| # | Pattern | Region | Mark |
|---|---|---|---|
| J1 | `olive garden` | US | ___ |
| J2 | `red lobster` | US | ___ |
| J3 | `outback` | US/global | ___ |
| J4 | `cheesecake factory` | US | ___ |
| J5 | `applebee` | US | ___ |
| J6 | `chili's` | US | ___ |
| J7 | `tgi friday` | US/global | ___ |
| J8 | `denny's` | US | ___ |
| J9 | `ihop` | US | ___ |
| J10 | `waffle house` | US | ___ |
| J11 | `cracker barrel` | US | ___ |
| J12 | `texas roadhouse` | US | ___ |
| J13 | `red robin` | US | ___ |
| J14 | `buffalo wild wings` | US | ___ |
| J15 | `longhorn steakhouse` | US | ___ |
| J16 | `nando's` | UK/global | ___ |
| J17 | `wagamama` | UK/global | ___ |
| J18 | `yo! sushi` | UK | ___ |
| J19 | `pizza express` | UK | ___ |
| J20 | `pizzaexpress` | UK (no-space variant) | ___ |
| J21 | `hippopotamus` | France steakhouse | ___ |

### J-additions — D-6 mid-tier chains (operator confirmed BLANKET-EXCLUDE for v1)

| # | Pattern | Region | Mark |
|---|---|---|---|
| J22 | `california pizza kitchen` | US | ___ |
| J23 | `p.f. chang` / `pf chang` | US/global | ___ |
| J24 | `bonefish grill` | US | ___ |
| J25 | `carrabba's` | US | ___ |
| J26 | `j. alexander's` | US (borderline upscale; operator may UPGRADE to allowlist) | ___ |
| J27 | `houston's` / `hillstone` | US (borderline upscale; operator may UPGRADE to allowlist) | ___ |
| J28 | `bj's restaurant` | US | ___ |
| J29 | `maggiano's little italy` | US | ___ |
| J30 | `yard house` | US | ___ |
| J31 | `brio tuscan` | US | ___ |
| J32 | `bahama breeze` | US | ___ |
| J33 | `seasons 52` | US (borderline upscale) | ___ |

---

## K. UPSCALE_CHAIN_ALLOWLIST — current entries (24, allowlist that bypasses B12)

Operator confirms which are date-worthy enough to admit despite chain status:

| # | Pattern | Mark |
|---|---|---|
| K1 | `nobu` | ___ |
| K2 | `morton's` | ___ |
| K3 | `nusr-et` (Salt Bae) | ___ |
| K4 | `salt bae` | ___ |
| K5 | `perry's steakhouse` | ___ |
| K6 | `capital grille` | ___ |
| K7 | `ruth's chris` | ___ |
| K8 | `fleming's` | ___ |
| K9 | `eddie v's` | ___ |
| K10 | `del frisco's` | ___ |
| K11 | `mastro's` | ___ |
| K12 | `stk ` (with trailing space) | ___ |
| K13 | `boa steakhouse` | ___ |
| K14 | `peter luger` | ___ |
| K15 | `smith & wollensky` | ___ |
| K16 | `the palm` | ___ |
| K17 | `lawry's` | ___ |
| K18 | `cut by wolfgang` | ___ |
| K19 | `bazaar` (José Andrés) | ___ |
| K20 | `jean-georges` | ___ |
| K21 | `le bernardin` | ___ |
| K22 | `eleven madison` | ___ |
| K23 | `alinea` | ___ |
| K24 | `per se` | ___ |

### K-additions — proposed

| # | Pattern | Why allowlist | Mark |
|---|---|---|---|
| K25 | `gordon ramsay` | Multi-location upscale (Gordon Ramsay's Hell's Kitchen, Bread Street Kitchen) | ___ |
| K26 | `the ivy` | London upscale chain | ___ |
| K27 | `hawksmoor` | UK upscale steakhouse chain | ___ |
| K28 | `daniel boulud` / `db bistro` | NYC + global | ___ |
| K29 | `cipriani` | NYC + global | ___ |
| K30 | `carbone` | NYC + global high-end Italian | ___ |
| K31 | `joël robuchon` / `l'atelier de joël robuchon` | Global Michelin | ___ |

---

## L. Open operator notes / catch-all

Operator can add anything I missed here:

```
+ "<chain name>" — region: ___, list: FAST_FOOD / CASUAL / UPSCALE_ALLOW
+ ...
```

---

## What happens after operator markup

1. SPEC author reads operator markup.
2. Updates the EXCLUDED_FAST_FOOD_TYPES + FAST_FOOD_NAME_PATTERNS + CASUAL_CHAIN_NAME_PATTERNS + UPSCALE_CHAIN_ALLOWLIST arrays.
3. SPEC body locks at `Mingla_Artifacts/specs/SPEC_ORCH-0735_BOUNCER_CHAIN_FAST_FOOD_RULES.md` with the agreed entries.
4. Orchestrator presents locked SPEC to operator.
5. Operator dispatches IMPLEMENTOR.

**Operator time budget for this review: ~30 minutes.** Don't over-think edge cases. Easier to add chains in a follow-up commit than to delay shipping the v1 fix.

If the operator marks ZERO changes, the SPEC ships with all the proposed additions baked in (default-accept). Mark explicit `❌ SKIP` to reject any proposed addition.
