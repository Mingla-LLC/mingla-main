# SPEC — ORCH-0670 Slice A: User-visible breakage on Concerts & Events

**Spec writer:** mingla-forensics (SPEC mode)
**Date:** 2026-04-28
**ORCH-ID:** ORCH-0670 (Slice A only — Slices B/C/D deferred)
**Severity:** S1 (always-broken UX visible to every user worldwide)
**Investigation:** [reports/INVESTIGATION_ORCH-0670_RENDERED_SURFACE_AUDIT.md](../reports/INVESTIGATION_ORCH-0670_RENDERED_SURFACE_AUDIT.md) — REVIEW APPROVED 10/10 (render-first, ground-truth)
**Dispatch:** [prompts/SPEC_ORCH-0670_SLICE_A_USER_VISIBLE_BREAKAGE.md](../prompts/SPEC_ORCH-0670_SLICE_A_USER_VISIBLE_BREAKAGE.md)

---

## §1 Layman summary

The Concerts & Events surface (entire Discover screen) has 5 always-broken defects every user hits regardless of locale or platform: (1) error / empty / no-match screens render literal `discover:empty.no_events_title` strings instead of real copy because 7 i18n keys are missing in en + 28 other locales; (2) the price tier chips inside the Filter modal (Chill/Comfy/Bougie/Lavish) are inert — tapping them does nothing while the badge counter on the top-bar Filters chip falsely advertises filter activity; (3) the screen title is hardcoded English `"Concerts & Events"` (foreign-language users see English); (4) the top-bar date chip labels are hardcoded English too (same problem, same scope); (5) the screen title autoshrinks aggressively on Android because the title uses `adjustsFontSizeToFit` + `minimumFontScale={0.7}` — making it visibly smaller than (a) the iOS Discover title and (b) the Friends-screen header on the same Android device.

This spec ships the fix in one bundled commit. ~4-5 hours wall time. OTA-eligible. No DB / no edge fn / no native module changes (assuming OQ-2 = Option a — rename). 12 orphan i18n keys cleaned up bundled in.

---

## §2 Hard locks from operator steering (verbatim from dispatch §B + §H)

