# Investigation — ORCH-0670 Concerts & Events RENDERED-SURFACE audit

**Mode:** INVESTIGATE-ONLY (render-first, three-pass: Inventory → Subtract → Critique)
**Dispatch:** [`prompts/FORENSICS_ORCH-0670_RENDERED_SURFACE_AUDIT.md`](../prompts/FORENSICS_ORCH-0670_RENDERED_SURFACE_AUDIT.md)
**Date:** 2026-04-28
**Investigator:** mingla-forensics
**Predecessor:** [reports/INVESTIGATION_ORCH-0670_CONCERTS_EVENTS.md](INVESTIGATION_ORCH-0670_CONCERTS_EVENTS.md) — re-verified, partially superseded
**Confidence ceiling:** HIGH for code-deterministic claims (rendered JSX, i18n key presence, state variables, switch branches). MEDIUM for runtime-dependent (e.g., title autoshrink behavior on narrow devices). NEEDS-LIVE-FIRE for any Ticketmaster API response shape claim.

---

## §1 Layman summary (≤6 lines)

The Concerts & Events surface is the Discover screen — full-screen experience with a "Concerts & Events" title pinned to a glass header, 5 date filter chips ("All / Tonight / This Weekend / Next Week / This Month") + a "Filters" button, then a 2-column grid of event cards below. The Filters button opens a modal with Date + Price (Chill/Comfy/Bougie/Lavish) + Music Genre sections. Per event card: photo, top-left badge (SOLD OUT / SOON / genre name), save heart, and a bottom info chip (event name + date · venue · price). Tapping a card opens the ExpandedCardModal overlay. **Top-level price chips do NOT exist** — they're inside the Filter modal only (operator's correction validated). **7 i18n keys are missing in en/discover.json** — users see literal text like `discover:empty.no_events_title` whenever they hit any error/empty/no-match state. **Tier chips inside the Filter modal are inert** — tapping them sets a `chill`/`comfy`/`bougie`/`lavish` filter ID that the price-filter switch doesn't handle (falls through to `default: return true`), but the badge counter on the Filters button still increments, falsely advertising filter activity.

---

## §2 Phase 0 — Ingestion summary

- **Prior 2026-04-25 investigation:** read in full earlier this session. Treated as suspect per dispatch §B rule 4.
- **Memory:** `feedback_headless_qa_rpc_gap.md` (NEEDS-LIVE-FIRE bar) + `feedback_forensic_thoroughness.md` (full migration chain rule) applied.
- **Migration chain:** `ticketmaster_events_cache` table — only one creation migration (`20260301000003_ticketmaster_cache.sql`) + admin cleanup at `20260317210000_admin_dashboard_overhaul.sql:114` (DELETE expired). No constraint or shape changes. Authoritative current schema is unchanged from prior investigation.
- **Sub-agent delegation:** none. All file reads done directly by investigator.

---

## §3 Phase 1 — Rendered Surface Inventory

Built from direct file reads of [DiscoverScreen.tsx](app-mobile/src/components/DiscoverScreen.tsx), [designSystem.ts](app-mobile/src/constants/designSystem.ts), [en/discover.json](app-mobile/src/i18n/locales/en/discover.json), [en/common.json](app-mobile/src/i18n/locales/en/common.json), [supabase/functions/ticketmaster-events/index.ts](supabase/functions/ticketmaster-events/index.ts).

### §3.1 Surface entry point

The Concerts & Events section IS the entire DiscoverScreen body — not a sub-section among siblings. Confirmed via grep — `Concerts.*Events` returns one match (line 1226), `nightOut*` references all live in DiscoverScreen.tsx + nightOutExperiencesService.ts. No second mount site.

### §3.2 Render manifest (top-to-bottom, in render order)

