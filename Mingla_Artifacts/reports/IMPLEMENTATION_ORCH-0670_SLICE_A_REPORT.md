# IMPLEMENTATION_ORCH-0670_SLICE_A_REPORT

**Implementor:** mingla-implementor
**Dispatch:** [prompts/IMPL_ORCH-0670_SLICE_A_USER_VISIBLE_BREAKAGE.md](../prompts/IMPL_ORCH-0670_SLICE_A_USER_VISIBLE_BREAKAGE.md)
**Spec:** [specs/SPEC_ORCH-0670_SLICE_A_USER_VISIBLE_BREAKAGE.md](../specs/SPEC_ORCH-0670_SLICE_A_USER_VISIBLE_BREAKAGE.md) (REVIEW APPROVED 10/10)
**Investigation:** [reports/INVESTIGATION_ORCH-0670_RENDERED_SURFACE_AUDIT.md](../reports/INVESTIGATION_ORCH-0670_RENDERED_SURFACE_AUDIT.md)
**Date:** 2026-04-28
**Status:** IMPLEMENTED · Verification: PARTIAL (tsc + locale parity machine-verified; SC-1..SC-10 + SC-14 require operator device smoke)

---

## §1 Layman summary

The Concerts & Events surface (entire Discover screen) had 5 always-broken defects every user hit regardless of locale or platform. This implementation ships the fix in one bundled change set (1 component file + 29 locale files + 1 Python script + this report):

1. **Empty / error / no-match screens now show real copy.** Seven missing i18n keys added to en/discover.json with full 28-locale translations — error/empty/no-match states no longer render literal `discover:empty.no_events_title` strings.
2. **Chill / Comfy / Bougie / Lavish chips now actually filter.** Filter switch refactored to consume `TIER_BY_SLUG` from `priceTiers.ts` — single source of truth restored. The 5 dead legacy switch cases (`free`, `under-25`, `25-50`, `50-100`, `over-100`) deleted.
3. **Top-bar chip labels + screen title now i18n in 29 locales.** Six hardcoded English labels replaced with `t()` calls.
4. **Title-vs-segment mismatch resolved.** Renamed `"Concerts & Events"` → `"Concerts"` (locked OQ-2). Edge fn `MUSIC_SEGMENT_ID` lock unchanged. OTA-eligible.
5. **Android header autoshrink removed; aligned to Friends-screen baseline.** Deleted `adjustsFontSizeToFit` + `minimumFontScale={0.7}`; updated `styles.titleText` (lineHeight 32 → 36, added `textAlignVertical: 'center'`).

Bonus: 14 orphan i18n keys cleaned from en + 28 locales (392 dead translations deleted) per Constitution #8.

OTA-eligible. No DB / no edge fn / no native module changes. tsc clean (3 baseline errors only — all in untouched files).

---

## §2 Files changed

| File | Type | Change |
|---|---|---|
| [app-mobile/src/components/DiscoverScreen.tsx](../../app-mobile/src/components/DiscoverScreen.tsx) | MODIFIED | i18n calls + title style + price filter refactor + protective comments |
| [app-mobile/src/i18n/locales/en/discover.json](../../app-mobile/src/i18n/locales/en/discover.json) | MODIFIED | +10 new keys, -14 orphans |
| `app-mobile/src/i18n/locales/{ar,bin,bn,de,el,es,fr,ha,he,hi,id,ig,it,ja,ko,ms,nl,pl,pt,ro,ru,sv,th,tr,uk,vi,yo,zh}/discover.json` | MODIFIED (×28) | +10 native translations each, -14 orphans each (-392 total cleanup) |
| [scripts/orch-0670-translate-locales.py](../../scripts/orch-0670-translate-locales.py) | NEW | Idempotent translation + orphan cleanup script per ORCH-0685 / ORCH-0690 precedent |
| [Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0670_SLICE_A_REPORT.md](IMPLEMENTATION_ORCH-0670_SLICE_A_REPORT.md) | NEW | This file |

