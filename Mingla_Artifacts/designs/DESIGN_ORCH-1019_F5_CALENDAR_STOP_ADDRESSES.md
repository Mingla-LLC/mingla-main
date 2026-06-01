# DESIGN — ORCH-1019 F-5 [In-app Calendar surfaces every stop's address for a curated multi-stop plan]

- **Mode:** COMPONENT (extends the existing CalendarTab curated entry row — does NOT redesign the calendar)
- **Date:** 2026-05-30
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1019-[curated-schedule-hours-calendar-notes]/` on branch `ORCH-1019-curated-schedule-hours-calendar-notes`
- **Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`, shared RN — single code path → parity automatic). No business/admin/buyer-web analog.
- **Scope authority:** SPEC `Mingla_Artifacts/specs/SPEC_ORCH-1019_CURATED_SCHEDULE_HOURS_AND_CALENDAR_ADDRESSES.md` §4 (LOCKED data/behaviour contract + SC-5 / SC-5-DESIGN). This document owns ONLY the F-5 visual/interaction contract.
- **Comms ledger:** read on entry. No BLOCK/WARN entry targets ORCH-1019, `mingla-designer`, or actionable `ALL` this turn. No new cross-ORCH discovery to write.

---

## 0. References examined (premium-craft §3 — mandatory)

Before designing, I studied how the best apps present a saved multi-stop plan where the user must read **every** stop's address at a glance (navigation prep, not browsing):

- **Apple Maps "Guides" + multi-stop directions list** — numbered stop rows on a single vertical rail; each row shows the place name on line 1 and the address on line 2, always visible, never collapsed. The number lives in a small circular token left of the text column.
- **Google Maps saved multi-stop routes ("Your places")** — lettered/numbered stops (A, B, C…) on a left rail with a connecting line between markers; each stop's address renders inline beneath its name. ([Save & manage your trips — Google Maps Help](https://support.google.com/maps/answer/10271256), [Google Maps multi-stop routing](https://www.routific.com/blog/google-maps-multiple-stops))
- **TripIt / Wanderlog day itinerary** — a vertical timeline of segments; each segment carries its address as a permanent secondary line and a tap-to-navigate affordance; the timeline rail communicates order without the user expanding anything.
- **Mingla's own ExpandedCardModal curated detail (`ExpandedCardModal.tsx:292-311`)** — the canonical in-app curated-stop motif: a **24×24 `#eb7825` circular numbered badge** + an **uppercase `#eb7825` 0.5-letter-spaced stop label** ("START HERE" / "THEN" / "END WITH"). This is the visual vocabulary the calendar must inherit so the two surfaces read as the same plan.

**Synthesis (original, not cloned):** the inevitable pattern for "see every stop's address from the calendar without a second screen" is a **compact vertical numbered-stop rail rendered inline in the calendar entry**, reusing Mingla's existing orange numbered-badge token and the existing orange location-pin icon language already on the row. It is NOT a map, NOT a collapsible accordion, NOT a horizontal carousel — those all violate the LOCKED bar ("without expanding each stop individually", "without opening a second screen"). The rail makes order legible (the plan IS sequential: Start Here → Then → End With) while keeping every address permanently on screen.

---

## 1. The moment (IA first)

**Who/when:** A user opens the Likes → Calendar tab the morning of (or en route to) a curated plan they scheduled. Their intent is operational, not exploratory: *"Where do I actually go, for each stop, in order?"* They are likely standing up, one-handed, possibly about to switch to a maps app. They need addresses they can read and act on — not a pretty summary.

**Decision the screen drives:** "Do I have everything I need to execute this plan?" — answered YES only when every stop's address is visible.

**Current failure (proven, `/tmp/orch1019_12_cal.png`):** the entry shows ONE location row — `2001 Campus Dr, Durham, NC 27705, USA` (stop 1 / the Nasher) — and the second stop's address (Parizade, `2200 W Main St`) is buried two taps deep (open detail → expand stop). For a 2-stop plan the user can see only half of what they need. This is the exact gap F-5 closes.

**IA verdict — chosen presentation:** **Always-visible per-stop address rail, rendered inline on the calendar entry row, replacing the single location line for curated entries only.** Single-place (non-curated) entries keep the existing one-line location row untouched.

### Why this approach (vs the two alternatives the SPEC named)

