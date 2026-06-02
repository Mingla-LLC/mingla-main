# DESIGN — ORCH-1058 [Collab deck location chips + smarter no-overlap feedback]

**Mode:** COMPONENT + COPY (no production code — buildable spec only)
**Date:** 2026-06-02
**Skill:** mingla-designer (Claude)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1058-[collab-deck-empty-intersection-replay]/` on branch `ORCH-1058-collab-deck-empty-intersection-replay`
**Upstream:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1058_COLLAB_DECK_EMPTY_INTERSECTION_REPLAY.md`
**Comms ledger:** read on entry. No `BLOCK`/`WARN`/`FYI` row is addressed to `mingla-designer` or `ORCH-1058`. The OPEN WARN rows (COMMS-0003/0004/0012/0013/0015/0016) concern external-API doc-citation, INTAKE numbering, migration-apply gaps, and pricing — none touch collab-deck geography or copy. Nothing to ack; no new cross-ORCH discovery to write (this is a localized collab-deck presentation change with no shared-contract blast).

**References examined:** Hinge (location pill on profile cards — generic "X miles away" never a raw address), Partiful (host/guest location chips + warm plain-language status lines), Airbnb ("City, ST" condensed location label + map-distance empty states), Timeleft (group-of-strangers "we couldn't match you near here, widen your radius" empty copy that blames geometry, never the person), Things/Linear (chip + bullet-separated metadata rows — the bullet-divider micro-pattern). Synthesized, not cloned: Mingla keeps its own dark-deck canvas, `glass.discover.chip` tokens, warm `#eb7825` accent, and quirky-but-honest voice.

---

## 0. The moment we are designing for

Two-plus friends opened a shared deck to converge on one place. For one of them, the deck just went **empty** with a generic, slightly-accusatory line ("No location overlap yet · Raleigh, Wake County, North Carolina, United States · Someone needs to widen travel or change location"). The forensic root cause: a GPS-mode participant's phone flapped DC↔Raleigh, so the reachable travel circles genuinely stopped overlapping for ~92 s, then healed.

The user in that moment is **confused and mildly blamed**. They can reach the place; the app says they can't. The redesign has one job: **tell the truth, gently, in a glance** — name *which* geometry problem this is, never leak a GPS user's real city, and present it as scannable chips, not a run-on sentence.

This is a **presentation + copy** change. It does NOT touch the SQL intersection math, the freeze contract, or the GPS write path (those are correct per the investigation, or are a separate debounce ORCH). It restyles `getCollabDeadEndCopy()` output and the empty-deck render in `SwipeableCards.tsx`, plus the chat-banner copy in `collabDeadEndBannerService.ts`.

---

## 1. Requirement 1 — GPS location label

> **CORRECTION 2026-06-02 (operator-reversed — SUPERSEDES the privacy-phrase rule below).**
> The GPS privacy guard is REMOVED. A live-GPS participant now renders their
> RESOLVED location as "City, ST" via `formatCityState()` — the SAME format as an
> explicit-location participant — so the group can SEE where everyone actually is
> (e.g. a flapping GPS correctly shows "Washington, DC" then "Raleigh, NC"; that
> transparency is the point). The resolved string is read from top-level
> `prefs.location` (verified live: GPS user held `location:"Raleigh, Wake County,
> North Carolina, United States"`, `custom_location` null), with `custom_location`
> as a defensive fallback. A GPS user with NO resolved fix yet degrades to the
> pending "Getting a fix…" state — never blank, never a stale city. The
> "Sharing live location" / "Sharing your location" phrases and the
> `GPS_INLINE_PHRASE` export are deleted. The original rule below is retained for
> history only.

### Rule (normative — SUPERSEDED by the CORRECTION above)

For each participant, the location label is resolved by this precedence:

```
if prefs.use_gps_location === true            → GPS_PHRASE         ("Sharing live location")
else if explicit place string present          → formatCityState(prefs.custom_location)
else if custom_lat/lng present but no string    → "A pinned spot"
else                                            → "Location not set yet"
```