**Total:** 1 component + 29 locales + 1 script + 1 report = **32 files**.

---

## §3 Old → New receipts

### §3.1 [DiscoverScreen.tsx](../../app-mobile/src/components/DiscoverScreen.tsx)

#### Receipt 3.1.1 — Import extension (1 line, line 58)

**Before:**
```ts
import { PRICE_TIERS } from "../constants/priceTiers";
```
**After:**
```ts
import { PRICE_TIERS, TIER_BY_SLUG, type PriceTierSlug } from "../constants/priceTiers";
```
**Why:** S-2 — extend price filter switch to consume `TIER_BY_SLUG` lookup (canonical single source of truth per spec §5.1.4 / OQ-1).

#### Receipt 3.1.2 — Price filter switch refactor (~30 lines, lines 1080-1119)

**Before:** 5-case switch (`free` / `under-25` / `25-50` / `50-100` / `over-100`) with hardcoded USD ranges that never matched the chip generator's tier slugs (`chill` / `comfy` / `bougie` / `lavish`) → `default: return true` → tap was no-op (RC-2).

**After:** `TIER_BY_SLUG[selectedFilters.price]` lookup → range overlap check (`min ≤ tierMax AND max ≥ tierMin`) → defensive pass-through for unknown slugs. JSDoc lock-in comment added per §10.2.

**Why:** S-2 (RC-2 fix) — restore behavior that user expects when tapping Chill / Comfy / Bougie / Lavish. Constitution #1 (no dead taps) + #2 (one owner per truth — `PRICE_TIERS` is canonical).

#### Receipt 3.1.3 — `moreChipBadgeCount` protective comment (4 new comment lines, lines 1117-1120)

**Before:** No comment.
**After:** Protective comment block per spec §5.1.5 above the unchanged `moreChipBadgeCount` calculation.
**Why:** S-2 transitive fix lock-in — the badge counter became truthful via behavior change (not code change); the calculation itself is unchanged. Comment prevents future-edit regression.

#### Receipt 3.1.4 — Title `<Text>` literal (5 lines: 8 → 7, lines 1218-1226)

**Before:**
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
**After:**
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
**Why:**
- S-4 — replace hardcoded English literal with `t("discover:title")` (HF-5 fix).
- S-5 — title key resolves to `"Concerts"` per OQ-2 lock; matches segmentId music-only data (CF-1 fix).
- S-6 — DELETE `adjustsFontSizeToFit` + `minimumFontScale={0.7}` (Android autoshrink fix per OQ-3).

#### Receipt 3.1.5 — Six top-bar `FilterChip` labels (6 line edits, lines 1239, 1246, 1253, 1260, 1267, 1293)

**Before:** Six hardcoded English literals (`"All"`, `"Tonight"`, `"This Weekend"`, `"Next Week"`, `"This Month"`, `"Filters"`).
**After:** Six `t(...)` calls binding to `discover:filters.{all_dates_short,tonight,this_weekend,next_week,this_month,button}`.
**Why:** S-3 (HF-4 fix) — top-bar chip labels now i18n in 29 locales.

#### Receipt 3.1.6 — `styles.titleText` (3 changed lines + 6 new comment lines + 1 new property, lines 1612-1626)