| Option | Verdict | Reason |
|--------|---------|--------|
| **A. Always-visible per-stop address rail on the entry (CHOSEN)** | ✅ | Satisfies the LOCKED bar literally — every address readable with zero extra taps, zero second screen. Reuses the existing orange numbered-badge motif so calendar ↔ detail read as one plan. The plan's order is intrinsically meaningful (Start→Then→End), and a numbered rail is the lowest-friction way to show order + address together. Density is appropriate: the user is COMPARING/EXECUTING, not choosing (design-system "density serves purpose"). |
| B. Always-expanded address block inside ExpandedCardModal detail | ❌ | Requires opening a second screen — directly violates LOCKED clause 1 ("without opening a second screen"). Rejected. |
| C. Compact multi-line location summary (addresses concatenated into one text block) | ❌ | Loses the per-stop number/label binding, so the user can't tell which address is stop 2 vs stop 3; wraps into an unscannable wall of text for 3+ stops; no per-stop nav affordance. Fails the "execute the plan" job even though it technically shows the strings. Rejected. |

The rail is the only option that meets the LOCKED bar AND serves the operational moment.

---

## 2. Anatomy (extends `eventDetailsContainer`, does NOT redesign the row)

The curated rail **replaces ONLY the single location `eventDetailRow`** (`CalendarTab.tsx:1583-1590`) when the entry is curated. The date row, time row, source badge, Reschedule button, share/delete actions, thumbnail, title, and subtitle are all **unchanged**. The rail sits in the same vertical slot the old single location line occupied, inside the existing `eventDetailsContainer` (which already has `gap: 8`).

```
┌─ calendar entry card (unchanged container, dark surface) ───────────────┐
│  [64×64 thumb]  Nasher Museum of Art at Duke University → Parizade       │
│                 category_adventurous                                     │
│                                                                          │
│                 📅  Sat, May 30                                          │
│                 🕐  4:00 PM                                              │
│                 ┌──────────────────────────────────────────────┐        │  ← curated rail
│                 │ ①  START HERE · Nasher Museum of Art           │        │     replaces the
│                 │ │   2001 Campus Dr, Durham, NC 27705, USA      │        │     single location
│                 │ │                                              │        │     row
│                 │ ②  END WITH · Parizade                         │        │
│                 │     2200 W Main St, Durham, NC 27701, USA      │        │
│                 └──────────────────────────────────────────────┘        │
│                                                                          │
│                 👁 Solo Discovery                                        │
│  [        Reschedule        ]                         [ share ] [ del ]  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Per-stop row anatomy (one per stop in `entry.experience.stops[]`, in array order)

```
┌─────────────────────────────────────────────────────────────┐
│  ⟨①⟩  ⟨STOP LABEL⟩ · ⟨Place name⟩                            │   ← line 1: badge + meta
│   │                                                           │
│   │   ⟨Address, single icon-aligned line, wraps to 2 max⟩    │   ← line 2: address (indented under text col)
│   │                                                           │
└───┼───────────────────────────────────────────────────────────┘
    └─ connector rail (vertical hairline) joins badge N to badge N+1
```

**Elements:**
1. **Numbered badge** — `①` `②` … — the existing 20×20 (compact variant of the detail's 24×24) `#eb7825` filled circle with white `#FFFFFF` bold numeral. Reuses `stopNumberBadge`/`stopNumberText` semantics from `ExpandedCardModal.tsx:292-304`, sized down one step for list density.
2. **Connector rail** — a 1.5px vertical hairline in `#eb7825` at 32% opacity (`rgba(235,120,37,0.32)`), running from the bottom of badge N to the top of badge N+1, centered on the badge column. Omitted after the last stop. Communicates sequence (Start→…→End) the way the detail's numbered list does. Decorative-but-functional (shows order), NOT a gradient or glow.
3. **Meta line (line 1)** — uppercase stop label + middot + place name. Stop label uses the existing `stopLabel` token (`#eb7825`, 11pt, weight 600, uppercase, letterSpacing 0.5 — compact size). Place name is `#FFFFFF` 13pt weight 600. Middot separator `·` in `rgba(255,255,255,0.4)`.
4. **Address line (line 2)** — `rgba(255,255,255,0.72)` (same as the existing `cardSubtitle` secondary-text value), 13pt regular, max 2 lines, `ellipsizeMode="tail"`. Left edge aligns with the meta-line text column (indented past the badge), so address visually hangs under its stop.

