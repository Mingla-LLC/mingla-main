# SPEC — ORCH-0824-F — Public event page + consumer sheet render parity for new ORCH-0824 fields

**Mode:** SPEC
**Date:** 2026-05-13
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824-F_PUBLIC_EVENT_PAGE_AND_SHEET_PARITY.md`](../reports/INVESTIGATION_ORCH-0824-F_PUBLIC_EVENT_PAGE_AND_SHEET_PARITY.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## Operator-locked decisions

1. **Scope on public page**: ADDITIVE ONLY — insert new sections; do not restructure existing layout.
2. **Sheet alignment**: same content as public page, sheet-native form factor.
3. **City when `hideAddressUntilTicket=true`**: NO CHANGE. The brand's choice governs both address AND city visibility. Buyer sees "Address shared after ticket purchase" only — no city leak. (Operator answer: "if they want it shown, show it" — interpreted as "honor the existing toggle".)
4. **Chip colors**: match consumer sheet (Party Type = orange-tinted; Vibe = neutral glass; Music Genre = blue-tinted).
5. **Section order on public page**: Party Type chips next to brand chip; Vibes + Music Genres grouped before "About" section.
6. **Sheet "About" header**: add "About" heading above the description in the consumer sheet.

---

## 1. Scope + non-goals

### Scope
- `mingla-business/src/components/event/PublicEventPage.tsx` (the `PublishedBody` sub-renderer at lines 396–650) — additive sections for ORCH-0824 taxonomy chips.
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` — add "About" heading above description; otherwise the sheet's existing chip rendering is already aligned with the spec.