**Before:**
```ts
titleText: {
  fontSize: d.title.fontSize,
  fontWeight: d.title.fontWeight,
  lineHeight: 32,
  color: d.title.color,
  marginTop: Platform.OS === "ios" ? -4 : 0,
  includeFontPadding: false,
},
```
**After:**
```ts
titleText: {
  // [ORCH-0670 Slice A S-6] Do NOT add adjustsFontSizeToFit OR minimumFontScale to
  // the parent <Text>. Android font rendering produces inconsistent autoshrink
  // behavior with iOS, leading to cross-platform header size divergence (operator
  // field-test 2026-04-28). Title MUST fit at full 32pt OR ellipsize via numberOfLines:1.
  // Friends-screen baseline at ConnectionsPage.tsx:3021-3028 is the canonical pattern.
  fontSize: d.title.fontSize,
  fontWeight: d.title.fontWeight,
  lineHeight: 36,
  color: d.title.color,
  marginTop: Platform.OS === "ios" ? -4 : 0,
  includeFontPadding: false,
  textAlignVertical: "center",
},
```
**Why:** S-6 (OQ-3) — align Discover header to Friends-screen baseline. lineHeight 32 → 36 + `textAlignVertical: 'center'` matches `ConnectionsPage.tsx:3021-3028`. Protective comment encodes the regression-prevention intent per spec §10.3.

### §3.2 [en/discover.json](../../app-mobile/src/i18n/locales/en/discover.json)

**Before:** 56 lines with 14 orphan keys + 6 hardcoded English chip strings absent.
**After:** 50 lines with 10 new keys (`title`, `error.subtitle`, `empty.no_events_title`, `empty.no_events_subtitle`, `empty.expand_radius`, `empty.no_match_title`, `empty.no_match_subtitle`, `empty.reset_filters`, `filters.all_dates_short`, `filters.tonight`) + 14 orphans deleted.
**Why:** S-1 + S-3 + S-4 + S-7 — RC-1 fix (real copy for empty/error/no-match) + i18n chip labels + i18n title + Constitution #8 cleanup.

### §3.3 28 non-en locales (script-driven)

For each of `ar bin bn de el es fr ha he hi id ig it ja ko ms nl pl pt ro ru sv th tr uk vi yo zh`:
- **+10 native translations** of the new keys
- **-14 orphan keys deleted** (where present — every locale had all 14)

Tally: **+280 translations**, **-392 orphan deletions** across 28 non-en locales.
**Why:** S-8 — full 29-locale parity per Option B (matches ORCH-0685 cycle-1 + ORCH-0690 cycle-1 precedent).

### §3.4 [scripts/orch-0670-translate-locales.py](../../scripts/orch-0670-translate-locales.py)

**Before:** Did not exist.
**After:** New script. Idempotent (re-runs are no-ops). Reads each non-en locale's `discover.json`, adds 10 keys with the locale-specific translation, deletes the 14 orphans, writes back with UTF-8 + 2-space indent + trailing newline. Output structure matches `scripts/orch-0690-translate-locales.py` precedent.
**Why:** Provides a reproducible, auditable translation pass record. Script remains in tree for future re-validation.

---

## §4 Spec traceability — SC-1 through SC-15