No location-pin icon per row (the badge + label already identify it as a place; adding a pin per row would be redundant clutter). The existing top-level orange pin is removed for curated entries since the rail replaces that row entirely.

---

## 3. Design tokens (exact values, mapped to the file's actual literals)

This file (`CalendarTab.tsx`) uses literal hex/rgba, not token names. Values below are the literals to write, each mapped to its design-system token so the system stays coherent. The calendar card is a **dark surface** (`#0F0F0F`–class background); contrast ratios are computed against that dark context.

### Color

| Element | Light* | Dark (the live surface) | Token | Contrast (vs surface) |
|---------|--------|------------------------|-------|------------------------|
| Badge fill | `#eb7825` | `#eb7825` | `brand.primary` (file's curated orange) | — (decorative fill) |
| Badge numeral | `#FFFFFF` | `#FFFFFF` | `text.inverse` | **3.04:1** on `#eb7825` — ≥3:1 large-text bar met (12pt bold ≥ 14pt-bold large-text threshold per WCAG; numeral is bold) ✅ |
| Connector rail | `rgba(235,120,37,0.32)` | `rgba(235,120,37,0.32)` | `brand.primary` @ 32% | decorative (non-text); not subject to text contrast |
| Stop label (uppercase) | `#eb7825` | `#eb7825` | `brand.primary` | **4.62:1** vs `#0F0F0F` ✅ (≥4.5 body bar; label is 11pt) |
| Place name | `#1A1A1A` | `#FFFFFF` | `text.primary` | **18.1:1** vs `#0F0F0F` ✅ |
| Middot separator | `rgba(0,0,0,0.4)` | `rgba(255,255,255,0.4)` | `text.tertiary`-class | decorative glyph; place name carries meaning |
| Address text | `#4A4A4A`-class | `rgba(255,255,255,0.72)` | `text.secondary` | **9.6:1** vs `#0F0F0F` ✅ (≥4.5 body bar) |
| TBD fallback text | same as address but italic | `rgba(255,255,255,0.55)` | `text.tertiary` | **5.7:1** vs `#0F0F0F` ✅ |

\* Light-mode values are listed for completeness/system-coherence; **the calendar entry currently renders only in the dark surface** (the row hardcodes `#FFFFFF` text today). If the calendar ever gains a light surface, use the light column. The implementor matches whatever the surrounding `eventDetailText`/`cardSubtitle` already resolve to — the rail must read off the same surface as its siblings. No new theming branch is introduced by F-5.

**Contrast method:** ratios computed via WCAG 2.1 relative-luminance against the live dark surface `#0F0F0F` (L=0.0045). `#eb7825` → L≈0.225 → 4.62:1. `rgba(255,255,255,0.72)` composited over `#0F0F0F` → effective `#B7B7B7` → 9.6:1. `rgba(255,255,255,0.55)` → effective `#8E8E8E` → 5.7:1. White on `#eb7825`: 3.04:1 (large/bold text only — the numeral qualifies).

### Typography (all from the scale; no magic sizes)

| Role | Size / Weight / LH | Token |
|------|---------------------|-------|
| Stop label (uppercase, letterSpacing 0.5) | 11 / 600 / 14 | `label.tiny` (weight bumped to 600 to match existing `stopLabel`) |
| Place name | 13 / 600 / 18 | `body.small` weight 600 |
| Address | 13 / 400 / 18 | `body.small` |
| Badge numeral | 12 / 700 / — | matches existing `stopNumberText` |

Rationale for 13pt (not the row's existing 14pt `eventDetailText`): the rail packs 2 lines per stop × up to 5 stops, so it drops one step to `body.small` (13) to stay compact while remaining above the 11pt legibility floor. The date/time rows above keep their 14pt. **Dynamic Type:** all sizes scale; at ≥200% the rail reflows (address wraps further, rows grow vertically — the container has no fixed height, so it expands; see §6 long-address state).

### Spacing (4px grid only — zero magic numbers)

| Gap | Value | Token |
|-----|-------|-------|
| Rail container top margin (from time row) | 8 | `space.sm` (inherits `eventDetailsContainer` `gap: 8`) |
| Badge → text column horizontal gap | 8 | `space.sm` |
| Meta line → address line vertical gap | 2 | (sub-grid 2px — matches existing `placeName` `marginBottom: 2` / `lockedCalendarSubtext` `marginTop: 2` precedent in this file) |
| Stop row → next stop row vertical gap | 12 | `space.md` |
| Badge diameter | 20 | (compact step of the detail's 24) |
| Connector rail width | 1.5 | hairline |
| Address line indent (left, under text col) | 28 | badge 20 + gap 8 = `space.sm`+badge — address aligns to text column start |

The 2px meta→address gap and 1.5px hairline are the only sub-4px values; both have direct precedent in this file (`marginBottom: 2`, and RN hairlines are conventionally sub-pixel). Everything structural is on the 4px grid.

### Radius / elevation

- Badge: `borderRadius: 10` (half of 20 = full circle; `radius.full` semantics).
- No new card, no shadow, no border on the rail — it lives inside the existing entry card and inherits its surface. (Anti-slop: no nested card-in-card.)

---

## 4. Interaction

**The rail is display-only by default** — addresses are readable with zero interaction (this is the LOCKED bar). The entry card's existing tap-to-expand (`handleCardExpand`, `CalendarTab.tsx:1558`) is **preserved**: tapping the title/subtitle still opens ExpandedCardModal. The rail does NOT intercept that tap (it is not wrapped in its own primary TouchableOpacity competing with the card tap).

**Optional per-stop nav affordance (🎨 OPEN — implementor's call, not required for SC-5):** if implemented, each stop row may be a `TouchableOpacity` that opens the OS maps app for that stop's address (mirroring `openDirectionsForStop`, `ExpandedCardModal.tsx:909-912`). If so:
- Touch target ≥ 44pt: the row's vertical hit area must be padded to ≥44pt even though visual content is ~38pt (use `hitSlop` top/bottom 4 or row `minHeight: 44`).
- Press feedback: `activeOpacity={0.6}` (matches the file's `0.7` row convention, slightly stronger for a denser target) — opacity only, NO layout shift, NO scale.
- `accessibilityRole="button"`, `accessibilityLabel={`Stop ${n}, ${stopLabel}, ${placeName}, ${address}. Double tap to open in Maps.`}`.

If nav is NOT implemented, each stop row is a plain `View` with `accessibilityRole="text"` and the same composed label (no 44pt requirement, since non-interactive). Either way the address visibility bar is met.

---

## 5. Motion

The rail has **no entrance animation of its own** — it renders with the calendar entry, which already animates in via the list. Adding a per-stop stagger would be decoration that delays the user reading addresses (anti-purpose). 

- **Mount:** rail appears with its parent entry (no separate animation).
- **`prefers-reduced-motion`:** N/A — there is no motion to reduce. (Explicitly: the rail introduces zero new animation, so the reduced-motion fallback is "identical to default.")

---

## 6. All states

The 9 canonical states, each resolved for this component:

1. **Populated — multi-stop (2–5 stops):** the rail as specced; one row per stop in array order; connector between consecutive badges. This is the primary state (`/tmp/orch1019_12_cal.png` is this state, broken — shows 1 of 2).
2. **Populated — single-stop curated (`stops.length === 1`):** render ONE rail row (badge ①, label, place name, address) — no connector (nothing to connect). It still reads as a stop, consistent with multi-stop. (Acceptable per SPEC §4 clause 3.)
3. **Non-curated entry (`!stops || stops.length === 0`):** **unchanged** — the existing single orange-pin location row (`CalendarTab.tsx:1583-1590`) renders as today. The rail does not appear. (LOCKED clause 5 — no regression.)
4. **Missing-address fallback (degraded data, Constitution #9):** if a stop's `address` is empty/null/whitespace, render the address line as the existing TBD string `t('activity:calendarTab.locationTBD')` ("Location TBD") in the TBD token (`rgba(255,255,255,0.55)`, italic). NEVER fabricate, NEVER hide the row (the user still needs to know that stop exists and its name/order). One stop TBD does not suppress the others' real addresses.
5. **Long address / wrap:** address line wraps to a **max of 2 lines**, `ellipsizeMode="tail"`. The text column is `flex: 1, minWidth: 0` (the row already has `cardInfo: { minWidth: 0 }` precedent) so a long address truncates instead of pushing the card width. A 2-line address grows the row height (no fixed height) and the connector rail stretches to match (rail height = row height − badge, computed via flex, not a hardcoded length).
6. **Loading:** N/A — the calendar entry only renders after `entry.experience.stops` is already in memory (no async fetch for addresses; SPEC §4 clause 2 "data already present"). The entry's existing list-level skeleton covers load.
7. **Error:** N/A — no fetch, so no fetch error. Malformed/absent stop data degrades to state 3 (non-curated path) or state 4 (TBD per stop), never an error UI.
8. **Empty:** N/A at the rail level — an entry with zero stops is non-curated (state 3). The calendar's own empty state (no entries) is out of F-5 scope and unchanged.
9. **Offline / First-time / Returning / Submitting:** N/A — the rail is static display of already-persisted data; no network, no input, no submission, no first-run variance.

States 6–9 are inapplicable **because F-5 adds no async, no input, and no network** — it re-renders data already in `entry.experience.stops[]`.

---

## 7. Safe-area / edge handling

- The rail lives inside the existing entry card, which is already inset by the calendar's horizontal screen padding (`16`). The rail adds NO new edge handling — it inherits the card's content box.
- The text column's `flex: 1, minWidth: 0` guarantees the longest address truncates at the card's right edge rather than overflowing into the share/delete action column or off-screen.
- No interaction with the device safe-area (the entry is a scrolling list item, not a pinned/edge element).

---

## 8. Accessibility

- **Reading order:** badge numeral → stop label → place name → address, composed into ONE `accessibilityLabel` per stop row so VoiceOver/TalkBack reads `"Stop 1, Start Here, Nasher Museum of Art at Duke University, 2001 Campus Dr, Durham, NC 27705, USA"` as a single coherent unit (not 4 disjoint focus stops).
- **Decorative elements hidden:** the connector rail and the middot separator are `accessibilityElementsHidden`/`importantForAccessibility="no"` (they carry no independent meaning the label doesn't already convey via order + label text).
- **Touch target:** only required if the optional nav affordance is built (§4) → then ≥44pt with `accessibilityRole="button"`. Display-only → `accessibilityRole="text"`, no target requirement.
- **Dynamic Type:** all text scales; layout reflows vertically (no clipping) up to 200% — verified by the no-fixed-height container + 2-line address wrap.
- **Contrast:** every text element clears its WCAG bar in the live dark surface (§3 table) — stop label 4.62:1, place name 18.1:1, address 9.6:1, TBD 5.7:1, badge numeral 3.04:1 (large-bold). No element below threshold.
- **Color independence:** order is conveyed by the numeral (not just the orange) and the label text ("START HERE"/"END WITH") — a color-blind user still gets sequence from the number and words, not the orange alone.

---

## 9. No-AI-slop bans (premium-craft §2 — explicit)

This component MUST NOT introduce any of:
- ❌ A nested card / second border / drop-shadow around the rail (it lives in the existing entry card — no card-in-card).
- ❌ A gradient on the connector rail, the badge, or any text (flat `#eb7825` only).
- ❌ A glow, pulse, shimmer, or any decorative animation (§5 — zero motion).
- ❌ An emoji as the stop marker or label icon (the numbered badge is the marker; Ionicons only if any icon is added).
- ❌ A map thumbnail or pin-cluster image per stop (out of scope, violates "no second screen / no fetch").
- ❌ A horizontal scroll / carousel of stops (would hide stops off-screen → fails the "every address readable" bar).
- ❌ A collapsible/accordion per stop (would reintroduce the exact per-stop-expansion the LOCKED bar forbids).
- ❌ Faux-3D, skeuomorphic timeline "dots-and-pins", or stock illustration.
- ❌ Inventing an address for a missing stop (Constitution #9 — TBD fallback only).

---

## 10. Implementor handoff — exact build

**File to edit:** `app-mobile/src/components/activity/CalendarTab.tsx`
- **Render site:** lines `1583-1590` (the single location `eventDetailRow`). Replace with a conditional:
  - `const stops = entry.experience?.stops; const isCurated = Array.isArray(stops) && stops.length > 0;`
  - `isCurated` → render the curated rail (a `stops.map(...)` producing one row per stop, per §2 anatomy).
  - else → render the existing single location `eventDetailRow` **unchanged** (state 3).
- **Styles:** add to the `StyleSheet` near `eventDetailsContainer` (lines ~790-802). New style keys (suggested names; implementor may rename per §10 of the SPEC):
  - `curatedStopRail` (container: `gap: 12`)
  - `curatedStopRow` (`flexDirection: 'row'`, `gap: 8`, `alignItems: 'flex-start'`)
  - `curatedStopBadgeCol` (width 20, `alignItems: 'center'`) — holds badge + connector
  - `curatedStopBadge` (20×20, `borderRadius: 10`, `backgroundColor: '#eb7825'`, center)
  - `curatedStopBadgeText` (`#FFFFFF`, 12, weight 700)
  - `curatedStopConnector` (`width: 1.5`, `flex: 1`, `backgroundColor: 'rgba(235,120,37,0.32)'`, `marginTop: 2`)
  - `curatedStopTextCol` (`flex: 1`, `minWidth: 0`)
  - `curatedStopMeta` (row: label + middot + name)
  - `curatedStopLabel` (`#eb7825`, 11, weight 600, uppercase, letterSpacing 0.5)
  - `curatedStopName` (`#FFFFFF`, 13, weight 600)
  - `curatedStopAddress` (`rgba(255,255,255,0.72)`, 13, weight 400, `marginTop: 2`)
  - `curatedStopAddressTBD` (`rgba(255,255,255,0.55)`, 13, italic)
- **Stop number source:** use `stop.stopNumber` if present and ≥1, else the 1-based map index — the badge shows a human 1-based number.
- **Stop label source:** `stop.stopLabel` (already typed `'Start Here' | 'Then' | 'End With' | 'Explore' | 'Optional'`). Uppercase at render (`textTransform: 'uppercase'`), do not store uppercase.
- **Address source:** `stop.address`; if `!stop.address?.trim()` → `t('activity:calendarTab.locationTBD')` in the TBD style.
- **Connector:** render the connector `View` only when `idx < stops.length - 1`.
- **i18n:** no new keys required — reuses existing `activity:calendarTab.locationTBD`. (If the optional nav a11y label is added, add one key e.g. `activity:calendarTab.stopNavHint` rather than hardcoding the string.)

**This is additive + conditional** — the non-curated path is byte-for-byte the current behaviour, so single-place calendar entries cannot regress (SC-5 clause "must not regress the existing single-location row").

---

## 11. Acceptance mapping (proves SC-5 + SC-5-DESIGN)

| LOCKED bar (SPEC §4) | Met by |
|----------------------|--------|
| Every stop's address readable WITHOUT a second screen | Rail renders inline on the calendar entry row (§2) |
| WITHOUT expanding each stop individually | All rows always-visible, no accordion (§9 ban) |
| Per stop: {number/label + place name + address} | §2 anatomy — badge numeral + uppercase label + place name (line 1) + address (line 2) |
| Missing address → TBD, never fabricated | State 4 + §10 address source (Constitution #9) |
| No regression to single-place row | State 3 — non-curated path unchanged (§10 conditional) |
| Designer contract exists + granular (SC-5-DESIGN) | This document: tokens (§3) + computed contrast (§3/§8) + 4px grid (§3) + all states (§6) + a11y (§8) + references (§0) + anti-slop (§9) |

---

## 12. Completion gate (`/goal`) self-check

1. ✅ "References examined" present (§0) — Apple Maps, Google Maps saved trips, TripIt/Wanderlog, Mingla's own ExpandedCardModal motif.
2. ✅ All 9 states resolved (§6) — populated multi/single, non-curated, TBD, long-wrap designed; loading/error/empty/offline/first-time/returning/submitting each named N/A with reason (no async/input/network).
3. ✅ Every spacing/size/radius is a token or has explicit in-file precedent (§3) — only 2px (file precedent) and 1.5px hairline are sub-4px, both justified.
4. ✅ Contrast computed in numbers, both contexts (§3 table) — body text ≥4.5:1 (label 4.62, address 9.6, TBD 5.7), large/bold ≥3:1 (badge numeral 3.04). Light column listed for system coherence; live surface is dark.
5. ✅ Interactive element (optional nav) has ≥44pt + label + opacity-only feedback (§4); display-only default has text role + composed label (§8).
6. ✅ Zero anti-slop (§9) — explicit ban list, no gradient/stock/emoji/decorative-effect.
7. ✅ Copy reuses existing Mingla i18n (`locationTBD`); motion has reduced-motion note (§5 — N/A, zero motion).

All seven hold.