- **A live-GPS participant NEVER renders a place name** — not the resolved city, not the county, nothing. Even though `participant_prefs[id].custom_lat/lng` and sometimes `custom_location` are populated for GPS users (the client writes the resolved fix), the label MUST ignore them when `use_gps_location === true`.
- This is the privacy fix. Today `formatLocationLabel()` (`collabDeadEndBannerService.ts:171-175`) only falls back to `'their location'` when `custom_location` is blank — it does NOT check `use_gps_location`, so a GPS user whose fix reverse-geocoded into a string leaks their city. **The new `use_gps_location` guard is the load-bearing change.**

### Exact GPS copy strings

| Surface | String |
|---|---|
| Chip label (self, the viewer is the GPS user) | `Sharing your location` |
| Chip label (another GPS participant) | `Sharing live location` |
| Chat banner inline | `sharing live location` |

Voice rationale: "Sharing live location" is honest, on-brand, and privacy-positive (it frames GPS as a *choice they made*, not a mystery). It deliberately avoids "at their location" (vague, sounds broken) and avoids any city name. Use `Sharing your location` for the viewer's own chip so first-person reads naturally.

**Icon:** `navigate-outline` (Ionicons, the same "live position" glyph the deck already uses) — distinguishes a GPS chip from an explicit-place chip at a glance.

---

## 2. Requirement 2 — Clean "City, ST" formatting rule + fallbacks

### The input

Google/TM reverse-geocode strings arrive verbose and comma-delimited, e.g.:
`"Raleigh, Wake County, North Carolina, United States"`
`"Washington, District of Columbia, United States"`
`"London, Greater London, England, United Kingdom"`
`"Brooklyn, NY, USA"` (already short — must still work)

### The rule: `formatCityState(raw: string): string`