### Non-goals
- No changes to `CancelledVariant` or `PasswordGateVariant` of PublicEventPage (those are status-variant renderers that don't show ORCH-0824 fields anyway).
- No changes to address-hiding logic. `hideAddressUntilTicket=true` keeps hiding everything.
- No map preview using `locationGeo`. Future polish ORCH.
- No ticket-tier preview in the consumer sheet. Defer.
- No schema, edge function, RPC, or service-layer changes. Data already flows through to both render sites.
- No localization work. English-only chip labels (same constraint as wizard + filter UI).

### Assumptions
- `LiveEvent.partyTypes`, `LiveEvent.vibeTags`, `LiveEvent.musicGenres`, `LiveEvent.city` are populated for new events. Legacy events may have empty arrays / null — render gracefully (sections hidden when empty).
- `mingla-business/src/constants/eventTaxonomy.ts` exports PARTY_TYPES, VIBE_TAGS, MUSIC_GENRES with the canonical slug→label mapping. Reuse those for chip labels.
- `app-mobile/src/constants/eventTaxonomy.ts` is byte-equivalent (CI parity gate enforces).

---

## 2. PublicEventPage layout spec

### 2.1 Final section order (`PublishedBody`)

```
┌─ Cover hero (image / hue band / video)                    [UNCHANGED]
├─ Title + status badge                                     [UNCHANGED]
├─ Dates list (master + multi-date expand)                  [UNCHANGED]
├─ Brand row: brand tile + name + [NEW] Party Type chips    [+CHIPS]
├─ Venue card (icon + venueName + address/hidden)           [UNCHANGED]
├─ [NEW] Vibes & Genres section                              [+SECTION]
│    ├── If event.vibeTags.length > 0:
│    │     "Vibe" sub-label + vibe chips row (wraps)
│    └── If event.musicGenres.length > 0:
│          "Music" sub-label + music-genre chips row (wraps)
├─ "About" section header + description                      [UNCHANGED]
└─ "Tickets" section header + tickets list                   [UNCHANGED]
```

Sections render-or-skip based on data presence. Empty arrays = section hidden, no empty whitespace.

### 2.2 Brand row + Party Type chips

**Current code (lines 562–572):**

```tsx
<View style={styles.brandRow}>
  <View style={styles.brandTile}>
    <Text style={styles.brandLetter}>{brandLetter}</Text>
  </View>
  <Text style={styles.brandName}>{brand?.displayName ?? "Brand"}</Text>
</View>
```

**New code:**

```tsx
<View style={styles.brandRow}>
  <View style={styles.brandTile}>
    <Text style={styles.brandLetter}>{brandLetter}</Text>
  </View>
  <Text style={styles.brandName}>{brand?.displayName ?? "Brand"}</Text>
</View>
{event.partyTypes !== undefined && event.partyTypes.length > 0 ? (
  <View style={styles.partyTypeChipRow}>
    {event.partyTypes.map((slug) => (
      <View key={slug} style={styles.partyTypeChip}>
        <Text style={styles.partyTypeChipLabel}>
          {labelForPartyType(slug)}
        </Text>
      </View>
    ))}
  </View>
) : null}
```

Helper:
```ts
import { PARTY_TYPES } from "../../constants/eventTaxonomy";
const labelForPartyType = (slug: string): string =>
  PARTY_TYPES.find((p) => p.slug === slug)?.label ?? slug;
```

### 2.3 Vibes & Genres section

Insert AFTER the Venue card (after the conditional `event.format === "online"` branch closes), BEFORE the "About" sectionTitle.

```tsx
{((event.vibeTags !== undefined && event.vibeTags.length > 0) ||
  (event.musicGenres !== undefined && event.musicGenres.length > 0)) ? (
  <View style={styles.vibesGenresSection}>
    {event.vibeTags !== undefined && event.vibeTags.length > 0 ? (
      <View style={styles.taxonomyGroup}>
        <Text style={styles.taxonomyGroupLabel}>Vibe</Text>
        <View style={styles.vibeChipRow}>
          {event.vibeTags.map((slug) => {
            const v = lookupVibe(slug);
            return (
              <View key={slug} style={styles.vibeChip}>
                {v.emoji.length > 0 ? (
                  <Text style={styles.vibeChipEmoji}>{v.emoji}</Text>
                ) : null}
                <Text style={styles.vibeChipLabel}>{v.label}</Text>
              </View>
            );
          })}
        </View>
      </View>
    ) : null}
    {event.musicGenres !== undefined && event.musicGenres.length > 0 ? (
      <View style={styles.taxonomyGroup}>
        <Text style={styles.taxonomyGroupLabel}>Music</Text>
        <View style={styles.genreChipRow}>
          {event.musicGenres.map((slug) => (
            <View key={slug} style={styles.genreChip}>
              <Text style={styles.genreChipLabel}>
                {labelForMusicGenre(slug)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    ) : null}
  </View>
) : null}
```

Helpers:
```ts
import { VIBE_TAGS, MUSIC_GENRES } from "../../constants/eventTaxonomy";
const lookupVibe = (slug: string): { label: string; emoji: string } => {
  const hit = VIBE_TAGS.find((v) => v.slug === slug);
  return hit ?? { label: slug, emoji: "" };
};
const labelForMusicGenre = (slug: string): string =>
  MUSIC_GENRES.find((g) => g.slug === slug)?.label ?? slug;
```

### 2.4 Style additions (`StyleSheet.create` block at line 916+)

Append to the existing styles object. Tokens reused: `spacing`, `radius`, `accent`, `textTokens`, `glass`, `typography`.

```ts
// ORCH-0824-F: Party Type chip row (next to brand chip)
partyTypeChipRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xs,
  marginTop: spacing.sm,
  marginBottom: spacing.md,
},
partyTypeChip: {
  paddingHorizontal: spacing.sm,
  paddingVertical: 6,
  borderRadius: 999,
  // ORCH-0824 hotfix: orange-tinted to match consumer sheet
  backgroundColor: "rgba(235,120,37,0.18)",
  borderWidth: 1,
  borderColor: "rgba(235,120,37,0.35)",
},
partyTypeChipLabel: {
  fontSize: typography.bodySm.fontSize,
  fontWeight: "500",
  color: textTokens.primary,
},

// ORCH-0824-F: Vibes & Genres section block
vibesGenresSection: {
  marginTop: spacing.md,
  marginBottom: spacing.md,
  gap: spacing.sm,
},
taxonomyGroup: {
  gap: spacing.xs,
},
taxonomyGroupLabel: {
  fontSize: typography.caption.fontSize,
  fontWeight: "600",
  color: textTokens.secondary,
  textTransform: "uppercase",
  letterSpacing: 0.5,
},

// Vibe chip — neutral glass to match consumer sheet
vibeChipRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xs,
},
vibeChip: {
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: spacing.sm,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: "rgba(255,255,255,0.08)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.12)",
},
vibeChipEmoji: {
  fontSize: typography.bodySm.fontSize,
  marginRight: 4,
},
vibeChipLabel: {
  fontSize: typography.bodySm.fontSize,
  fontWeight: "500",
  color: textTokens.primary,
},

// Music genre chip — blue-tinted to match consumer sheet
genreChipRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xs,
},
genreChip: {
  paddingHorizontal: spacing.sm,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: "rgba(100,160,255,0.14)",
  borderWidth: 1,
  borderColor: "rgba(100,160,255,0.3)",
},
genreChipLabel: {
  fontSize: typography.bodySm.fontSize,
  fontWeight: "500",
  color: textTokens.primary,
},
```

### 2.5 Accessibility

Every chip is decorative (informational, not interactive). No accessibilityRole="button" needed. Each chip's text is accessible to screen readers via the default Text node, which is sufficient. No tap handlers.

For grouped chips (a row of party types), wrap optionally with `accessibilityLabel="Event tags: Club Night, Themed Party"` for batch announcement — but this is a nice-to-have, not required for this ORCH.

---

## 3. ExpandedBusinessEventSheet alignment

The sheet already renders chips correctly (verified in investigation §Layer B). Two changes only:

### 3.1 Add "About" heading

In `ExpandedBusinessEventSheet.tsx`, find the description render block (around line 246). Replace:

```tsx
{data.description !== null && data.description.length > 0 ? (
  <Text style={styles.description}>{data.description}</Text>
) : null}
```

With:

```tsx
{data.description !== null && data.description.length > 0 ? (
  <>
    <Text style={styles.sectionHeading}>About</Text>
    <Text style={styles.description}>{data.description}</Text>
  </>
) : null}
```

Add to the `StyleSheet.create` block:

```ts
sectionHeading: {
  fontSize: 14,
  fontWeight: "700",
  color: "rgba(255,255,255,0.85)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginTop: 20,
  marginBottom: 6,
},
```

### 3.2 Reduce top spacing of `description` style

Because the new `sectionHeading` has its own `marginTop: 20`, remove the existing `marginTop: 18` on `description`:

```ts
description: {
  fontSize: 14,
  lineHeight: 20,
  color: "rgba(255,255,255,0.78)",
  // ORCH-0824-F: removed marginTop — sectionHeading owns the spacing.
},
```

That's the entirety of the consumer-sheet change.

---

## 4. Success criteria

| # | Criterion | Surface |
|---|---|---|
| 1 | Public event page renders Party Type chips next to brand chip when `event.partyTypes.length > 0` | PublicEventPage |
| 2 | Public event page renders Vibe chips with emoji prefix when `event.vibeTags.length > 0` | PublicEventPage |
| 3 | Public event page renders Music Genre chips when `event.musicGenres.length > 0` | PublicEventPage |
| 4 | Party Type chips use orange-tinted style; Vibe chips use neutral glass; Music Genre chips use blue-tinted style — matches the consumer sheet | PublicEventPage |
| 5 | Vibes + Music Genres group sits between Venue card and "About" section | PublicEventPage |
| 6 | When all three taxonomy arrays are empty, NO new visual artifacts render (no empty whitespace gaps, no orphan section labels) | PublicEventPage |
| 7 | Address hide-until-purchase behavior is UNCHANGED — same `event.hideAddressUntilTicket` branching as today | PublicEventPage |
| 8 | Consumer sheet description block has an "About" heading above the description text | ExpandedBusinessEventSheet |
| 9 | When `data.description` is empty, neither the "About" heading nor the description renders (no orphan heading) | ExpandedBusinessEventSheet |
| 10 | No TS strict errors. No new console warnings on mount. | Both |

---

## 5. Test case matrix

| # | Scenario | Surface | Expected |
|---|---|---|---|
| T-01 | Big Party (partyTypes=['club-night'], vibeTags=[], musicGenres=[]) | Public page | Party Type chip "Club Night" renders next to brand chip; no Vibes & Genres section rendered |
| T-02 | Big Party with full taxonomy | Public page | All three groups render; chips colored per spec |
| T-03 | Legacy event (all ORCH-0824 arrays empty) | Public page | NO new chips visible; layout identical to pre-ORCH-0824-F |
| T-04 | Legacy event with hideAddressUntilTicket=true | Public page | Venue card shows "Address shared after ticket purchase" — UNCHANGED |
| T-05 | Event with description | Consumer sheet | "About" heading above description |
| T-06 | Event with no description | Consumer sheet | Neither "About" heading nor description renders |
| T-07 | Event with single Vibe tag | Public page | Single chip in Vibe row; no orphan label/spacing |
| T-08 | Event with 16 Vibe tags + 14 Music Genre tags | Public page | Chips wrap to multiple lines; no overflow |
| T-09 | Tap a chip (any) | Public page | NO action (chips are decorative, non-interactive) |
| T-10 | Public page on cancelled event (`status='cancelled'`) | Public page | CancelledVariant renders; no chips (out of scope) |

---

## 6. Invariants

### Preserved
- `hideAddressUntilTicket` toggle controls all location-related disclosure. NO new path to leak city when address is hidden.
- No fabricated data (Constitution #9): when arrays are empty, sections hide entirely. No "(no tags)" placeholder strings.
- Subtract before adding (Constitution #8): unchanged sections of `PublishedBody` are not touched.

### No new invariants
This is pure additive UI work. Existing taxonomy-canonical invariants (CHECK constraints, CI parity gate) cover the data side.

---

## 7. Implementation order

1. **`mingla-business/src/components/event/PublicEventPage.tsx`** —
   - Import `PARTY_TYPES`, `VIBE_TAGS`, `MUSIC_GENRES` from `../../constants/eventTaxonomy`.
   - Add 3 helper functions (`labelForPartyType`, `lookupVibe`, `labelForMusicGenre`) near the top of the file (after existing helpers).
   - Insert Party Type chip row inside `PublishedBody` after the brand row JSX (per §2.2).
   - Insert Vibes & Genres section JSX after the venue card branch, before "About" sectionTitle (per §2.3).
   - Add ~10 style entries to the existing `StyleSheet.create` block (per §2.4).
2. **`app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`** —
   - Add `sectionHeading` style (per §3.1).
   - Wrap the description render in fragment with the heading (per §3.1).
   - Remove `marginTop: 18` from existing `description` style (per §3.2).

Total files modified: 2. No new files. No data plumbing changes. No edge function changes.

---

## 8. Regression prevention

- **CancelledVariant / PasswordGateVariant render paths**: untouched — verified by scope of edits.
- **PublishedBody pre-existing sections** (cover, title, dates, brand, venue, About, Tickets): untouched.
- **Address-hiding logic**: explicit non-goal. Verified by spec §1.
- **Sheet pre-existing chip render**: unchanged. Only description block re-wrapped.

Adjacent features to manually verify:
- Share URL → public page renders correctly for Big Party and a legacy zero-taxonomy event.
- Tap Get Tickets on consumer sheet → public page WebView loads; same render.
- Cancelled event share URL → CancelledVariant renders, no crash.

---

## 9. Open questions

**None.** All 5 SPEC-level decisions resolved inline (per operator answers in §Operator-locked decisions).

---

NEXT HANDOFF — paste into Codex `implementor-mingla` (or Claude `mingla-implementor`):

Implement ORCH-0824-F per the SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0824-F_PUBLIC_EVENT_PAGE_AND_SHEET_PARITY.md`. Only 2 files change: `mingla-business/src/components/event/PublicEventPage.tsx` (add Party Type chip row next to brand chip; add Vibes & Genres section before About; add ~10 style entries; import taxonomy helpers from `../../constants/eventTaxonomy`) and `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (wrap description with "About" heading; add sectionHeading style; remove top margin from existing description style). Operator-locked scope: ADDITIVE ONLY — do NOT touch unchanged sections, do NOT modify address-hiding behavior (hideAddressUntilTicket toggle remains the sole gate for ALL location info), do NOT add a map preview. Hard guards: chips are decorative non-interactive Text nodes (no onPress handlers); empty arrays must render NO visual artifacts (sections hide entirely); chip colors must match the consumer sheet exactly (party=orange-tinted, vibe=neutral glass, genre=blue-tinted) so the surfaces feel like a coherent product. On completion, write the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0824-F_PUBLIC_EVENT_PAGE_AND_SHEET_PARITY.md`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Downstream after impl: Claude `mingla-forensics` (TEST mode) to verify via maestro hierarchy + sim screenshots, then CLOSE.