| SC | Criterion | Status | Evidence |
|---|---|---|---|
| **SC-1** | Empty state copy renders friendly English (not literal keys) | ✅ MACHINE-VERIFIED | `en/discover.json` has `empty.no_events_title`, `empty.no_events_subtitle`, `empty.expand_radius`. DiscoverScreen.tsx:1339-1341 consumes them. SC-1a (visual) needs operator. |
| **SC-2** | Filter no-match copy renders friendly English | ✅ MACHINE-VERIFIED | `en/discover.json` has `empty.no_match_title`, `empty.no_match_subtitle`, `empty.reset_filters`. DiscoverScreen.tsx:1348-1350 consumes them. SC-2a (visual) needs operator. |
| **SC-3** | Error state subtitle non-empty | ✅ MACHINE-VERIFIED | `en/discover.json` has `error.subtitle: "Pull down to retry, or check your connection."`. DiscoverScreen.tsx:1330 consumes it. |
| **SC-4** | Tier chips actually filter | ✅ CODE-VERIFIED | `filteredNightOutCards` useMemo at lines 1085-1115 uses `TIER_BY_SLUG[selectedFilters.price]` lookup. Operator must verify behaviorally on a venue with mixed prices (T-04..T-07). |
| **SC-5** | Any Price restores grid | ✅ CODE-VERIFIED | Early-out `if (selectedFilters.price !== "any")` at line 1088 unchanged. When `any`, the filter block is skipped and full grid is returned. |
| **SC-6** | Top-bar chip labels in user locale | ✅ MACHINE-VERIFIED | grep `label="` in DiscoverScreen.tsx returns 0 matches inside top-bar chips. All 6 use `t(...)` calls (lines 1239, 1246, 1253, 1260, 1267, 1293). 29 locales have all 6 keys. |
| **SC-7** | Screen title in user locale | ✅ MACHINE-VERIFIED | DiscoverScreen.tsx:1224 = `{t("discover:title")}`. 29 locales have `title` key. |
| **SC-8** | Title-data match (Option a = "Concerts") | ✅ MACHINE-VERIFIED | en/discover.json `"title": "Concerts"`; segmentId unchanged. Operator visual confirms grid contains music events only. |
| **SC-9** | Android header == iOS Discover header | ⏸️ NEEDS OPERATOR | Code change applied. Visual verification requires device. |
| **SC-10** | Android Discover header == Friends-screen header | ⏸️ NEEDS OPERATOR | Code change applied (matches `ConnectionsPage.tsx:3021-3028` exactly: lineHeight 36, textAlignVertical 'center', no autoshrink). Visual verification requires device. |
| **SC-11** | All 10 new keys present in 29 locales | ✅ MACHINE-VERIFIED | Programmatic JSON check across all 29 locales returned 0 missing. |
| **SC-12** | All 14 orphan keys absent in 29 locales | ✅ MACHINE-VERIFIED | Programmatic JSON check across all 29 locales returned 0 orphan-presence. |
| **SC-13** | tsc clean — zero new errors above baseline (3 pre-existing) | ✅ VERIFIED | `cd app-mobile && npx tsc --noEmit` = exactly 3 errors (ConnectionsPage:2763, HomePage:246, HomePage:249) — identical to baseline. |
| **SC-14** | Filter badge counter accurate | ✅ CODE-VERIFIED | `moreChipBadgeCount` calculation at line 1124-1125 unchanged. After S-2, the filter actually filters when a non-`any` tier is selected, so the counter accurately reflects "an active price filter is set." |
| **SC-15** | Legacy switch cases deleted | ✅ MACHINE-VERIFIED | grep `case "(under-25\|25-50\|50-100\|over-100)":\|case "free":` returned 0 matches. |

**Summary:** 13/15 machine-verified or code-verified. 2/15 (SC-9, SC-10) require operator device smoke (Android header visual size).

---

## §5 Invariant verification

| ID | Invariant | Status |
|---|---|---|
| **C-1** | No dead taps | ✅ RESTORED — tier chips actually filter; badge counter no longer dishonest |
| **C-2** | One owner per truth | ✅ UPHELD — `PRICE_TIERS` (with `TIER_BY_SLUG`) is single source for tier ranges |
| **C-3** | No silent failures | ✅ RESTORED — error/empty/no-match states show real copy not literal keys |
| **C-7** | No transitional code without exit conditions | ✅ UPHELD — zero `[TRANSITIONAL]` markers introduced |
| **C-8** | Subtract before adding | ✅ UPHELD — 5 legacy switch cases + 14 orphan keys deleted |
| **C-9** | No fabricated data | ✅ RESTORED — Filters badge counter no longer falsely advertises filter activity |
| **C-12** | Validate at the right time | ✅ UPHELD — `useMemo` recomputes when `selectedFilters.price` changes |
| **I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS** (ORCH-0685 cycle-1) | ✅ STILL HOLDS — no payload changes |
| **I-LOCALE-CATEGORY-PARITY** (ORCH-0685 cycle-1) | ✅ STILL HOLDS — 29 × 10 new keys verified, 14 × 29 orphans cleaned |
| **I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS** (ORCH-0685 cycle-1) | ✅ STILL HOLDS — no modal changes |