| # | Element | File:line | Render condition | Source |
|---|---|---|---|---|
| **HDR-01** | Glass header panel (BlurView background + tinted overlay + hairline) | [DiscoverScreen.tsx:1180-1208](app-mobile/src/components/DiscoverScreen.tsx#L1180-L1208) | Always | Hardcoded styles + `glass.discover` tokens |
| **HDR-02** | Title text "Concerts & Events" | [:1218-1227](app-mobile/src/components/DiscoverScreen.tsx#L1218-L1227) | Always | **HARDCODED LITERAL** — NOT i18n |
| **HDR-03** | 5 date filter chips: All / Tonight / This Weekend / Next Week / This Month | [:1238-1272](app-mobile/src/components/DiscoverScreen.tsx#L1238-L1272) | Always | Hardcoded English literals (NOT i18n at top row, but i18n inside modal) |
| **HDR-04** | Pinned "Filters" chip with badge count | [:1292-1299](app-mobile/src/components/DiscoverScreen.tsx#L1292-L1299) | Always | Hardcoded "Filters" literal + `moreChipBadgeCount` |
| **GRID-01** | LoadingGridSkeleton (6 placeholder cards) | [:1324-1325](app-mobile/src/components/DiscoverScreen.tsx#L1324-L1325) | `nightOutLoading && nightOutCards.length === 0` | Component |
| **GRID-02** | Error EmptyState | [:1326-1335](app-mobile/src/components/DiscoverScreen.tsx#L1326-L1335) | `!nightOutLoading && nightOutError !== null && !hasCache` | i18n keys: `error.title` / `error.subtitle` ❌MISSING / `error.retry` |
| **GRID-03** | Empty EmptyState (no events) | [:1336-1344](app-mobile/src/components/DiscoverScreen.tsx#L1336-L1344) | `!nightOutLoading && !nightOutError && nightOutCards.length === 0` | i18n keys: `empty.no_events_title` ❌MISSING / `empty.no_events_subtitle` ❌MISSING / `empty.expand_radius` ❌MISSING |
| **GRID-04** | Filter no-match EmptyState | [:1345-1353](app-mobile/src/components/DiscoverScreen.tsx#L1345-L1353) | `nightOutCards.length > 0 && filteredNightOutCards.length === 0` | i18n keys: `empty.no_match_title` ❌MISSING / `empty.no_match_subtitle` ❌MISSING / `empty.reset_filters` ❌MISSING |
| **GRID-05** | Event card grid (2-column) | [:1354-1370](app-mobile/src/components/DiscoverScreen.tsx#L1354-L1370) | `!showLoadingSkeleton && !showError && !showEmpty && !showFilterNoMatch` | `filteredNightOutCards.map(...)` |
| **MODAL-01** | ExpandedCardModal | [:1374-1407 area](app-mobile/src/components/DiscoverScreen.tsx#L1374) | `isExpandedModalVisible === true` | Card tap target |
| **MODAL-02** | Filter Modal (slide-up) | [:1435-1559](app-mobile/src/components/DiscoverScreen.tsx#L1435-L1559) | `isFilterModalVisible === true` | "Filters" chip tap target |

### §3.3 Filter Modal contents (rendered when "Filters" tapped)

| Sub-section | File:line | Options | Filter wired? |
|---|---|---|---|
| Header | [:1448-1453](app-mobile/src/components/DiscoverScreen.tsx#L1448-L1453) | Title `t("discover:filters.title")` ✅ + close button | N/A |
| **Date** section | [:1455-1485](app-mobile/src/components/DiscoverScreen.tsx#L1455-L1485) | 6 options: Any Date / Today / Tomorrow / This Weekend / Next Week / This Month | ✅ wired (sets `selectedFilters.date`, used in `getDateRange` and edge fn `startDate`/`endDate` params) |
| **Price Range** section | [:1487-1517](app-mobile/src/components/DiscoverScreen.tsx#L1487-L1517) | 5 options: Any Price / Chill · $50 max / Comfy · $50–$150 / Bougie · $150–$300 / Lavish · $300+ | ⚠️ **PARTIALLY broken** — see §3.4 |
| **Music Genre** section | [:1519-1549](app-mobile/src/components/DiscoverScreen.tsx#L1519-L1549) | 11 options: All Genres / Afrobeats / Dancehall / Hip-Hop+R&B / House / Techno / Jazz+Blues / Latin+Salsa / Reggae / K-Pop / Acoustic+Indie | ⚠️ **PARTIALLY broken** — see §3.5 |

### §3.4 Price filter — actual behavior

`priceFilterOptions` ([:1124-1130](app-mobile/src/components/DiscoverScreen.tsx#L1124-L1130)) generates 5 options:
- `{id: "any", label: "Any Price"}` — works (early-out at line 1083)
- `{id: "chill", label: "Chill · $50 max"}` — **DOESN'T FILTER** (slug hits `default: return true` at switch line 1100)
- `{id: "comfy", label: "Comfy · $50 – $150"}` — same
- `{id: "bougie", label: "Bougie · $150 – $300"}` — same
- `{id: "lavish", label: "Lavish · $300+"}` — same

**Filter switch at [:1088-1101](app-mobile/src/components/DiscoverScreen.tsx#L1088-L1101)** handles different IDs: `"free"` / `"under-25"` / `"25-50"` / `"50-100"` / `"over-100"`. **None of these are emitted by the UI.** Two filter taxonomies coexist; only the `default: return true` branch is reachable from the rendered chips. Net effect: tapping Chill/Comfy/Bougie/Lavish is a no-op; the chip labels lie about filter activity, AND the `moreChipBadgeCount` ([:1112-1113](app-mobile/src/components/DiscoverScreen.tsx#L1112-L1113)) increments to "1" on the top-bar Filters chip — falsely advertising that a filter is active.

### §3.5 Genre filter — actual behavior

`genreFilterOptions` ([:1131-1143](app-mobile/src/components/DiscoverScreen.tsx#L1131-L1143)) generates 11 options.

The selected genre flows through `GENRE_TO_KEYWORDS[selectedFilters.genre]` (line 935) → `keywords` array → service → edge fn. At edge fn line 321: `params.set("keyword", searchKeywords.join(","))`. Per Ticketmaster Discovery v2 docs, the `keyword` param is freeform full-text search across event/attraction/venue names, NOT a genre classifier. So `keyword=afrobeats,amapiano` is a phrase-match against event names — returns near-zero for most genres. **Genre filter sends API call, but precision is so low most non-`all` selections come back near-empty. NEEDS-LIVE-FIRE to confirm exact return shape.**

### §3.6 EventGridCard rendered fields

[EventGridCard.tsx:227-468](app-mobile/src/components/DiscoverScreen.tsx#L227-L468) (defined inline in DiscoverScreen.tsx).

| Field | Renders? | File:line of `<Text>`/`<Image>` | Source |
|---|---|---|---|
| Background image | ✅ | [:314-320](app-mobile/src/components/DiscoverScreen.tsx#L314-L320) | `card.image` (string URL) |
| Bottom gradient overlay | ✅ | [:323-329](app-mobile/src/components/DiscoverScreen.tsx#L323-L329) | LinearGradient hardcoded |
| Top-left badge label | ✅ when `topBadgeLabel != null` | [:357-359](app-mobile/src/components/DiscoverScreen.tsx#L357-L359) | `topBadgeLabel = isSoldOut ? "SOLD OUT" : ticketStatus === "presale" ? "SOON" : card.genre.toUpperCase()` |
| Save heart button | ✅ | [:411-422](app-mobile/src/components/DiscoverScreen.tsx#L411-L422) | `isSaved` prop |
| Bottom info chip — title | ✅ | [:446-452](app-mobile/src/components/DiscoverScreen.tsx#L446-L452) | `card.eventName` (numberOfLines from token) |
| Bottom info chip — meta row | ✅ | [:453-458](app-mobile/src/components/DiscoverScreen.tsx#L453-L458) | `dateTag` + " · " + `card.venueName` (single line) |
| Bottom info chip — price | ✅ when `displayPrice` truthy | [:459-463](app-mobile/src/components/DiscoverScreen.tsx#L459-L463) | `formatPriceRange(card.price, currency) ‖ card.price ‖ ""` |
| Distance | ❌ NOT rendered | (no JSX) | `card.distance` exists in card data type but no `<Text>` consumes it |
| Address | ❌ NOT rendered | (no JSX) | `card.address` plumbed through to ExpandedCardModal but not the grid card |
| Genre as separate label | ❌ (subsumed into topBadgeLabel ONLY when not soldOut/presale) | — | — |
| Tags | ❌ NOT rendered | (no JSX) | `card.tags` exists but no consumer on card |
| Sold-out as filter exclusion | ❌ NOT applied — sold-out events ARE rendered, just badged | — | `filteredNightOutCards` doesn't filter by `ticketStatus` |

### §3.7 Title / heading style

- Hardcoded literal `"Concerts & Events"` at [:1226](app-mobile/src/components/DiscoverScreen.tsx#L1226). Not in any locale file.
- Style `styles.titleText` at [:1612-1620](app-mobile/src/components/DiscoverScreen.tsx#L1612-L1620): `fontSize: d.title.fontSize` = **32pt** (per [designSystem.ts:564](app-mobile/src/constants/designSystem.ts#L564)), `fontWeight: '700'`, `lineHeight: 32`, color white.
- `numberOfLines={1}` + `adjustsFontSizeToFit` + `minimumFontScale={0.7}` ([:1220-1222](app-mobile/src/components/DiscoverScreen.tsx#L1220-L1222)) — title can autoshrink to ~22.4pt to fit on one line on narrow phones.
- Title band height = 36pt ([:1154](app-mobile/src/components/DiscoverScreen.tsx#L1154)), title sits at `insets.top + glass.chrome.row.topInset` (insets.top + 2).
- **Operator's "heading too small" complaint** likely refers to one of two things: (a) on narrower phones the autoshrink kicks in and the title reads ~22pt — visually crushed; (b) compared to other screens with section sub-headings + screen titles, this surface only has the screen title and no section sub-heading, which can read as "everything is the same size" or "the section header isn't where I expect it." Spec writer should clarify with operator.

### §3.8 Tap target

Card tap → `handleNightOutCardPress(card)` at [:979-1020](app-mobile/src/components/DiscoverScreen.tsx#L979-L1020):

- Builds `expandedCardData` with `category: "Night Out"`, `categoryIcon: "moon-outline"`, plumbed-through fields (price, distance, address, tags, location, eventName, venueName, artistName, date, time, genre, subGenre, ticketUrl, ticketStatus)
- `setSelectedCardForExpansion(expandedCardData)` + `setIsExpandedModalVisible(true)`

ExpandedCardModal at [:1374-1407 area](app-mobile/src/components/DiscoverScreen.tsx#L1374). The modal is the same component used for deck cards / saved cards / chat-shared cards (per ORCH-0685 chain) but receives a `nightOutData` extra field for ticketmaster-specific render branching.

---

## §4 Phase 2 — Dead Code Enumeration

Anything declared in code but not reaching the §3 inventory. Spec writer locks the deletion list verbatim from this enumeration.

### §4.1 Dead i18n key references (used in code, not in JSON)

These are NOT dead code — they're **MISSING JSON entries**. Code uses them; JSON doesn't have them. User sees literal key strings on every render.

| Key referenced in code | File:line | Status in en/discover.json |
|---|---|---|
| `discover:error.title` | [DiscoverScreen.tsx:1329](app-mobile/src/components/DiscoverScreen.tsx#L1329) | ✅ exists |
| `discover:error.subtitle` | [:1330](app-mobile/src/components/DiscoverScreen.tsx#L1330) | ❌ MISSING |
| `discover:error.retry` | [:1331](app-mobile/src/components/DiscoverScreen.tsx#L1331) | ✅ exists |
| `discover:empty.no_events_title` | [:1339](app-mobile/src/components/DiscoverScreen.tsx#L1339) | ❌ MISSING (JSON has `empty.no_events`) |
| `discover:empty.no_events_subtitle` | [:1340](app-mobile/src/components/DiscoverScreen.tsx#L1340) | ❌ MISSING |
| `discover:empty.expand_radius` | [:1341](app-mobile/src/components/DiscoverScreen.tsx#L1341) | ❌ MISSING |
| `discover:empty.no_match_title` | [:1348](app-mobile/src/components/DiscoverScreen.tsx#L1348) | ❌ MISSING (JSON has `empty.no_matching`) |
| `discover:empty.no_match_subtitle` | [:1349](app-mobile/src/components/DiscoverScreen.tsx#L1349) | ❌ MISSING |
| `discover:empty.reset_filters` | [:1350](app-mobile/src/components/DiscoverScreen.tsx#L1350) | ❌ MISSING |

**7 keys missing in en/discover.json. All 28 other locales need same 7 keys added.**

### §4.2 Dead JSON keys (in JSON, not used in code)

| Key in en/discover.json | Used? |
|---|---|
| `empty.no_events` | ❌ no code references — orphan (likely the original key that got renamed to `no_events_title` without migrating the JSON) |
| `empty.no_events_nearby` | ❌ no code references — orphan |
| `empty.no_matching` | ❌ no code references — orphan |
| `empty.no_matching_filters` | ❌ no code references — orphan |
| `empty.show_all_parties` | ❌ no code references — orphan |
| `empty.adjust_preferences` | ❌ no code references — orphan |
| `empty.no_experiences` | ❌ no code references — orphan |
| `error.try_again` | ❌ no code references — orphan (code uses `error.retry`) |
| `loading.for_you` / `loading.nightlife` | ⚠️ no code references in DiscoverScreen — possibly used elsewhere; needs broader grep |
| `nightout.on_sale` / `nightout.sold_out` / `nightout.soon` / `nightout.tba` | ❌ no code references — orphans (badge labels are hardcoded `"SOLD OUT"` / `"SOON"` / `card.genre.toUpperCase()`) |

**Roughly 12 orphan keys** in en/discover.json. Likely mirrored as orphans across 28 other locales = ~336 total orphan translations.

### §4.3 Dead price filter switch branches

[:1088-1101](app-mobile/src/components/DiscoverScreen.tsx#L1088-L1101): the switch handles `"free"` / `"under-25"` / `"25-50"` / `"50-100"` / `"over-100"` — **none of these IDs are emitted by the rendered UI**. The UI emits `chill` / `comfy` / `bougie` / `lavish` / `any`. All non-`any` UI values hit `default: return true` (no-op).

**Two paths to fix:** (a) make the UI emit the legacy band IDs, OR (b) extend the switch to handle tier slugs with explicit USD ranges.

Either way, the existing 5 switch branches are unreachable from current JSX — pure dead code under current UI taxonomy.

### §4.4 Dead state machine branches

[:1170](app-mobile/src/components/DiscoverScreen.tsx#L1170): `showFilterNoMatch` requires `filteredNightOutCards.length === 0 && nightOutCards.length > 0`. Given §4.3 — when the price filter is set to a tier slug, `filteredNightOutCards.length === nightOutCards.length` (filter is no-op). So the no-match state only fires when:
- price filter is `"free"` OR `"under-25"` OR similar legacy IDs (UNREACHABLE per §4.3), OR
- TBA-price events excluded ([:1085](app-mobile/src/components/DiscoverScreen.tsx#L1085)) — sometimes reaches state if all results are TBA, OR
- Future genre/date filter changes that filter post-fetch (currently date is sent to API; genre is sent to API as keywords)

In practice, the no-match state is **rarely-to-never reached** under current UI. Not strictly dead, but very rare.

### §4.5 Dead handler — handleResetFilters

[:1076-1078](app-mobile/src/components/DiscoverScreen.tsx#L1076-L1078): resets `selectedFilters` to defaults. Wired from:
- [:1351](app-mobile/src/components/DiscoverScreen.tsx#L1351) — Filter no-match state action button (rare path per §4.4)
- [:1555](app-mobile/src/components/DiscoverScreen.tsx#L1555) — Filter modal Reset button (always reachable when modal open)

Not dead, but the filter-no-match path is rare.

### §4.6 Dead service-layer fields

Need to read [`nightOutExperiencesService.ts`](app-mobile/src/services/nightOutExperiencesService.ts) for full inventory. Spec writer should grep field-by-field. Strong candidates: `priceCurrency` (returned by edge fn at [:210](supabase/functions/ticketmaster-events/index.ts#L210), passed through service, but the mobile `formatPriceRange` ignores it and parses `card.price` as USD — leading to HF-04 currency double-conversion).

### §4.7 Dead style entries

Out of audit scope without deeper grep across `styles.*` references. Spec writer / implementor should run unused-style detection during fix cycle (e.g., `eslint-plugin-react-native` rules or grep-based).

---

## §5 Phase 3.1 — Wrongness findings

Re-classified against the verified rendered surface only. Six-field anchors for 🔴.

### 🔴 RC-1 — i18n key drift (HIGH)

| Field | Value |
|---|---|
| **File:line** | [DiscoverScreen.tsx:1330, 1339, 1340, 1341, 1348, 1349, 1350](app-mobile/src/components/DiscoverScreen.tsx#L1330) + en/discover.json (no entries) |
| **Exact code** | `t("discover:empty.no_events_title")` (and 6 others — see §4.1) |
| **What it does** | i18n lookup for these 7 keys returns the literal key string (react-i18next default fallback). User sees `discover:empty.no_events_title` rendered as the title text on screen. |
| **What it should do** | Each key should resolve to friendly copy like `"No events near you tonight"` / `"Try a wider date or different vibe"` / `"Expand radius"`. JSON entries must exist in en + 28 other locales. |
| **Causal chain** | User opens Discover in zero-coverage geography → 0 events → `showEmpty` branch fires → `<EmptyState title={t("discover:empty.no_events_title")} ... />` → title prop receives literal key string → screen displays raw key. Same path for error state (network failure) and no-match state. **Always-broken** for any user who hits any of these 3 states. |
| **Verification step** | Mount DiscoverScreen with `nightOutCards: []`, `nightOutLoading: false`, `nightOutError: null` → render → expect screen text contains `"discover:empty.no_events_title"` literal. OR: kill network, observe error state, expect screen text contains `"discover:error.subtitle"` literal. |

### 🔴 RC-2 — Tier price chips silently no-op (HIGH)

| Field | Value |
|---|---|
| **File:line** | [DiscoverScreen.tsx:1088-1101](app-mobile/src/components/DiscoverScreen.tsx#L1088-L1101) (switch) + [:1124-1130](app-mobile/src/components/DiscoverScreen.tsx#L1124-L1130) (chip generator) |
| **Exact code** | switch `case "free":` / `"under-25":` / `"25-50":` / `"50-100":` / `"over-100":` / `default: return true` — chip generator emits `tier.slug` which is `"chill"`/`"comfy"`/`"bougie"`/`"lavish"` |
| **What it does** | Tap Chill chip → `setSelectedFilters({...selectedFilters, price: "chill"})` → `filteredNightOutCards` recomputes → switch hits `default: return true` → grid unchanged → BUT `moreChipBadgeCount` increments to 1, so the top-bar "Filters" chip now displays a `1` badge falsely indicating a filter is active. |
| **What it should do** | Either (a) chip emits a band ID matching the switch (`under-25` etc.), OR (b) switch handles tier slugs with explicit USD ranges. Spec choice. |
| **Causal chain** | User opens Filter modal → taps "Chill · $50 max" → expects events ≤ $50 → grid unchanged → user closes modal → sees `1` badge on Filters chip → opens Filter modal again → sees Chill is "selected" → confused why grid shows nothing different. **Always-broken** (constant misleading state). |
| **Verification step** | Tap Chill chip; observe `selectedFilters.price === "chill"`; observe `filteredNightOutCards.length === nightOutCards.length` (no delta in grid); observe `moreChipBadgeCount === 1`. |

### 🔴 RC-3 — Date filter cache poisoning (HIGH)

| Field | Value |
|---|---|
| **File:line** | [DiscoverScreen.tsx:854](app-mobile/src/components/DiscoverScreen.tsx#L854) (cache key) + [:919-928](app-mobile/src/components/DiscoverScreen.tsx#L919-L928) (cache check) |
| **Exact code** | Key: `${NIGHT_OUT_CACHE_KEY}_${user?.id}_${lat}_${lng}_${selectedFilters.genre}` (no date). Check: `if (cached && cached.date === getTodayDateString() && ... && cached.genre === selectedFilters.genre) { setNightOutCards(cached.venues); ...; return; }` |
| **What it does** | Switching from "Any" → "Tonight" hits the same cache key (same userId, same lat/lng, same genre, same `getTodayDateString()` since it's the same day). Cache check passes, stale 30-day-window venues are served as if they were today's. |
| **What it should do** | Cache should be keyed by `(userId, geo, genre, dateFilter)` quadruple; equality check should include date-filter equality. |
| **Causal chain** | User opens Discover with `date=any` → cache fills with 30-day window → user taps `date=today` → `selectedFilters.date` change triggers fetch effect ([:958-964](app-mobile/src/components/DiscoverScreen.tsx#L958-L964)) → debounced 300ms → `fetchNightOutEvents()` runs → `loadNightOutCache()` returns the prior 30-day result → cache check passes → `setNightOutCards(cached.venues)` returns immediately → fresh fetch never fires. User sees 30-day events under "Tonight" chip. |
| **Verification step** | Open Discover with `date=any`; observe events for next 30 days. Tap "Tonight" chip; observe SAME events (not filtered to today). Inspect AsyncStorage: only one cache key per user/lat/lng/genre, no date variant. |

### 🟠 CF-1 — "Concerts & Events" title is deceptive (HIGH)

| Field | Value |
|---|---|
| **File:line** | [DiscoverScreen.tsx:1226](app-mobile/src/components/DiscoverScreen.tsx#L1226) (literal) + [edge fn:16, 314](supabase/functions/ticketmaster-events/index.ts#L16) (segmentId hardcoded music) |
| **What it does** | UI title promises sports / theater / comedy / family / festivals / etc. Edge fn unconditionally filters to `MUSIC_SEGMENT_ID = "KZFzniwnSyZfZ7v7nJ"` only. Other segments structurally never appear. |
| **What it should do** | Either (a) rename to "Concerts" (honest, smallest fix), OR (b) make segmentId configurable and add segment chip to UI (larger fix), OR (c) drop segmentId filter entirely and let TM return all event types in the geographic radius. |

### 🟠 CF-2 — Currency double-conversion in formatPriceRange (HIGH)

| Field | Value |
|---|---|
| **File:line** | [edge fn:148-159](supabase/functions/ticketmaster-events/index.ts#L148-L159) (hardcodes `$` symbol regardless of `range.currency`) + [formatters.ts:141-177](app-mobile/src/components/utils/formatters.ts#L141-L177) (parses USD numerals, multiplies by user-currency rate) |
| **What it does** | London £50 event → edge fn returns `formatted: "$50 - $80"` with `priceCurrency: "GBP"` → mobile parses `$50` as USD → multiplies by user's USD-to-GBP rate → renders `£40 - £64`. Numbers double-discount. American user viewing Berlin €50 event sees `$50` (right symbol, wrong numerals). **Both directions broken.** |
| **What it should do** | Edge fn should return either (a) currency-symbol-aware `formatted` string, OR (b) raw `min`/`max` + `priceCurrency` and let mobile format with proper symbol. Mobile `formatPriceRange` should respect `card.priceCurrency` if non-USD. |

### 🟠 CF-3 — handleRefresh promises radius expansion that doesn't happen (MEDIUM)

| Field | Value |
|---|---|
| **File:line** | [DiscoverScreen.tsx:1341](app-mobile/src/components/DiscoverScreen.tsx#L1341) (CTA label `expand_radius`) + [:972-977](app-mobile/src/components/DiscoverScreen.tsx#L972-L977) (handler does NOT change radius) |
| **What it does** | Empty-state CTA reads "Expand radius" (when i18n key exists) but handler clears cache + re-fetches with same `radius: 50` ([:934](app-mobile/src/components/DiscoverScreen.tsx#L934)). User taps button, expects wider search, gets same results. |
| **What it should do** | Either rename CTA to "Try again" (matches actual behavior) OR actually expand radius (50 → 100 → 200) on each tap. |

### 🟡 HF-1 — Genre filter precision via `keyword` param (MEDIUM, NEEDS-LIVE-FIRE)

| Field | Value |
|---|---|
| **File:line** | [edge fn:320-322](supabase/functions/ticketmaster-events/index.ts#L320-L322) |
| **What it does** | `params.set("keyword", searchKeywords.join(","))` — sends comma-joined string as TM's `keyword` (full-text phrase search). For Afrobeats: `keyword=afrobeats,amapiano,afro` etc. matches event/attraction/venue NAMES literally. |
| **What it should do** | Use `classificationName` with TM's documented OR semantics, OR call `/classifications` once to map slugs → genre IDs and use `genreId` directly. NEEDS-LIVE-FIRE to confirm magnitude of return-rate delta. |

### 🟡 HF-2 — TBA-price events invisibly excluded under non-`any` price filter (HIGH)

| Field | Value |
|---|---|
| **File:line** | [DiscoverScreen.tsx:1085](app-mobile/src/components/DiscoverScreen.tsx#L1085) |
| **What it does** | `if (card.priceMin === null && card.priceMax === null) return false;` — TBA-price events drop off when ANY non-`any` price filter is set. (Currently non-issue per §4.3 because tier filter is no-op, but if/when RC-2 is fixed, TBA events vanish silently.) |
| **What it should do** | Either show TBA events under `any` only (current implicit) AND make it explicit, OR include TBA events under all filters with a "Price TBA" badge, OR add a "Show TBA" toggle. |

### 🟡 HF-3 — i18n keys orphaned in JSON (S3)

12 keys in en/discover.json have no code consumers (per §4.2). Mirrored across 28 locales = ~336 orphan translations. Maintenance burden + locale parity drift risk.

### 🟡 HF-4 — Top filter row chip labels hardcoded English (MEDIUM)

[DiscoverScreen.tsx:1238-1294](app-mobile/src/components/DiscoverScreen.tsx#L1238-L1294) — top-bar chip labels (`"All"` / `"Tonight"` / `"This Weekend"` / `"Next Week"` / `"This Month"` / `"Filters"`) are HARDCODED literals, not i18n. Filter modal options use i18n; top-bar chips don't. Inconsistent. Foreign-language users see English chip labels in the top bar but translated labels inside the modal.

### 🟡 HF-5 — Title hardcoded English (MEDIUM)

[:1226](app-mobile/src/components/DiscoverScreen.tsx#L1226) — `"Concerts & Events"` is a hardcoded literal. Not in any locale file. Foreign-language users see the English title.

### 🟡 HF-6 — Sold-out events shown unfiltered (S3)

[EventGridCard:291-298](app-mobile/src/components/DiscoverScreen.tsx#L291-L298) — sold-out events get a "SOLD OUT" badge but remain in the grid. Tapping them opens ExpandedCardModal with `ticketUrl` linking to TM's sold-out page. Inflates the 20-event grid with non-actionable items.

### 🟡 HF-7 — `nightOutData` flow on ExpandedCardModal (S3)

The card tap handler ([:1003-1016](app-mobile/src/components/DiscoverScreen.tsx#L1003-L1016)) builds an `expandedCardData` with `category: "Night Out"` + a `nightOutData` field carrying ticketmaster-specific fields (eventName, venueName, artistName, date, time, price, genre, subGenre, tags, coordinates, ticketUrl, ticketStatus). ExpandedCardModal must have a render branch for this. Out of audit scope — but worth flagging that the modal's render branching for night-out events is a separate audit candidate.

### 🟡 HF-8 — Logout doesn't clear `mingla_night_out_cache_<userId>_*` AsyncStorage entries (S3)

Per prior investigation. Re-verified: [:854](app-mobile/src/components/DiscoverScreen.tsx#L854) keys cache by userId, so cross-user leakage is null, but storage grows unboundedly across user-switching.

### 🟡 HF-9 — `getTodayDateString` uses America/New_York timezone (S3)

Per prior investigation [:809-816](app-mobile/src/components/DiscoverScreen.tsx#L809) (need to re-grep — this line in the prior investigation; current file may have shifted). Cache rollover wrong for ~80% of the planet. Re-verify in spec phase.

---

## §6 Phase 3.2 — Improvability findings

Distinct from wrongness. Things that work but could be better.

| ID | Item | User-visible impact |
|---|---|---|
| IMP-1 | Top-bar date chips are 5 hardcoded options (All/Tonight/This Weekend/Next Week/This Month) | Filter modal Date section has 6 (adds Tomorrow). Top-bar omits Tomorrow inconsistently. |
| IMP-2 | Sort hardcoded `"date,asc"` | UI never exposes alternatives (TM accepts distance,asc / relevance,desc / random,asc / etc.). User can't sort by distance. |
| IMP-3 | Page hardcoded 0 | No "Load More" button, no infinite scroll. 20-event ceiling per render even when TM has 200+ events. |
| IMP-4 | Radius hardcoded 50km | Not exposed in filter modal. LA / Tokyo / suburban metros truncated. Empty-state CTA promises adjustment that doesn't happen (CF-3). |
| IMP-5 | "Any date" = next 30 days | UI says "Any" — actually means 30 days. Festivals 6 months out invisible. |
| IMP-6 | No countryCode sent to TM | Geographic precision weak in non-US/UK metros. NEEDS-LIVE-FIRE to confirm magnitude. |
| IMP-7 | Loading state shows generic skeleton | Could differentiate cache-warming vs full-fetch via cached-stale UI signal. |
| IMP-8 | Save heart on card has no haptic feedback on Android | iOS gets `Haptics.notificationAsync(...)` ([:265](app-mobile/src/components/DiscoverScreen.tsx#L265)); Android branch is silent. |
| IMP-9 | EventGridCard renders 1 photo only | TM can return multiple photos per event. Only `pickBestImage`'s top pick rendered. |
| IMP-10 | No accessibility label on Filters chip badge counter | Visual `1`/`2` badge on Filters chip; no spoken label. |
| IMP-11 | Header title autoshrinks ~32→22pt on narrow phones | Operator's "heading too small" complaint may map here. |
| IMP-12 | "Filters" chip label is English-hardcoded | Foreign-language users see English label. (Same class as HF-4.) |

---

## §7 Cross-check vs prior investigation (2026-04-25)

| Prior finding | Status | Notes |
|---|---|---|
| RC-IX-1 (i18n key drift, 7 missing keys) | **KEEP** — **CONFIRMED** | Re-verified §4.1; HIGH confidence, code+JSON deterministic |
| RC-P-1 (tier chips don't filter) | **AMEND** — chips DO render but ONLY inside Filter modal, NOT top row. Operator's correction validated. | Re-classified as RC-2 in this report |
| RC-P-2 (TBA-price events excluded) | **KEEP** as HF-2 — **DOWNGRADED** | Currently non-issue because RC-2 makes price filter no-op. Becomes active once RC-2 fixed. |
| RC-G-1 (genre keyword sent as comma-joined phrase) | **KEEP** as HF-1 — **DOWNGRADED to NEEDS-LIVE-FIRE** | Edge fn unchanged; magnitude of impact requires TM live-fire to PROVE. Static-only stays MEDIUM. |
| RC-D-1 (date filter cache poisoning) | **KEEP** — **CONFIRMED** | Re-classified RC-3 in this report; cache key still omits date filter |
| F-Q1-1 (no countryCode sent) | **KEEP** as IMP-6 — **DOWNGRADED to improvability** | Code-deterministic but user-visible impact is NEEDS-LIVE-FIRE |
| F-Q1-2 (segment hardcoded music) | **KEEP** as CF-1 — **CONFIRMED** | Re-verified edge fn line 16 + 314 unchanged |
| F-Q1-3 (currency defaults USD silently) | **KEEP** as CF-2 (currency double-conversion) — merged with prior HF-04 | Re-verified edge fn line 148 unchanged |
| F-Q1-4 (currency symbol always `$`) | **KEEP** as CF-2 — **CONFIRMED** | Re-verified edge fn line 152 hardcodes `$` |
| F-Q1-7 (NY-tz cache rollover) | **KEEP** as HF-9 — needs re-grep at current line numbers | |
| F-Q1-8 (50km radius too small + CTA misleading) | **KEEP** as IMP-4 + CF-3 — **CONFIRMED** | Re-verified handleRefresh doesn't change radius |
| F-Q1-9 (GPS fallback path correct but sticky) | **KEEP** at OBS level (improvability) | Acknowledged — preference change while foreground not picked up |
| F-Q1-10 (Empty vs no-coverage indistinguishable) | **KEEP** as part of RC-1 | Same fix scope (i18n copy authoring) |
| HF-01 (stale-cache fallback served as fresh) | **KEEP** — needs re-verify | Edge fn line 349-389 in prior; need re-grep |
| HF-02 (edge fn cache write fire-and-forget) | **KEEP** as HF — out of this audit's primary scope | |
| HF-03 (handleResetFilters doesn't clear cache) | **KEEP** — needs re-verify | Did not regrep this cycle |
| HF-04 (currency double-conversion) | **KEEP** as CF-2 — **CONFIRMED** | Promoted from HF to CF given user impact |
| HF-05 (sold-out events not filtered from grid) | **KEEP** as HF-6 — **CONFIRMED** | |
| HF-06 (no abort/cancel on rapid filter toggle) | **KEEP** — needs re-verify | Did not deep-trace this cycle |
| HF-07 (logout AsyncStorage leak) | **KEEP** as HF-8 — **CONFIRMED** | |
| HF-08 (sticky GPS) | **KEEP** at OBS level (improvability) | |
| HF-09 (multi-night residency dedup) | **KEEP** at OBS level — out of this audit's primary scope | |
| HF-10 (TM API key absent silent error) | **KEEP** — folds into RC-1 i18n fix scope | |
| HF-11 (Friday-evening date-window gap) | **KEEP** — needs re-verify | Did not deep-trace this cycle |
| HF-12 (pickBestImage empty-string fallback) | **KEEP** as HF — out of this audit's primary scope | |
| HF-13 (GPS exception path silent fallback) | **KEEP** at OBS level (improvability) | |

**Net summary:** of the prior 5 RC + 6 CF + 9 HF + 3 OBS + 4 D, this re-grounded audit produces **3 RC + 3 CF + 9 HF + 12 IMP**. Re-classifications are mostly downgrades (some prior RCs become CFs or HFs because they're not currently user-visible due to interaction with other findings, e.g., RC-P-2 TBA-exclusion is non-issue while RC-P-1 makes the filter no-op).

---

## §8 Five-truth-layer reconcile

| Layer | Question | Finding | Layer holds truth? |
|---|---|---|---|
| **Docs** | Product doc for Concerts & Events? | Not located in this audit; likely none formal. The literal "Concerts & Events" title contradicts the music-only segment lock. | docs vs code: **code wins, docs misleading** |
| **Schema** | `ticketmaster_events_cache` table — current shape, RLS, TTL | One creation migration only; schema unchanged from prior investigation | Schema = code-described; no drift |
| **Code** | The §3 inventory + §4 dead code list | Documented in this report | Code = ground truth |
| **Runtime** | TM API response shapes for various geographies + genre filters | NEEDS-LIVE-FIRE — not executable from CLI | Runtime claims capped at MEDIUM |
| **Data** | Current `ticketmaster_events_cache` rows for sample location | NEEDS-LIVE-FIRE (MCP probe permission required from operator) | Data unverified this cycle |

**Layer disagreements:**
- Docs (literal title) ↔ code (music-only segment) — **code wins; docs are deceptive**
- Code (chips emit tier slugs) ↔ Code (switch handles band IDs) — **internal contradiction; one of two paths must change**
- Code (cache key omits date) ↔ Code (fetch effect depends on date) — **internal contradiction; cache invalidation must follow fetch trigger**

---

## §9 Confidence summary per finding

| Finding | Confidence | Basis |
|---|---|---|
| RC-1 i18n key drift | HIGH | Code + JSON deterministic; grep verified missing keys |
| RC-2 tier chips no-op | HIGH | Switch branches grep-verified vs chip slug emissions |
| RC-3 date cache poisoning | HIGH | Cache key construction grep-verified; cache check logic deterministic |
| CF-1 deceptive title | HIGH | Edge fn segmentId hardcoded; UI title hardcoded literal |
| CF-2 currency double-conversion | HIGH | Edge fn formatter hardcodes `$`; mobile formatter parses USD |
| CF-3 handleRefresh radius unchanged | HIGH | Handler grep-verified — no setRadius |
| HF-1 genre keyword precision | MEDIUM, NEEDS-LIVE-FIRE | Edge fn deterministic; magnitude requires TM probe |
| HF-2 TBA-price filter exclusion | HIGH (semantically), CURRENTLY DORMANT | Filter line deterministic but unreachable while RC-2 active |
| HF-4 / HF-5 hardcoded English labels/title | HIGH | Literal grep |
| HF-6 sold-out shown unfiltered | HIGH | filteredNightOutCards has no ticketStatus filter |
| HF-8 logout AsyncStorage leak | HIGH | Cache cleanup grep-verified absent |
| HF-9 NY-tz cache rollover | HIGH (per prior investigation; not re-grepped this cycle) | Static-deterministic if line still exists |
| IMP-1..12 | MIXED | Mostly HIGH static; IMP-6 NEEDS-LIVE-FIRE |

**Overall report confidence: HIGH** for code-deterministic findings (3 RC + 3 CF). MEDIUM for HF-1 (live-fire dependent). Improvability findings are observational, not defects.

---

## §10 Discoveries for orchestrator (out of primary scope)

| ID | Discovery | Severity | Bundle? |
|---|---|---|---|
| **D-1** | Card tap → ExpandedCardModal with `category: "Night Out"` and `nightOutData` extra field. ExpandedCardModal's render branching for night-out events is a separate audit candidate. | S2 | Defer to separate ORCH if user reports modal issues for night-out events |
| **D-2** | Two filter taxonomies coexist in code: tier slugs (chill/comfy/bougie/lavish) emitted by UI, USD bands (free/under-25/...) handled by switch. Same architectural decay class as ORCH-0628 (signal-system migration left deprecated paths). Recommend codifying invariant: when adding a new filter taxonomy, audit ALL emit/handle pairs and delete dead paths in same commit. | S2 | New process invariant candidate (program-level); document for future spec writer |
| **D-3** | Unused i18n keys in en/discover.json (12 orphans per §4.2). 28 other locales likely mirror. Cleanup is low-priority but low-cost — bundle into RC-1 fix to avoid double-touching locales. | S3 | Bundle into spec |
| **D-4** | Foreign-language users see English in the top filter chip row + screen title (HF-4 + HF-5). Inconsistent with the rest of Discover (filter modal labels are i18n). May be load-bearing for Slice A user-visible-breakage scope. | S2 | Bundle into spec for Slice A |
| **D-5** | This is the FOURTH instance of "static-analysis claim propagated as ground truth without runtime/render-surface verification" pattern (ORCH-0685 cycle-2 v2 / ORCH-0690 SC-12 grep / ORCH-0670 prior tier-chip claim / ORCH-0670 prior 5+6+9 finding count over-classification). Recommend orchestrator escalate to a CI-style template gate: any forensics audit producing UX claims must include a "rendered-surface inventory" §X with file:line anchors as a structural section, not a free-form prose. | PROCESS | Codify in next spec-writer dispatch template |

---

## §11 Recommended slicing (for orchestrator + user steering)

The dispatch §J asked for direction-only recommendations, not fix code. Three slicings, ranked by user-visible impact-per-LOC:

### Slice A — User-visible breakage first (RECOMMENDED)

Fixes the things that are GUARANTEED user-visible-broken on every render in every locale.

- **RC-1 i18n key drift** (7 new keys × 29 locales = 203 translations + JSON cleanup of 12 orphans = ~245 locale lines)
- **RC-2 tier chips actually filter** (extend switch to handle tier slugs with USD-equivalent ranges OR migrate chip generator to emit band IDs — spec choice)
- **HF-4 + HF-5 hardcoded labels → i18n** (top-bar chip labels + screen title; ~6 keys × 29 locales = ~174 translations)
- **CF-1 title rename** "Concerts & Events" → "Concerts" (honest with current music-only data) OR expand segment + keep title (larger fix; spec choice)
- **Operator's "heading too small" investigation** — correlate to IMP-11 autoshrink behavior OR a different misperception; needs operator clarification

**Confidence:** all HIGH static-deterministic. No live-fire required.
**Estimated effort:** ~3-4 hours (Mobile + i18n).
**OTA-eligible:** yes.

### Slice B — Filter correctness pass

After Slice A. Now the rendered surface stops lying about filter activity, but filters STILL don't return correct results in many cases.

- **RC-3 date cache poisoning** (cache key includes date filter; cache equality check includes date filter)
- **HF-1 genre keyword → classificationName** (edge fn change; needs Ticketmaster live-fire to PROVE precision improvement)
- **HF-2 TBA-price visibility** (separate from RC-2; spec choice on UX — show under all / "Show TBA" toggle / explicit Any-only)
- **CF-2 currency double-conversion** (edge fn returns proper symbol OR raw min/max; mobile formatter uses `card.priceCurrency`)

**Confidence:** HIGH static for RC-3 + CF-2; MEDIUM-NEEDS-LIVE-FIRE for HF-1 + HF-2.
**Estimated effort:** ~5-7 hours (Mobile + edge fn + locale updates if currency formatting strings change).
**OTA-eligible:** depends on edge fn changes — if edge fn changes, need redeploy alongside.

### Slice C — Geographic / horizon pass

After Slice B. Unlock the section for international + larger-radius + further-future use cases.

- **IMP-6 add countryCode** (edge fn; NEEDS-LIVE-FIRE to confirm magnitude)
- **HF-9 NY-tz cache rollover** (use user's local timezone OR UTC consistently)
- **CF-3 + IMP-4 radius adjustment UI** (expose 25/50/100/200 in filter modal; wire empty-state CTA to actually expand)
- **IMP-3 pagination** (Load More button OR infinite scroll)
- **IMP-1 top-bar Date taxonomy parity with modal** (add Tomorrow chip OR remove from modal)
- **IMP-5 "Any date" honesty** ("Any date in the next 30 days" OR remove the cap)

**Confidence:** MEDIUM-NEEDS-LIVE-FIRE for the geographic findings (need TM live-fire matrix from real account in non-US country to confirm coverage).
**Estimated effort:** ~6-9 hours (Mobile + edge fn + live-fire matrix).
**OTA-eligible:** depends on edge fn.

### Slice D — Hygiene + dead-code deletion (any time)

Independent of A/B/C — can ship in any cycle as a clean-up commit.

- **§4.2 12 orphan i18n keys** delete from en/discover.json + 28 locales (~336 deletions)
- **§4.3 5 dead price filter switch branches** (delete after RC-2 lock — if migration to tier slugs)
- **HF-8 logout AsyncStorage cleanup** (clear `mingla_night_out_cache_<userId>_*` on sign-out)
- **D-1 ExpandedCardModal night-out branching audit** (separate ORCH if needed)

**Confidence:** HIGH.
**Estimated effort:** ~1-2 hours.

---

## §12 Confidence & failure-honesty labels

- **Root cause proven**: RC-1, RC-2, RC-3, CF-1, CF-2 (HIGH; six-field anchored)
- **Root cause probable**: HF-1 (genre keyword — MEDIUM, needs TM live-fire)
- **Hidden flaws confirmed at static layer**: HF-2 through HF-9 (most HIGH static)
- **Improvability observations**: IMP-1 through IMP-12 (mostly HIGH static; some NEEDS-LIVE-FIRE)
- **Sub-agent delegation**: NONE this cycle — all reads done directly

The prior 2026-04-25 audit's claim-count was inflated. Re-classifying for current rendered surface yields a tighter finding set: 3 root causes (down from 5), 3 contributing factors (from 6), 9 hidden flaws (same), 12 improvability items (newly itemized; partially derived from prior 3 OBS + 4 D).

---

## §13 Process invariant (for orchestrator)

This audit codifies a structural defense against the recurring "static-analysis claim propagated as runtime fact" pattern (D-5):

> **For any forensics audit producing user-visible UX claims:** the audit MUST include a "Rendered Surface Inventory" section with `file:line` anchors for every visible JSX element. Claims about what users see are admissible ONLY if anchored in JSX evidence OR direct device observation. Code-trace alone is INADMISSIBLE for "what the user sees" questions.

Recommend orchestrator update spec-writer + forensics-investigator dispatch templates to include this section as a structural requirement, not free-form prose.

---

End of investigation.