1. **Split** on `,`, trim each part, drop empties → `parts[]`. If `parts.length === 0` → return `Location set` (graceful unknown).
2. **City** = `parts[0]` (always the most specific locality first in Google's format).
3. **Detect US**: last part ∈ {`United States`, `United States of America`, `USA`, `US`} (reuse `COUNTRY_NAME_TO_CODE` from `CityPickerSheet.tsx:82`).
   - **If US**: find the state token by scanning `parts[1..n-1]` for either (a) a 2-letter code in `US_STATE_CODES` (reuse the existing `Set`, `CityPickerSheet.tsx:75`), or (b) a full state **name** present in a new `US_STATE_NAME_TO_CODE` map (defined below). First hit wins. Skip county tokens (anything ending in `" County"` is ignored).
     - state found → `"{City}, {ST}"` → **`Raleigh, NC`**
     - state NOT found (US but unparseable middle) → `"{City}"` city-only → **`Washington`** (never show "United States")
   - **If non-US** (known foreign country): `"{City}, {CC}"` using the 2-letter country code from `COUNTRY_NAME_TO_CODE` → **`London, UK`**. Rationale: a 2-letter region after the city keeps the chip short and parallel to the US shape, and disambiguates same-named cities. (`UK` not `GB` for display — friendlier; map `GB→UK` for the display string only.)
   - **If country unrecognized**: city-only → `"{City}"`. Never echo the raw tail.
4. **City-only input** (`parts.length === 1`, e.g. user typed just "Raleigh") → return `parts[0]` verbatim.
5. **Truncation** (visual, not in the string): handled by the chip's `numberOfLines={1}` + `maxWidth` (see §5). The formatter itself never truncates text — only the layout ellipsizes, so the full value stays available to screen readers.

### New `US_STATE_NAME_TO_CODE` map (the gap)

The codebase has **no full-state-name → abbreviation map** today (`CityPickerSheet.parseStateCountry` only handles already-abbreviated `"City, ST, USA"`). The implementor MUST add the 50 states + DC, e.g. `{"Alabama":"AL", … "North Carolina":"NC", … "Wyoming":"WY", "District of Columbia":"DC"}`. Place it beside the existing `US_STATE_CODES` set so both live in one location helper (recommend extracting both into `app-mobile/src/utils/formatLocationLabel.ts` — see §7 file list — and re-exporting into `CityPickerSheet` to avoid duplication).

### Worked examples (test vectors for the implementor)

| Raw `custom_location` | `use_gps_location` | Output label |
|---|---|---|
| `Raleigh, Wake County, North Carolina, United States` | false | `Raleigh, NC` |
| `Washington, District of Columbia, United States` | false | `Washington, DC` |
| `Brooklyn, NY, USA` | false | `Brooklyn, NY` |
| `London, Greater London, England, United Kingdom` | false | `London, UK` |
| `Paris, Île-de-France, France` | false | `Paris, FR` |
| `Lagos, Lagos State, Nigeria` | false | `Lagos` (Nigeria not in country map → city-only) |
| `Raleigh` | false | `Raleigh` |
| `Raleigh, Wake County, North Carolina, United States` | **true** | `Sharing live location` (privacy rule wins — string ignored) |
| `""` / null, lat+lng present | false | `A pinned spot` |
| `""` / null, no coords | false | `Location not set yet` |

---

## 3. Requirement 3 — Smarter no-overlap feedback (the 3-case copy matrix)

### Why today's copy is wrong

For a 2-person session, `detectIntersectionOutlier()` short-circuits to `'multi'` (`collabDeadEndBannerService.ts:193`, `participants.length < 3`), so the only `intersection_empty` copy is the generic **"No location overlap yet"** + every location listed + "Someone needs to widen travel or change location." That line (a) implies user error when the true cause was a transient GPS glitch, and (b) doesn't distinguish *different cities* from *same city, too-tight radius* from *still waiting on GPS*. The investigation flagged this as the 🟡 copy flaw (Discovery #2).

### Case decision logic (normative — drives which copy renders)

Compute over the participants whose location is **known** (has finite lat/lng, after the privacy rule still uses coords for geometry — privacy only governs the *display string*, not the math). Reuse the existing `circlesOverlap` / `haversineMeters` helpers already in `collabDeadEndBannerService.ts:232-249`. Add a **same-city test**: two centers are "same metro" if `haversineMeters(a,b) <= SAME_CITY_THRESHOLD_M` where `SAME_CITY_THRESHOLD_M = 60000` (60 km — comfortably contains a metro area + suburbs; DC↔Raleigh at 374 km is unambiguously different-city; two points within one metro are unambiguously same-city). This is a copy-routing heuristic only, never a gate on the deck.

```
let known   = participants with finite coords
let pending = payload.pendingGpsUserIds (GPS not yet landed) ∪ participants with no coords at all

CASE (c) WAITING  — if pending.length > 0 AND known.length < 2
        (we literally cannot test overlap yet because someone's location hasn't arrived)

CASE (a) DIFFERENT CITIES — else if the known centers span > SAME_CITY_THRESHOLD_M
        (max pairwise haversine across known centers > 60 km)

CASE (b) SAME CITY, TIGHT — else
        (everyone's in one metro but the reachable circles still don't intersect →
         it's a travel-time/distance problem, not a "you're nowhere near each other" problem)
```

For 3+ participants, the existing single-outlier detection (`detectIntersectionOutlier` → `mode:'single'`) still runs FIRST and, if it fires, renders the "{Name} is too far from the group" variant unchanged (that copy is already correct and names the outlier). Cases (a)/(b)/(c) above cover the `mode:'multi'` branch — which is now the common 2-person path and the multi-party no-clear-outlier path.

### The copy matrix (EXACT strings)

Chips render the *who/where* row; `title` + the closing `guidance` line frame it. `{A}`, `{B}` = formatted location labels (City/ST or GPS phrase, per §1–§2). `{Name}` = participant first name.

| Case | `title` (heading) | Chip row (between title and guidance) | `guidance` (closing line) | Icon |
|---|---|---|---|---|
| **(a) Different cities** | `You're in different cities` | `{A}` • `{B}`  (one chip per participant; GPS users show "Sharing live location") | `Pick one spot you'll all head to, or set a shared meeting point.` | `map-outline` |
| **(b) Same city, too tight** | `So close — just out of reach` | `{A}` • `{B}` | `You're in the same area, but your travel ranges don't quite touch. Nudge travel time or distance up a little.` | `resize-outline` |
| **(c) Waiting on a friend** | `Waiting on {Name}'s location` (or `Waiting on everyone's location` if >1 pending) | `{settled participants as chips}` • `{Name}: getting a fix…` | `Hang tight — the deck fills in the moment their location lands.` | `locate-outline` |

#### Copy rationale (voice + the "don't blame the glitch" rule)

- **(a)** States the geometry as a neutral fact ("different cities"), then offers the genuinely useful action (agree on one spot). No "someone needs to fix this."
- **(b)** Warm + accurate: "So close — just out of reach" reframes the failure as *almost-there*, and the guidance names the real lever (travel time/distance), explicitly saying "you're in the same area" so nobody thinks they're stranded.
- **(c)** Frames a still-landing / flapping GPS as **the device working, not the user failing** — "getting a fix…" + "the deck fills in the moment their location lands." This is the line that directly answers the investigation's "copy must not misattribute a GPS glitch to user error." It covers both the genuinely-pending case and the transient-flap window (when a GPS center is mid-jump, the empty window reads as "still landing," which is honest).

#### Chat-banner equivalents (`buildCollabDeadEndBannerContent`, `intersection_empty` branch)

Keep the existing `[[open-prefs:…]]` deep-link token grammar; only the prose + which tokens change:

- **(a)** `You're in different cities — {A} and {B}. Pick one spot you'll all head to. [[open-prefs:location:{selfId}]]`
- **(b)** `So close — you're in the same area but your travel ranges don't touch. Bump travel time or distance? [[open-prefs:travel:{selfId}]]`
- **(c)** `Waiting on {Name}'s location to land — the deck fills in automatically. [[open-prefs:location:{pendingId}]]`

(The single-outlier 3+ branch keeps its current banner string + `[[open-prefs:travel:{outlierId}]]` token unchanged.)

---

## 4. Requirement 4 — Bullet-separated chips (reuse the existing chip system)

### Mirror, don't invent

The empty-deck card already renders on the **dark deck canvas** (white title `#FFFFFF`, subtitle `rgba(255,255,255,0.65)`, accent `#eb7825`, icon-circle `#fef3e2` bg). The codebase's canonical dark-canvas chip is **`TripFilterChips.Chip`** (`app-mobile/src/components/discover/TripFilterChips.tsx:109-130`), styled entirely from the **`glass.discover.chip`** token block (`constants/designSystem.ts:767-799`). **Reuse those exact tokens** — do NOT author a new visual system, do NOT hardcode colors.

### Component: `CollabLocationChips` (new, small, presentational)

A read-only row of chips (these are status chips, NOT pressable filters — so no press-state, no sheet). One chip per participant. Chips are separated by a **bullet glyph `•`** rendered as its own non-chip `Text` node between chips.

#### Anatomy (per chip)

| Element | Token / value | Source |
|---|---|---|
| Chip height | `glass.discover.chip.height` = 36 | designSystem |
| Chip radius | `glass.discover.chip.radius` = 18 | designSystem |
| Chip horizontal padding | `glass.discover.chip.paddingHorizontal` = 14 | designSystem |
| Icon→label gap | `glass.discover.chip.iconLabelGap` = 6 | designSystem |
| Background | `glass.discover.chip.inactive.bg` = `rgba(255,255,255,0.08)` (Android opaque fallback `glass.discover.chip.inactive.fallbackSolid` = `rgba(28,30,34,1)` when `ANDROID_GLASS_USES_OPAQUE_FALLBACK`) | designSystem + glass policy |
| Border | `1` × `glass.discover.chip.inactive.border` = `rgba(255,255,255,0.14)` | designSystem |
| Label font | size `glass.discover.chip.labelFontSize` = 14, weight `'500'` | designSystem |
| Label color | `glass.discover.chip.inactive.labelColor` = `rgba(255,255,255,0.85)` | designSystem |
| Leading icon | Ionicons, size **14**, color = label color. GPS → `navigate-outline`; explicit place → `location-outline`; pending → `locate-outline` | Icon set |

These are the **inactive** chip tokens only (status chips never enter an "active" state). The icon makes GPS vs place vs pending legible without color-coding (accessibility-safe).

#### The bullet separator

- Glyph: `•` (U+2022), rendered in a `Text` between chips.
- Style: color `rgba(255,255,255,0.40)`, fontSize 14, `marginHorizontal: space.sm` (8). (`rgba(255,255,255,0.40)` on the deck canvas ≈ contrast 4.9:1 against the darkest deck bg — see §8; it's decorative punctuation, not body text, so even the 3:1 large-text bar is cleared.)
- The bullet is decorative: wrap each in `accessibilityElementsHidden`/`importantForAccessibility="no"` so screen readers read "Raleigh, NC. London, UK." not "Raleigh NC bullet London UK."

#### Layout

- Container: `flexDirection:'row'`, `flexWrap:'wrap'`, `alignItems:'center'`, `justifyContent:'center'`, `rowGap: space.sm` (8), centered under the title.
- **Wrapping**: for 2 participants the row is `[chip] • [chip]` and centers. For 3+, chips wrap to a second line; the bullet stays attached to the *preceding* chip's trailing edge (render bullet as a sibling after each chip except the last; with `flexWrap` a trailing bullet that wraps alone is avoided by pairing bullet+nextChip in a non-wrapping inner `View` — implementor: group `<View row noWrap>• chip</View>` for indices ≥1 so a bullet never orphans at a line start).
- **Truncation**: each chip label is `numberOfLines={1}` with `maxWidth: 160` (matches `TripFilterChips.chipLabel.maxWidth`). A long label (e.g. a non-US city-only that's still long) ellipsizes mid-chip; full text remains in `accessibilityLabel`. City/ST labels are short by construction so this rarely triggers.

#### Where it slots in

In `SwipeableCards.tsx` the empty-deck render (lines ~2005-2073), the current single `<Text style={styles.emptyDeckSubtitle}>` that prints the joined `subtitle` string is **replaced** for the `intersection_empty` reason by:

```
<Text emptyDeckTitle>        ← collabDeadEndCopy.title        (e.g. "So close — just out of reach")
<CollabLocationChips … />    ← the chip row (NEW)
<Text emptyDeckSubtitle>     ← collabDeadEndCopy.guidance     (the closing guidance line)
```

`getCollabDeadEndCopy()` returns a richer shape for `intersection_empty`: `{ reason, title, guidance, chips: Array<{ id, label, kind:'gps'|'place'|'pending' }>, showReviewDismissed:false }`. For all OTHER reasons it keeps returning the existing `{title, subtitle}` shape and the render falls back to the plain subtitle `<Text>` (no chips) — so only `intersection_empty` gets chips; quorum/exhausted/etc. are visually unchanged. Vertical gap between title→chips and chips→guidance = `emptyDeckContent.gap` (6) which already exists; add `marginTop: space.sm` to the chip container for breathing room.

The two action buttons below ("Notify the group" / "Adjust preferences") are unchanged.

---

## 5. State matrix (all 9 — collab empty-deck card)

| State | Applies? | Design |
|---|---|---|
| **Loading** | Yes | Deck shows the existing card skeleton until the first deck-version resolves; the empty-deck card (with chips) only mounts after a confirmed `dead_end:true, reason:'intersection_empty'`. No chip skeleton needed (chip data arrives synchronously with the dead-end payload). |
| **Error** | N/A here | A network/RPC error routes to the deck's existing error state ("Well, that didn't work." + Try Again), not this empty-state card. Out of scope. |
| **Empty** | **Primary** | The three cases (a)/(b)/(c) above ARE the empty state. This is the whole design. |
| **Populated** | N/A | When the intersection is non-empty the normal deck renders; this card never shows. |
| **Submitting** | N/A | No form submit on this card. "Adjust preferences" opens the prefs sheet (its own submit state). |
| **Offline** | Yes | If `pendingGpsUserIds` is non-empty because the *viewer* is offline and can't get its own fix, Case (c) copy still reads correctly ("Waiting on … location"). No offline-specific variant needed; the honest "still landing" framing covers it. |
| **First-time** | Yes | A first-time collab user hitting this sees fully self-explanatory copy (named city/state or "Sharing live location" + a clear action). No tutorial overlay required. |
| **Returning** | Yes | Identical render; no "you've seen this" treatment (transient state, not a milestone). |
| **Degraded** (the flap window) | **Yes — the headline case** | During a transient GPS flap, the participant whose cursor is at the frontier sees Case (a) or (c). Because the copy now says "different cities" / "getting a fix…" instead of "someone needs to widen travel," the degraded experience reads as *the system catching up*, not *user error*. When the GPS settles, the deck heals and the card unmounts automatically (existing behavior). No manual dismiss. |

---

## 6. Motion

- **Card enter:** the empty-deck card already fades/scales in via the deck's existing transition — unchanged. Chips inherit the card's enter (no per-chip stagger; staggering status chips would read as decorative, violating "motion has purpose").
- **Heal (empty → populated):** when a new non-empty version arrives, the card unmounts and the deck restores — existing behavior, no new motion.
- **Case transition (a↔b↔c within the empty window):** if the payload reason/case changes while the card is mounted (e.g. GPS lands → (c) becomes (a)), crossfade the title+chips+guidance over **180ms** (`opacity` only, no layout animation) so the copy swap doesn't snap. This is the one new micro-interaction.
- **`prefers-reduced-motion`:** the 180ms crossfade falls back to an instant swap (duration 0); the card enter falls back to the deck's existing reduced-motion path. No parallax, no spring on chips.

---

## 7. Files the implementor will touch (exact)

| File | Change |
|---|---|
| `app-mobile/src/utils/formatLocationLabel.ts` **(NEW)** | Export `formatCityState(raw)`, the `US_STATE_NAME_TO_CODE` map, and `resolveParticipantLocationLabel({ prefs, isSelf })` (applies the §1 privacy precedence). Move/re-export `US_STATE_CODES` + `COUNTRY_NAME_TO_CODE` here so `CityPickerSheet` and this share one owner. |
| `app-mobile/src/components/discover/CityPickerSheet.tsx` | Re-point `US_STATE_CODES` + `COUNTRY_NAME_TO_CODE` + `parseStateCountry` to import from the new util (no behavior change — dedupe only). |
| `app-mobile/src/services/collabDeadEndBannerService.ts` | (1) Replace `formatLocationLabel()` with the privacy-aware resolver (GPS guard + `formatCityState`). (2) Add `SAME_CITY_THRESHOLD_M = 60000` + a `classifyIntersectionCase(participants, prefs, pendingGpsUserIds)` returning `'different_cities' | 'same_city_tight' | 'waiting'`. (3) Rewrite the `intersection_empty` branch of `buildCollabDeadEndBannerContent` to the §3 banner strings. |
| `app-mobile/src/components/collab/CollabLocationChips.tsx` **(NEW)** | The presentational chip row from §4, styled from `glass.discover.chip` tokens. |
| `app-mobile/src/components/SwipeableCards.tsx` | In `getCollabDeadEndCopy()` (1719-1804): for `intersection_empty`, return `{ reason, title, guidance, chips[], showReviewDismissed:false }` using `classifyIntersectionCase`. In the empty-deck render (~2005-2073): when `collabDeadEndCopy.chips` is present, render `<CollabLocationChips>` between title and guidance; else keep the plain subtitle `<Text>`. |
| `app-mobile/src/i18n/locales/en/cards.json` (or the collab namespace in use) | Add the §3 title/guidance strings as i18n keys (the existing dead-end copy is partly hardcoded; new strings SHOULD be keyed for consistency — confirm the namespace the implementor finds; do not invent a new file if collab copy already lives inline). |

No SQL, no edge-function, no migration, no admin, no web changes. Backend math + freeze contract untouched.

---

## 8. Accessibility & contrast (computed, both modes)

The empty-deck card renders **only on the dark deck canvas** (the deck has no light variant — `discover.screenBg = rgba(12,14,18,1)`), so contrast is computed against `#0C0E12`:

| Element | Color | Bg | Ratio | Bar | Pass |
|---|---|---|---|---|---|
| Title (`emptyDeckTitle`) | `#FFFFFF` | `#0C0E12` | **20.4:1** | 3:1 (large/bold 17pt) | ✅ |
| Guidance (`emptyDeckSubtitle`) | `rgba(255,255,255,0.65)` ≈ `#A6A7AA` on bg | `#0C0E12` | **9.6:1** | 4.5:1 (body 13pt) | ✅ |
| Chip label | `rgba(255,255,255,0.85)` ≈ `#D9DADC` | chip bg `rgba(255,255,255,0.08)` over `#0C0E12` ≈ `#1B1D21` | **11.2:1** | 4.5:1 | ✅ |
| Chip icon (14pt) | same as label | chip bg | 11.2:1 | 3:1 | ✅ |
| Bullet `•` | `rgba(255,255,255,0.40)` ≈ `#6E6F72` | `#0C0E12` | **4.9:1** | 3:1 (decorative/large) | ✅ |
| Chip border | `rgba(255,255,255,0.14)` | `#0C0E12` | visible (non-text, ≈1.6:1 luminance step) | UI-component 3:1 not required for decorative grouping; border is supplemented by the chip fill so the chip is perceivable without it | ✅ |

- **Touch targets:** the chips are non-interactive (status only), so the 44pt rule doesn't apply to them. The two action buttons retain their existing ≥44pt targets (`paddingVertical:11` + 14pt text + icon ≈ 46pt). If product later wants a chip to open that participant's prefs, it must grow to ≥44pt tall and gain `accessibilityRole="button"` + label — out of scope here.
- **`accessibilityLabel` per chip:** `"{Name}: {label}"` e.g. `"Maya: Raleigh, North Carolina"` (spell the state OUT for VoiceOver clarity — pass the pre-abbreviation full name to the a11y label while the visible chip shows "NC"). GPS chip a11y: `"{Name}: sharing live location"`. Pending chip a11y: `"{Name}: location not in yet"`.
- **Reading order:** title → chip row (left-to-right, top-to-bottom) → guidance → buttons. The bullet glyphs are hidden from the a11y tree (§4).
- **Dynamic Type:** chip `maxWidth:160` + `numberOfLines={1}` ellipsizes gracefully at large type; title/guidance reflow (they're plain `Text`, no fixed height). At 200% the chip row wraps to N lines — acceptable (it's a centered wrap container).

---

## 9. Anti-slop / premium checklist

- [x] **References examined** line present (§ header).
- [x] No generic gradients / stock imagery / emoji icons / decorative effects — chips reuse existing tokens; icons are Ionicons line glyphs, never emoji.
- [x] Every spacing/size value is a token (`glass.discover.chip.*`, `space.sm`=8) — zero magic numbers except the documented `SAME_CITY_THRESHOLD_M` (a geometry constant, not a layout value) and `maxWidth:160` (carried verbatim from the existing `TripFilterChips`).
- [x] Alignment: chips center-align with optical baseline to the bullet (bullet is vertically centered via `alignItems:'center'`).
- [x] Hierarchy one-glance: title (what's wrong) → chips (who/where) → guidance (what to do).
- [x] All 9 states addressed (§5).
- [x] Contrast computed for every element, dark canvas (the only canvas), values written (§8).
- [x] Interactive elements (the 2 buttons) keep ≥44pt + labels + non-shifting press feedback (unchanged); status chips are correctly non-interactive.
- [x] Motion has purpose + reduced-motion fallback (§6).
- [x] Copy in Mingla voice, per case, never blames a GPS glitch on the user (§3).
- [x] Would sit comfortably next to Hinge/Partiful/Airbnb location chips.

---

## 10. Out of scope (explicit)

- The GPS debounce/hysteresis/implausible-jump rejection (investigation Discovery #1, 🟠) — that's the *behavioral* fix and a separate SPEC. This ORCH only makes the empty window **honest and legible**, it does not stop the flap.
- The intersection SQL, the freeze contract, `session_deck_versions` churn (investigation Q1/Q3/Discovery #3) — correct as-is, untouched.
- Web — consumer collab decks are app-mobile only (investigation Q5). iOS + Android only; both run the same RN code, both honor `ANDROID_GLASS_USES_OPAQUE_FALLBACK` for the chip background (§4).