No new invariants introduced (per spec §9.2). The recurring class (mismatched filter taxonomies vs switch IDs) is a one-shot fix; future filters consuming `PRICE_TIERS` constant will not accumulate the same pattern.

---

## §6 Parity check

| Surface | Status |
|---|---|
| Solo mode (Discover) | ✅ Fixed (this is the only mode for Discover; no collab Discover surface) |
| Collab mode | N/A (Discover is solo-only) |
| Friends-screen header | ✅ UNCHANGED — used as the canonical baseline reference; no edits |
| Saved tab / Map / other surfaces | ✅ UNCHANGED — no cross-cutting changes |

---

## §7 Cache safety

| Concern | Status |
|---|---|
| React Query keys | ✅ UNTOUCHED — no key factory changes; no key consumers changed |
| AsyncStorage | ✅ UNTOUCHED — `NIGHT_OUT_CACHE_KEY` and persisted slices unchanged |
| Data shape | ✅ UNTOUCHED — `nightOutCards`/`SavedCard`/`PriceFilter` types unchanged; only the consumer logic in `filteredNightOutCards` useMemo changed |
| Mutation invalidation | ✅ N/A — no mutations in this change |

---

## §8 Regression surface (recommended tester focus)

1. **Concerts & Events surface (entire Discover screen)** — primary fix target. Verify all 4 states render real copy (loading, error, empty, no-match, populated). Verify all 6 top-bar chips translate. Verify title translates.
2. **Friends-screen header (regression check)** — should be visually identical post-fix; we only READ from this file as a baseline. Verify on Android.
3. **Filter modal (Date / Price / Genre sections)** — Date section untouched but verify nothing visually drifted; Price section is the primary functional fix; Genre section untouched.
4. **Filters chip badge counter** — verify badge increments to 1 when a tier chip is tapped, increments to 2 when genre is also tapped, decrements correctly when reset.
5. **Persisted-state startup** — open Discover with a previously-cached tier filter (e.g., `chill`); verify cards load filtered without an "all events" flash.

---

## §9 Constitutional compliance check

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | ✅ RESTORED |
| 2 | One owner per truth | ✅ UPHELD (PRICE_TIERS canonical) |
| 3 | No silent failures | ✅ RESTORED |
| 4 | One query key per entity | ✅ N/A |
| 5 | Server state stays server-side | ✅ N/A (no server-state edits) |
| 6 | Logout clears everything | ✅ N/A |
| 7 | Label temporary fixes | ✅ UPHELD (no `[TRANSITIONAL]` markers) |
| 8 | Subtract before adding | ✅ UPHELD (5 dead switch cases + 14 orphan keys deleted) |
| 9 | No fabricated data | ✅ RESTORED |
| 10 | Currency-aware UI | ✅ UNCHANGED (Slice B scope) |
| 11 | One auth instance | ✅ N/A |
| 12 | Validate at the right time | ✅ UPHELD |
| 13 | Exclusion consistency | ✅ N/A |
| 14 | Persisted-state startup | ✅ N/A |

---

## §10 Transition register

**NONE.** No `[TRANSITIONAL]` markers introduced. Per spec §11, this is a clean fix with no expected transitional residue.

---

## §11 Discoveries for orchestrator

The implementor scoped strictly to Slice A. The following items were observed during execution and are surfaced for orchestrator triage — **not bundled**:

1. **D-1 (already documented in spec §15.4 as IMP candidate):** Top-bar uses `id: "today"` for the "Tonight" chip, while modal Date section uses `id: "today"` for the "Today" chip. Same ID, different UI label. This is a UX wart, not a bug — both filter to today's date — but the operator should decide whether to align the labels or split the IDs in a future cleanup. Not affecting any user behavior.

2. **D-2 (NEW):** Title key reads as `t("discover:title")` but the `discover` namespace already had a `filters.title` key (`"Filters"`). Both coexist cleanly because i18next dot-notation keys are flat strings — but a future maintainer reading the JSON might find the parallel `title` / `filters.title` slightly surprising. Not changing in this slice. Could be renamed to `screen_title` in a future cycle if it becomes confusing.