| # | Decision | Locked value |
|---|---|---|
| 1 | Slice scope | **Slice A only** — RC-1 i18n key drift + RC-2 tier chip filtering + HF-4/HF-5 hardcoded English chips + screen title + CF-1 title-vs-segment mismatch + Android header alignment. Slices B/C/D explicitly deferred. |
| 2 | i18n locale parity | **Option B — full 29-locale translation pass.** Matches ORCH-0685 cycle-1 + ORCH-0690 cycle-1 precedent. |
| 3 | Tier-chip fix shape | **OPERATOR DECISION — OQ-1.** Default-yes recommendation: Option (a) extend switch using `PRICE_TIERS` constant. |
| 4 | Title resolution | **OPERATOR DECISION — OQ-2.** Default-yes recommendation: Option (a) rename `"Concerts & Events"` → `"Concerts"` (smallest fix, preserves OTA-eligibility). |
| 5 | Android header alignment | **OPERATOR DECISION — OQ-3.** Spec writer has read Friends-screen baseline; recommended resolution is align Discover to Friends pattern (lineHeight 32→36, REMOVE `adjustsFontSizeToFit + minimumFontScale={0.7}`, add `textAlignVertical: 'center'`). |
| 6 | Filters badge counter | After S-2 lands, `moreChipBadgeCount` becomes truthful via behavior change (not code change). No code change needed at [DiscoverScreen.tsx:1112-1113](app-mobile/src/components/DiscoverScreen.tsx#L1112-L1113). |
| 7 | OTA-eligibility | Required (mobile + i18n only — NO DB / NO edge fn / NO native module). |

---

## §3 Scope (8 deliverables)

| ID | Item | Investigation reference |
|---|---|---|
| **S-1** | Add 7 missing i18n keys to en/discover.json (RC-1 fix) | RC-1 (§3.2 GRID-02/03/04) |
| **S-2** | Make Chill/Comfy/Bougie/Lavish filter chips actually filter (per OQ-1 resolution) | RC-2 (§3.4) |
| **S-3** | i18n the top-bar chip labels (5 hardcoded English literals → t() calls) | HF-4 |
| **S-4** | i18n the screen title (hardcoded English → t('discover:title')) | HF-5 |
| **S-5** | Resolve title-vs-segment mismatch (per OQ-2 resolution) | CF-1 |
| **S-6** | Align Discover header to Friends-screen baseline (per OQ-3 resolution) | Operator field-test |
| **S-7** | Delete 14 orphan i18n keys in en/discover.json + 28 locales (~420 dead translations) | §4.2 + spec writer's verification of `loading.*` keys |
| **S-8** | Cycle-1 locale parity pass: translate all new keys × 28 non-en locales | OQ-2 i18n parity lock |

---

## §4 Non-goals (explicit — do NOT include)

| Non-goal | Reason |
|---|---|
| RC-3 date filter cache poisoning | Slice B scope |
| HF-1 genre keyword → classificationName | Slice B (NEEDS-LIVE-FIRE) |
| HF-2 TBA-price visibility | Slice B (depends on RC-2) |
| CF-2 currency double-conversion | Slice B (edge fn redeploy) |
| CF-3 handleRefresh radius unchanged | Slice C |
| All IMP-* improvability items | Future slices |
| Expanded modal redesign | ORCH-0696 (parallel ORCH) |
| Bottom-sheet conversion of any modal | ORCH-0696 |
| New CI gates | This is content/copy/styling — not structural-drift class |
| Native module changes | Out of scope; OTA-eligibility required |
| Locale parity verification beyond `expanded_details.json` | This spec touches `discover.json` only; common.json is verified-stable for tier_* keys (already used by Filter modal) |

---

## §5 Per-layer specification

### §5.1 Component layer ([DiscoverScreen.tsx](app-mobile/src/components/DiscoverScreen.tsx))

#### §5.1.1 Top-bar chip JSX (S-3)

**File:** [DiscoverScreen.tsx:1238-1294](app-mobile/src/components/DiscoverScreen.tsx#L1238-L1294)

**Current:**
- Line 1239: `label="All"` (hardcoded literal)
- Line 1246: `label="Tonight"` (hardcoded literal)
- Line 1253: `label="This Weekend"` (hardcoded literal)
- Line 1260: `label="Next Week"` (hardcoded literal)
- Line 1267: `label="This Month"` (hardcoded literal)
- Line 1293: `label="Filters"` (hardcoded literal)

**Required:**
- `label={t("discover:filters.all_dates_short")}` — NEW key (avoids overloading existing `any_date` = "Any Date" used by modal Date section)
- `label={t("discover:filters.tonight")}` — NEW key (preserves operator's UX intent; modal Date section uses different `today` = "Today")
- `label={t("discover:filters.this_weekend")}` — REUSE existing key
- `label={t("discover:filters.next_week")}` — REUSE existing key
- `label={t("discover:filters.this_month")}` — REUSE existing key
- `label={t("discover:filters.button")}` — REUSE existing key

#### §5.1.2 Screen title JSX (S-4 + S-5)

**File:** [DiscoverScreen.tsx:1218-1227](app-mobile/src/components/DiscoverScreen.tsx#L1218-L1227)

**Current:**
```tsx
<Text
  style={styles.titleText}
  numberOfLines={1}
  adjustsFontSizeToFit
  minimumFontScale={0.7}
  accessibilityRole="header"
  allowFontScaling
>
  Concerts & Events
</Text>
```

**Required (after S-4 + S-5 + S-6 land — single edit):**
```tsx
<Text
  style={styles.titleText}
  numberOfLines={1}
  accessibilityRole="header"
  allowFontScaling
>
  {t("discover:title")}
</Text>
```

Changes:
- Replace literal `"Concerts & Events"` with `t("discover:title")` (S-4)
- Title key value depends on **OQ-2 resolution**:
  - Option (a) [recommended]: `"Concerts"` — title key resolves to "Concerts" in English; segmentId music-only lock unchanged at edge fn
  - Option (b): `"Concerts & Events"` — title preserved verbatim BUT edge fn segmentId expansion required (out of OTA path); spec writer flags as Slice C
- **DELETE** `adjustsFontSizeToFit` and `minimumFontScale={0.7}` props (S-6)
- All other props preserved

#### §5.1.3 `styles.titleText` (S-6 — Android header alignment)

**File:** [DiscoverScreen.tsx:1612-1620](app-mobile/src/components/DiscoverScreen.tsx#L1612-L1620)

**Current:**
```ts
titleText: {
  fontSize: d.title.fontSize,        // 32
  fontWeight: d.title.fontWeight,    // '700'
  lineHeight: 32,                    // ← cramped (= fontSize, no headroom)
  color: d.title.color,              // '#FFFFFF'
  // Counter iOS font leading so the glyphs sit tight to the top of the band.
  marginTop: Platform.OS === "ios" ? -4 : 0,
  includeFontPadding: false,
},
```

**Required (matches Friends-screen baseline at [ConnectionsPage.tsx:3021-3028](app-mobile/src/components/ConnectionsPage.tsx#L3021-L3028)):**
```ts
titleText: {
  fontSize: d.title.fontSize,        // 32 (unchanged)
  fontWeight: d.title.fontWeight,    // '700' (unchanged)
  lineHeight: 36,                    // ← +4pt headroom matching Friends-screen
  color: d.title.color,              // '#FFFFFF' (unchanged)
  // Counter iOS font leading so glyphs sit tight to top of band.
  marginTop: Platform.OS === "ios" ? -4 : 0,  // (unchanged)
  includeFontPadding: false,         // (unchanged)
  textAlignVertical: 'center',       // ← NEW — Android-specific cue to center vertically; matches Friends pattern
},
```

**Why this fixes operator's "Android header smaller" finding:**

Current code uses `adjustsFontSizeToFit + minimumFontScale={0.7}` on the title (lines 1221-1222). On Android, font rendering produces slightly different glyph widths than iOS for the same `fontSize: 32`. A title that fits at 32pt on iOS often does NOT fit at 32pt on Android within the same Modal width (375pt iPhone vs 360pt typical Android). On Android, `adjustsFontSizeToFit` then aggressively shrinks the title to ~22-26pt to make it fit on one line. iOS doesn't autoshrink because the title fits at full 32pt.

The Friends-screen header at [ConnectionsPage.tsx:3021-3028](app-mobile/src/components/ConnectionsPage.tsx#L3021-L3028) does NOT use `adjustsFontSizeToFit` — it relies on `numberOfLines: 1` to ellipsize if overflow occurs (Friends title `t('connections:title')` is short enough to not overflow). Removing `adjustsFontSizeToFit` from Discover title means: title either fits at full 32pt (if short enough — which "Concerts" easily does, OR "Concerts & Events" might at full 32pt on most devices) OR ellipsizes via `numberOfLines: 1`.

The `lineHeight: 32` (vs Friends' 36) gives the title NO vertical breathing room — even when it renders at full 32pt, the glyphs sit cramped. Increasing to 36 matches Friends' visual rhythm.

`textAlignVertical: 'center'` is an Android-only style that explicitly centers the text vertically in its container — without it, Android may align text to the top of the line height (visible as more empty space below the glyph than above on Android, but not iOS).

**Combined effect:** Discover header on Android renders at the SAME visual size and position as iOS Discover header AND as Friends-screen header.

#### §5.1.4 Price filter switch (S-2)

**File:** [DiscoverScreen.tsx:1080-1110](app-mobile/src/components/DiscoverScreen.tsx#L1080-L1110)

**Operator decides via OQ-1 — default-yes Option (a) extend switch:**

**Current:**
```ts
const filteredNightOutCards = useMemo(() => {
  let filtered = nightOutCards;
  if (selectedFilters.price !== "any") {
    filtered = filtered.filter((card) => {
      if (card.priceMin === null && card.priceMax === null) return false;
      const min = card.priceMin || 0;
      const max = card.priceMax || min;
      switch (selectedFilters.price) {
        case "free":
          return max === 0;
        case "under-25":
          return min < 25;
        case "25-50":
          return min <= 50 && max >= 25;
        case "50-100":
          return min <= 100 && max >= 50;
        case "over-100":
          return max > 100;
        default:
          return true;
      }
    });
  }
  // ... sort + return
}, [nightOutCards, selectedFilters.price]);
```

**Required (Option a — extend switch with PRICE_TIERS constant):**
```ts
import { TIER_BY_SLUG, type PriceTierSlug } from '../constants/priceTiers';

const filteredNightOutCards = useMemo(() => {
  let filtered = nightOutCards;
  if (selectedFilters.price !== "any") {
    filtered = filtered.filter((card) => {
      if (card.priceMin === null && card.priceMax === null) return false;
      const min = card.priceMin || 0;
      const max = card.priceMax || min;

      // Look up tier bounds from the canonical PRICE_TIERS constant.
      // [ORCH-0670 Slice A S-2] tier slug emitted by chips at line 1126-1128
      // now matches the filter switch via TIER_BY_SLUG. Removes the
      // dual-taxonomy bug class.
      const tier = TIER_BY_SLUG[selectedFilters.price as PriceTierSlug];
      if (!tier) return true;  // unknown slug — pass-through (defensive)

      // Filter logic: card range overlaps tier range.
      // tier.max === null → upper bound is infinity (lavish).
      const tierMin = tier.min;
      const tierMax = tier.max ?? Number.POSITIVE_INFINITY;

      // Overlap check: card.range AND tier.range have non-empty intersection.
      // - card range: [min, max]
      // - tier range: [tierMin, tierMax]
      // Overlap iff: min <= tierMax AND max >= tierMin
      return min <= tierMax && max >= tierMin;
    });
  }
  filtered = [...filtered].sort((a, b) => {
    const dateA = a.localDate || "9999-12-31";
    const dateB = b.localDate || "9999-12-31";
    return dateA.localeCompare(dateB);
  });
  return filtered;
}, [nightOutCards, selectedFilters.price]);
```

**Behavior:**

| Selected | Tier range | Filter passes if event range overlaps |
|---|---|---|
| `chill` | $0–$50 | event has any ticket ≤ $50 |
| `comfy` | $50–$150 | event has tickets in $50-$150 band (overlap) |
| `bougie` | $150–$300 | event has tickets in $150-$300 band |
| `lavish` | $300+ | event has any ticket ≥ $300 |
| `any` | (early-out at line 1083) | all cards pass |

**The 5 legacy switch cases (`free`, `under-25`, `25-50`, `50-100`, `over-100`) are DELETED** because:
- The chip generator at [line 1124-1130](app-mobile/src/components/DiscoverScreen.tsx#L1124-L1130) only emits `any`/`chill`/`comfy`/`bougie`/`lavish` slugs
- No production code path emits the legacy IDs
- Constitution #8 (subtract before add) — delete dead code as part of the fix

**Implementor note:** verify `priceFilterOptions` at line 1124-1130 still emits tier slugs (`tier.slug as PriceFilter`). The generator imports `PRICE_TIERS` from `priceTiers.ts` so it stays in sync automatically.

#### §5.1.5 Filter badge counter (S-2 transitive fix)

**File:** [DiscoverScreen.tsx:1112-1113](app-mobile/src/components/DiscoverScreen.tsx#L1112-L1113)

**Current:**
```ts
const moreChipBadgeCount =
  (selectedFilters.price !== "any" ? 1 : 0) + (selectedFilters.genre !== "all" ? 1 : 0);
```

**Required:** UNCHANGED. After S-2 fix, the price filter actually filters when a non-`any` tier is selected, so the counter accurately reflects "an active price filter is set." The counter logic was always correct — it was the filter behavior that was broken. S-2 transitively repairs the apparent dishonesty.

**Implementor note:** add a protective comment above this line:
```ts
// [ORCH-0670 Slice A S-2 lock-in] After S-2, tier slugs (chill/comfy/bougie/lavish)
// actually filter via TIER_BY_SLUG. The badge counter accurately reflects active filters.
// Do NOT modify this calculation without first confirming the price-filter switch still
// honors the tier-slug → range mapping at line 1080+.
const moreChipBadgeCount = ...
```

### §5.2 i18n layer ([app-mobile/src/i18n/locales/en/discover.json](app-mobile/src/i18n/locales/en/discover.json))

#### §5.2.1 New keys to add (10 total)

**RC-1 keys (7):**

| Key | English copy |
|---|---|
| `error.subtitle` | `"Pull down to retry, or check your connection."` |
| `empty.no_events_title` | `"No events near you tonight"` |
| `empty.no_events_subtitle` | `"Try a wider date range or different vibe."` |
| `empty.expand_radius` | `"Try Again"` *(NOTE: Slice C will rename to "Expand radius" + actually expand radius; for Slice A, label matches actual handler behavior which is just re-fetch)* |
| `empty.no_match_title` | `"No events match your filters"` |
| `empty.no_match_subtitle` | `"Adjust filters or reset to see more."` |
| `empty.reset_filters` | `"Reset Filters"` |

**S-3 + S-4 keys (3):**

| Key | English copy | Origin |
|---|---|---|
| `filters.all_dates_short` | `"All"` | NEW (top-bar chip; avoids overloading `any_date` = "Any Date" used by modal) |
| `filters.tonight` | `"Tonight"` | NEW (top-bar chip; preserves operator's UX intent vs modal's `today` = "Today") |
| `title` | (depends on OQ-2: `"Concerts"` or `"Concerts & Events"`) | NEW |

**Total new keys for English:** **10**

#### §5.2.2 Orphan key cleanup (S-7) — 14 keys to delete

Verified zero consumers across `app-mobile/src/`:

| Key | Verified-orphan? |
|---|---|
| `empty.no_events` | ✓ orphan (code uses `no_events_title`) |
| `empty.no_events_nearby` | ✓ orphan |
| `empty.no_matching` | ✓ orphan (code uses `no_match_title`) |
| `empty.no_matching_filters` | ✓ orphan |
| `empty.show_all_parties` | ✓ orphan |
| `empty.adjust_preferences` | ✓ orphan |
| `empty.no_experiences` | ✓ orphan |
| `error.try_again` | ✓ orphan (code uses `error.retry`) |
| `loading.for_you` | ✓ orphan (verified by `grep "discover:loading.for_you"` returns 0 matches) |
| `loading.nightlife` | ✓ orphan (same verification) |
| `nightout.on_sale` | ✓ orphan (badge labels are hardcoded `"SOLD OUT"`/`"SOON"` at [DiscoverScreen.tsx:292-298](app-mobile/src/components/DiscoverScreen.tsx#L292-L298)) |
| `nightout.sold_out` | ✓ orphan |
| `nightout.soon` | ✓ orphan |
| `nightout.tba` | ✓ orphan |

**Implementor MUST re-verify each orphan with a fresh grep before deletion** — the dispatch §E.2.2 noted `loading.*` keys "may be used elsewhere" but spec writer's verification confirms zero consumers in `app-mobile/src/`. If spec writer's grep was incomplete (e.g., admin or supabase-functions also reference these keys), implementor's re-verify is the safety net. Recommended verification pattern:

```bash
for key in "empty.no_events" "empty.no_events_nearby" "empty.no_matching" "empty.no_matching_filters" "empty.show_all_parties" "empty.adjust_preferences" "empty.no_experiences" "error.try_again" "loading.for_you" "loading.nightlife" "nightout.on_sale" "nightout.sold_out" "nightout.soon" "nightout.tba"; do
  echo "=== $key ==="
  grep -rn "discover:$key" app-mobile/src 2>&1 | head -3
done
```

If any returns matches, halt and escalate to orchestrator before deleting.

#### §5.2.3 Locale parity (S-8) — Option B = full 29 locales

All 10 new keys translate to all 28 non-en locales = **280 new translations**. All 14 orphan keys delete from all 28 non-en locales = **~336 cleanup deletions** (some locales may already be missing some orphans — implementor uses the Python script approach from ORCH-0685 cycle-1 / ORCH-0690 cycle-1 for batch translation + cleanup).

Implementor writes a script at `scripts/orch-0670-translate-locales.py` modeled on `scripts/orch-0690-translate-locales.py`. Translations sourced manually for native quality. `{{xxx}}` interpolation tokens preserved verbatim across all locales (none in this set — all keys use static copy except `error.subtitle` could optionally interpolate but kept plain).

#### §5.2.4 Final i18n change accounting

| Action | Count |
|---|---|
| New keys added (en) | 10 |
| New translations across 28 other locales | 280 |
| Orphan keys deleted (en) | 14 |
| Orphan translations deleted across 28 other locales | up to 392 (depending on per-locale presence) |
| **Net effect on en/discover.json** | -4 lines (10 new - 14 deleted) + value changes |
| **Net effect across 28 non-en locales** | -3 to -4 lines per locale ≈ -84 to -112 lines total cleanup |

### §5.3 Service / hook / DB / edge fn / RLS / native module layers

**ALL N/A.** Mobile-only fix. OTA-eligible. No request body or response shape changes; no DB / edge fn / RLS impacts.

**Exception:** if operator picks Option (b) for OQ-2 (expand TM segment), edge fn changes are required and OTA-eligibility is broken. Spec writer surfaces this hard tradeoff clearly in OQ-2.

---

## §6 Success criteria (numbered, testable, observable)

| # | Criterion | Verification |
|---|---|---|
| **SC-1** | Empty state on Discover renders friendly English "No events near you tonight" / "Try a wider date range or different vibe." / "Try Again" — NOT literal i18n key strings | Visual on device with empty state forced |
| **SC-2** | Filter no-match state renders friendly English "No events match your filters" / "Adjust filters or reset to see more." / "Reset Filters" | Visual on device with filter no-match forced |
| **SC-3** | Error state renders friendly English error subtitle (non-empty) | Visual on device with simulated network failure |
| **SC-4** | Tapping any of Chill / Comfy / Bougie / Lavish in the Filter modal filters the event grid via TIER_BY_SLUG range overlap | Tap Chill on a venue with mixed prices; observe grid contracts to events with min ≤ $50; observe Filters chip badge counter shows `1` |
| **SC-5** | Tapping "Any Price" in the Filter modal restores the full grid; badge clears to `0` | Tap Any Price after Chill is active; observe grid restores |
| **SC-6** | All 6 top-bar chip labels (All / Tonight / Weekend / Next Week / Month / Filters) render in user's locale | Switch app language to Spanish/Japanese/Arabic; observe chips translate |
| **SC-7** | Screen title renders in user's locale | Switch app language to Spanish; observe title becomes Spanish equivalent |
| **SC-8** | Title literal matches data shown — Option (a): title = "Concerts" + grid contains music events only; Option (b): title = "Concerts & Events" + grid contains at least one non-music event | Visual; depends on OQ-2 resolution |
| **SC-9** | Android Discover header renders at the SAME visual size as iOS Discover header | Side-by-side device comparison |
| **SC-10** | Android Discover header renders at the SAME visual size as Friends-screen header on the same Android device | Side-by-side device comparison |
| **SC-11** | All 10 new i18n keys present in en/discover.json + 28 other locales | grep / locale-parity script |
| **SC-12** | All 14 orphan i18n keys (verified subset) deleted from en + 28 other locales | grep — keys do NOT appear in any json |
| **SC-13** | tsc clean — zero new errors above baseline (3 pre-existing in untouched files) | `cd app-mobile && npx tsc --noEmit` |
| **SC-14** | Filter badge counter on top-bar Filters chip increments only when a filter is actually active | Visual: tap any tier chip → badge shows 1; tap Any Price → badge shows 0 |
| **SC-15** | Filter switch deletes legacy band IDs (`free`, `under-25`, `25-50`, `50-100`, `over-100`) — only tier slugs handled | grep `case "under-25":` returns 0 matches; grep `case "chill":` (or equivalent — depends on implementation choice) returns 1 match OR is consumed via `TIER_BY_SLUG` lookup |

---

## §7 Test cases (mapped to SCs)

| ID | Scenario | Input | Expected | Maps to SC |
|---|---|---|---|---|
| T-01 | Empty state copy | force `nightOutCards: []`, `loading: false`, `error: null` | "No events near you tonight" / "Try a wider date range or different vibe." / "Try Again" — NO literal keys | SC-1 |
| T-02 | Filter no-match copy | force `nightOutCards.length > 0` AND `filteredNightOutCards.length === 0` | "No events match your filters" / "Adjust filters or reset to see more." / "Reset Filters" | SC-2 |
| T-03 | Error state copy | kill network during fetch | "Something went wrong" / [non-empty subtitle] / "Retry" | SC-3 |
| T-04 | Tier filter — Chill | tap Chill chip; venue has events at $30, $80, $200 | grid contracts to $30 event only (min ≤ $50); badge shows 1 | SC-4 / SC-14 |
| T-05 | Tier filter — Comfy | tap Comfy chip; same venue | grid shows $80 event only (in $50-$150 band) | SC-4 |
| T-06 | Tier filter — Bougie | tap Bougie chip; same venue | grid shows $200 event only (in $150-$300 band) | SC-4 |
| T-07 | Tier filter — Lavish | tap Lavish chip; venue has $400 event | grid shows $400 event only (≥ $300) | SC-4 |
| T-08 | Tier reset — Any Price | tap Any Price after Chill active | grid restores; badge shows 0 | SC-5 / SC-14 |
| T-09 | Top-bar i18n — Spanish | switch to Spanish locale | All 6 top-bar chips render in Spanish | SC-6 |
| T-10 | Title i18n — Japanese | switch to Japanese locale | Title in Japanese | SC-7 |
| T-11 | Title-data match | confirm grid contains music events only | (Option a) Title = "Concerts" / (Option b) Title = "Concerts & Events" + grid contains non-music | SC-8 |
| T-12 | Android header size | open Discover on Android device | Header visually matches iOS Discover header (same fontSize 32, same lineHeight 36, no autoshrink artifact) | SC-9 |
| T-13 | Cross-screen header size | navigate Discover → Friends on same Android device | Discover header visually matches Friends header | SC-10 |
| T-14 | Long title overflow handling | with `title = "Concerts & Events"` (Option b only), test on iPhone SE 320pt | Title ellipsizes via numberOfLines:1 (does NOT autoshrink to ~22pt anymore) | SC-9 |
| T-15 | i18n parity script | run `node scripts/check-locale-parity.js discover.json` (or equivalent) | All 10 new keys present in 29 locales; 14 orphans absent | SC-11 / SC-12 |
| T-16 | tsc baseline | `cd app-mobile && npx tsc --noEmit` | 3 baseline errors only | SC-13 |
| T-17 | Multi-active filter badge | tap Chill + tap Afrobeats genre | Badge counter shows 2 | SC-14 |
| T-18 | Legacy switch case grep | `grep "under-25\\|case \"free\"" app-mobile/src/components/DiscoverScreen.tsx` | 0 matches (all dead branches deleted) | SC-15 |

---

## §8 Implementation order (numbered)

| # | Step | Files |
|---|---|---|
| **1** | Read full DiscoverScreen.tsx + en/discover.json + en/common.json + ConnectionsPage.tsx (Friends-screen baseline reference at lines 3021-3028) + priceTiers.ts | (read-only) |
| **2** | Resolve OQ-1 (tier-chip fix shape) + OQ-2 (title resolution) by re-reading hard-lock decisions; if unresolved, halt | — |
| **3** | Verify all 14 orphan keys per §5.2.2 grep pattern | en/discover.json + grep |
| **4** | Add 10 new keys to en/discover.json with English copy from §5.2.1 | en/discover.json |
| **5** | Delete 14 orphan keys from en/discover.json | en/discover.json |
| **6** | Replace 6 hardcoded top-bar chip labels at DiscoverScreen.tsx:1239-1294 with `t(...)` calls per §5.1.1 | DiscoverScreen.tsx |
| **7** | Replace hardcoded title literal at DiscoverScreen.tsx:1226 with `t("discover:title")` per §5.1.2 (S-4 + S-5) | DiscoverScreen.tsx |
| **8** | Apply OQ-2 resolution: if Option (a), title key = "Concerts"; if Option (b), title key = "Concerts & Events" + edge fn segment expansion (out of OTA path — ESCALATE if Option b) | en/discover.json + (possibly) edge fn |
| **9** | DELETE `adjustsFontSizeToFit` and `minimumFontScale={0.7}` props from title `<Text>` per §5.1.2 (S-6) | DiscoverScreen.tsx |
| **10** | Update `styles.titleText` per §5.1.3: `lineHeight: 32 → 36` + add `textAlignVertical: 'center'` (S-6) | DiscoverScreen.tsx |
| **11** | Apply OQ-1 resolution: extend price-filter switch per §5.1.4 (Option a — TIER_BY_SLUG range overlap); add `import { TIER_BY_SLUG, type PriceTierSlug } from '../constants/priceTiers';` if not present | DiscoverScreen.tsx |
| **12** | Delete the 5 legacy switch cases (`free` / `under-25` / `25-50` / `50-100` / `over-100`) — replaced by TIER_BY_SLUG lookup | DiscoverScreen.tsx |
| **13** | Add protective comment above `moreChipBadgeCount` per §5.1.5 | DiscoverScreen.tsx |
| **14** | Translate all 10 new keys × 28 other locales = 280 translations via `scripts/orch-0670-translate-locales.py` (modeled on `scripts/orch-0690-translate-locales.py`) | 28 locale files |
| **15** | Delete the 14 orphan keys × 28 other locales (Python script handles cleanup with verification) | 28 locale files |
| **16** | Run `cd app-mobile && npx tsc --noEmit` — confirm 3 baseline errors only (ConnectionsPage:2763, HomePage:246, HomePage:249), zero new | (verify) |
| **17** | Manually exercise T-01..T-18 on a Metro dev build (operator-driven) | (manual smoke) |
| **18** | Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0670_SLICE_A_REPORT.md` per implementor template — include old → new receipts + SC-1..SC-15 verification matrix + transition register (none expected) + discoveries for orchestrator | (report) |

---

## §9 Invariants

### §9.1 Existing invariants — preserved

| ID | Invariant | Status post-fix |
|---|---|---|
| **C-1** | No dead taps | RESTORED — tier chips actually filter; badge counter no longer dishonest |
| **C-3** | No silent failures | RESTORED — error/empty/no-match states show real copy not literal keys |
| **C-7** | No transitional code without exit conditions | UPHELD — no `[TRANSITIONAL]` markers introduced |
| **C-8** | Subtract before adding | UPHELD — 5 legacy switch cases deleted + 14 orphan keys deleted before adding new ones |
| **C-9** | No fabricated data | RESTORED — Filters badge counter no longer falsely advertises filter activity |
| **C-12** | Validate at the right time | UPHELD — `useMemo` recomputes when `selectedFilters.price` changes |
| **I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS** (ORCH-0685 cycle-1) | unchanged — no payload changes | ✅ STILL HOLDS |
| **I-LOCALE-CATEGORY-PARITY** (ORCH-0685 cycle-1) | unchanged — adds new keys per established parity contract (Option B) | ✅ STILL HOLDS (29 × 10 new keys verified) |
| **I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS** (ORCH-0685 cycle-1) | unchanged — no modal changes | ✅ STILL HOLDS |

### §9.2 New invariants — none

This spec adds NO new invariants. The recurring class (mismatched filter taxonomies vs switch IDs) is a one-shot fix; future filters won't accumulate the same pattern as long as they consume `PRICE_TIERS` constant.

**Implementor note:** the `PRICE_TIERS` constant at `app-mobile/src/constants/priceTiers.ts` is the single source of truth — when this fix lands, any future filter taxonomy on Discover MUST consume `TIER_BY_SLUG` lookup, not introduce a new disconnected switch.

---

## §10 Regression prevention

### §10.1 Structural safeguard

The `useMemo` filter consuming `TIER_BY_SLUG[selectedFilters.price]` becomes the single source of truth for "what does Chill/Comfy/Bougie/Lavish mean in $." Future tier changes (e.g., adding "Splurge" tier) update `priceTiers.ts` once; the filter logic adapts automatically via the lookup.

### §10.2 Test

T-04 through T-07 are the regression sentinels. If a future edit breaks the tier-slug → range mapping, these tests fail. Implementor adds an inline JSDoc comment above the `useMemo` block referencing the regression prevention contract:

```ts
/**
 * [ORCH-0670 Slice A S-2 lock-in] Filter consumes PRICE_TIERS via TIER_BY_SLUG.
 * Do NOT add hardcoded USD ranges here — tier ranges live in priceTiers.ts.
 * Regression test: T-04..T-07 verify tier filtering on a venue with mixed prices.
 */
const filteredNightOutCards = useMemo(() => { ... });
```

### §10.3 Protective comment on title

In `styles.titleText` at line 1612-1620, add a protective comment:

```ts
titleText: {
  // [ORCH-0670 Slice A S-6] Do NOT add adjustsFontSizeToFit OR minimumFontScale to
  // the parent <Text>. Android font rendering produces inconsistent autoshrink
  // behavior with iOS, leading to cross-platform header size divergence (operator
  // field-test 2026-04-28). Title MUST fit at full 32pt OR ellipsize via numberOfLines:1.
  // Friends-screen baseline at ConnectionsPage.tsx:3021-3028 is the canonical pattern.
  fontSize: d.title.fontSize,
  ...
}
```

### §10.4 No new CI gate

The recurring class (filter taxonomy mismatch) is too narrow to merit a CI gate. The protective comment + structural safeguard cover regression prevention.

---

## §11 Constitution + invariants checklist (post-fix)

| # | Principle | Pre-fix | Post-fix |
|---|---|---|---|
| 1 | No dead taps | Spirit-violated (tier chips no-op) | RESTORED |
| 2 | One owner per truth | OK | UPHELD (PRICE_TIERS = single source for tier ranges) |
| 3 | No silent failures | Spirit-violated (literal i18n keys shown to user) | RESTORED |
| 4 | One query key per entity | N/A | N/A |
| 5 | Server state stays server-side | OK | OK |
| 6 | Logout clears everything | N/A | N/A |
| 7 | Label temporary fixes | OK | OK (no `[TRANSITIONAL]` markers introduced) |
| 8 | Subtract before adding | OK | UPHELD (5 dead switch cases deleted + 14 orphan keys deleted) |
| 9 | No fabricated data | Spirit-violated (badge counter dishonest) | RESTORED |
| 10 | Currency-aware UI | (Slice B scope — currency double-conversion) | UNCHANGED |
| 11 | One auth instance | N/A | N/A |
| 12 | Validate at the right time | OK | OK (useMemo recomputes on filter change) |
| 13 | Exclusion consistency | N/A | N/A |
| 14 | Persisted-state startup | N/A | N/A |

---

## §12 Open questions (BLOCKING IMPL DISPATCH)

| # | Question | Recommendation |
|---|---|---|
| **OQ-1** | Tier-chip fix shape: Option (a) extend switch with TIER_BY_SLUG, OR Option (b) migrate chip generator to emit band IDs | **Option (a) — extend switch.** PRICE_TIERS is the established Mingla token across deck, saved cards, map. Constitution #2 (one owner per truth) — DiscoverScreen consuming the same token preserves single source of truth. Option (b) creates a parallel ID space that drifts. |
| **OQ-2** | Title resolution: Option (a) rename `"Concerts & Events"` → `"Concerts"` OR Option (b) expand TM segmentId to all event types | **Option (a) — rename.** Smallest fix, preserves OTA-eligibility, no edge-fn redeploy. Option (b) is a future-cycle scope item (touches edge fn + needs Live-fire validation across geographies). |
| **OQ-3** | Android header canonical target size: align to Friends-screen baseline (lineHeight 36, no autoshrink) OR keep iOS Discover at 32pt and adjust Android-specific style branch | **Align to Friends-screen baseline.** Spec writer has read both surfaces and confirms divergence cause is `adjustsFontSizeToFit + minimumFontScale={0.7}` interacting differently with Android font rendering. Removing autoshrink + matching lineHeight 36 produces consistent rendering on both platforms AND matches the Friends-screen pattern (operator's stated "Friends size is canonical" intent). |

Spec writer surfaces all 3 OQs in this spec; orchestrator resolves before IMPL dispatch.

---

## §13 Output contract

Implementor produces:
- `app-mobile/src/components/DiscoverScreen.tsx` — modified per §5.1
- `app-mobile/src/i18n/locales/en/discover.json` — 10 new keys + 14 orphans deleted
- `app-mobile/src/i18n/locales/{ar,bin,bn,de,el,es,fr,ha,he,hi,id,ig,it,ja,ko,ms,nl,pl,pt,ro,ru,sv,th,tr,uk,vi,yo,zh}/discover.json` — 10 new keys × 28 = 280 translations + orphan cleanup
- `scripts/orch-0670-translate-locales.py` — NEW (idempotent translation script per ORCH-0685/0690 precedent)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0670_SLICE_A_REPORT.md` — implementation report

**Estimated total wall:** ~3.5-4.5 hours IMPL + 30-45 min tester (operator manual smoke) + 10 min EAS (iOS + Android separate invocations) = **~4-5 hours end-to-end**.

---

## §14 Estimated effort breakdown

| Phase | Estimate |
|---|---|
| SPEC (this dispatch — spec writer) ✓ DONE | 30-45 min |
| OQ resolution (orchestrator + operator) | 5-10 min |
| IMPL — code changes + i18n + script (steps 4-15) | 2.5-3.5 hours |
| IMPL — verification + report (steps 16-18) | 30-45 min |
| Tester (operator manual smoke per CONDITIONAL pattern) | 30-45 min |
| 2 EAS Updates (iOS + Android separate invocations) | 10 min |
| **Total wall** | **~4-5 hours** |

---

## §15 Risk areas (implementor + tester focus)

1. **Locale translation quality.** Operator may want to spot-check a few non-en locales for translation accuracy. Recommend en + es + ja sample check before locking.

2. **Title autoshrink removal on iPhone SE 1st-gen (320pt).** With OQ-2 = Option (a) ("Concerts") the title easily fits at 32pt on every device. With OQ-2 = Option (b) ("Concerts & Events"), the title may ellipsize on iPhone SE 1st-gen. Operator confirms acceptable trade-off — visible ellipsis is honest UX, autoshrink to ~22pt was hidden cross-platform divergence.

3. **Badge counter regression risk.** `moreChipBadgeCount` line 1112-1113 is unchanged — but if implementor accidentally touches it, T-08 / T-14 / T-17 catch.

4. **Filter-modal Date section vs top-bar Date chips inconsistency.** Top-bar uses `id: "today"` for "Tonight" chip; modal uses `id: "today"` for "Today" chip. Same ID, different label — that's a UX wart but NOT in this spec's scope. Spec writer flags as IMP candidate for future cleanup; implementor MUST NOT bundle (scope discipline).

5. **Cross-platform header rendering.** Implementor verifies on at least: iPhone SE 1st-gen (320pt), iPhone 14 Pro (393pt), Galaxy A series (360pt), Pixel 8 (412pt). Friends-screen header rendering on the same devices is the visual baseline for SC-9 + SC-10.

---

End of spec.