3. **D-3 (NEW):** The 14 orphan keys included `loading.for_you` and `loading.nightlife`. The implementor ran a fresh grep to re-verify zero consumers in `app-mobile/src` — confirmed. However, neither `LoadingGridSkeleton` nor any other Discover-screen path renders a localized loading message at all (loading state shows skeleton only). If the operator wants a localized loading caption in the future, they'd need to add a new key + UI hook — orphan deletion does not block that.

4. **D-4 (NEW):** Native locale translations were curated by the implementor. Operator may want to spot-check `es`, `ja`, `ar`, `zh` for translation accuracy before lockdown. The Spanish file ([app-mobile/src/i18n/locales/es/discover.json](../../app-mobile/src/i18n/locales/es/discover.json)) is the easiest spot-check: it now reads correctly with "Conciertos" / "Esta noche" / "Restablecer filtros" / etc.

---

## §12 Verification matrix summary

| Layer | Method | Result |
|---|---|---|
| TypeScript compile | `cd app-mobile && npx tsc --noEmit` | 3 baseline errors only (pre-existing, untouched files) |
| en locale shape | `Read en/discover.json` | 50 keys, all expected new keys present, 0 orphans |
| 29-locale parity | Custom Python check (added/missing/orphans) | 0 errors across all 29 locales |
| 14 orphan deletion | Programmatic check | 0 orphan-key occurrences across 29 locales |
| Legacy switch cases | grep DiscoverScreen.tsx | 0 matches for `case "(under-25\|25-50\|50-100\|over-100)":\|case "free":` |
| Title literal | grep | 0 matches for `Concerts & Events"` / `"Concerts & Events"` |
| FilterChip hardcoded labels | grep | 0 matches for `label="(All\|Tonight\|This Weekend\|Next Week\|This Month\|Filters)"` |

---

## §13 Commit recipe (suggested)

Single bundled commit covering all 32 files:

```
fix(discover): ORCH-0670 Slice A — restore Concerts surface UX (i18n + tier filter + Android header)

- Add 7 RC-1 keys to en/discover.json (error.subtitle + empty.no_events_* +
  empty.no_match_* + empty.expand_radius + empty.reset_filters); empty/error/
  no-match states now render real copy not literal i18n keys

- Refactor price filter switch to consume TIER_BY_SLUG from priceTiers.ts;
  Chill/Comfy/Bougie/Lavish chips now actually filter via range overlap;
  delete 5 legacy switch cases (free/under-25/25-50/50-100/over-100)

- Replace 6 hardcoded English chip labels + screen title with t() calls;
  add filters.all_dates_short + filters.tonight + title keys

- Rename "Concerts & Events" → "Concerts" (preserves OTA-eligibility;
  matches segmentId music-only data lock)

- Delete adjustsFontSizeToFit + minimumFontScale; align Discover title
  to Friends-screen baseline (lineHeight 32→36, textAlignVertical:'center')

- Full 29-locale parity pass: +280 native translations, -392 orphan
  deletions (14 orphan keys × 28 non-en locales)

- Add scripts/orch-0670-translate-locales.py (idempotent, ORCH-0685/0690
  precedent)

- Protective comments on filteredNightOutCards useMemo, moreChipBadgeCount,
  and styles.titleText

OTA-eligible · No DB · No edge fn · No native module · tsc clean
```

(No Co-Authored-By line per memory rule.)

---

## §14 EAS Update commands (for operator post-commit)

Two separate invocations (clean dist between them per memory rule):

```bash
cd app-mobile
rm -rf dist
eas update --branch production --platform ios --message "ORCH-0670 Slice A — restore Concerts surface UX (i18n + tier filter + Android header)"

rm -rf dist
eas update --branch production --platform android --message "ORCH-0670 Slice A — restore Concerts surface UX (i18n + tier filter + Android header)"
```

---

## §15 Operator manual smoke matrix (T-01..T-18)

After EAS Updates, operator runs the test matrix from spec §7. Implementor cannot drive these — they require a real device and live cache state.

Priority order:
1. **T-01..T-03** (empty / error / no-match copy on iOS + Android) — verifies SC-1..SC-3
2. **T-04..T-08** (tier filtering on a venue with mixed prices) — verifies SC-4 + SC-5 + SC-14
3. **T-09 + T-10** (Spanish + Japanese locale pass) — verifies SC-6 + SC-7
4. **T-11** (title-data match — should see music events only with title "Concerts") — verifies SC-8
5. **T-12 + T-13** (Android header visual size vs iOS + vs Friends) — verifies SC-9 + SC-10
6. **T-14** (long title overflow with Concerts at 32pt — should fit comfortably on every device since "Concerts" is 8 chars)

---

---

## §16 Amendment — title rename "Concerts" → "Events" (2026-04-28)

**Dispatch:** [prompts/IMPL_ORCH-0670_SLICE_A_TITLE_RENAME.md](../prompts/IMPL_ORCH-0670_SLICE_A_TITLE_RENAME.md)

**Trigger:** Operator manual-smoked the original IMPL on device, confirmed all functional behavior PASSES, but requested the screen title be renamed from `"Concerts"` to `"Events"` as a brand-language preference.

**Trade-off accepted:** This reverts CF-1 (title-vs-segment data mismatch). The screen now says "Events" across 29 locales, but the edge function `MUSIC_SEGMENT_ID` lock remains music-only — so the grid still shows only concerts. Operator accepted this trade-off; full segmentId expansion (sports / arts / family / misc) is queued as future Slice C scope, requires edge fn redeploy, breaks OTA-eligibility, so not bundled here.

**Files changed (30 total — small):**

1. `app-mobile/src/i18n/locales/en/discover.json` — `"title": "Concerts"` → `"title": "Events"` (1 value change)
2. `scripts/orch-0670-translate-locales.py` — replaced the entire `"title"` translations map with the new "Events" translations (28 native equivalents)
3. `app-mobile/src/i18n/locales/{ar,bin,bn,de,el,es,fr,ha,he,hi,id,ig,it,ja,ko,ms,nl,pl,pt,ro,ru,sv,th,tr,uk,vi,yo,zh}/discover.json` — script-driven update of the `title` key in 28 non-en locales (1 value change each)

**Verification:** Programmatic dump of `title` across 29 locales returned the expected native "Events" word in each:

| Locale | Title |
|---|---|
| ar | فعاليات |
| bin | Akpata |
| bn | ইভেন্ট |
| de | Events |
| el | Εκδηλώσεις |
| en | Events |
| es | Eventos |
| fr | Événements |
| ha | Abubuwan |
| he | אירועים |
| hi | इवेंट्स |
| id | Acara |
| ig | Ihe omume |
| it | Eventi |
| ja | イベント |
| ko | 이벤트 |
| ms | Acara |
| nl | Evenementen |
| pl | Wydarzenia |
| pt | Eventos |
| ro | Evenimente |
| ru | События |
| sv | Evenemang |
| th | กิจกรรม |
| tr | Etkinlikler |
| uk | Події |
| vi | Sự kiện |
| yo | Awọn iṣẹlẹ |
| zh | 活动 |

**Code logic:** UNCHANGED — no DiscoverScreen.tsx edits, no edge fn edits, no DB. tsc baseline still 3 errors only (untouched files).

**Cache safety:** UNCHANGED — i18n keys remain identical, only the `title` value changed. No React Query / AsyncStorage impact.

**Constitutional compliance:** still UPHELD; CF-1 (title-vs-segment match) was operator-relaxed by explicit decision (brand-language preference outweighs strict literal data match).

**OTA-eligible:** YES — i18n only.

End of report.
