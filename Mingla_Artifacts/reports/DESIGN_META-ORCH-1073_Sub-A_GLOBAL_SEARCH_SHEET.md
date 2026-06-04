# DESIGN — META-ORCH-1073 Sub-A — Global Search Sheet (Phase 1)

**ORCH:** META-ORCH-1073 Sub-A — "Global search sheet (Phase 1)" — Mingla Business app (`mingla-business/`).
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1073-Sub-A-[global-search-sheet]/` on branch `META-ORCH-1073-Sub-A-global-search-sheet`.
**Mode:** SCREEN (greenfield UI surface — full visual + interaction contract; no product code).
**Author:** mingla-designer (Claude), 2026-06-04.
**Binding inputs read:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1073_Sub-A_GLOBAL_SEARCH_SHEET.md` (§12.1 rulings are binding and supersede §6/§3.7 convergence text); `Mingla_Artifacts/META-ORCH-1073_BUSINESS_SEARCH_SYSTEM_SHARED_UNDERSTANDING.md`; `TopBar.tsx`; `Sheet.tsx` / `Sheet.web.tsx` / `SheetMobile.tsx`; `Input.tsx` + `Input.variants.ts`; `Icon.tsx` (69-glyph `IconName` set); `IconChrome.tsx`; `CommandPalette.web.tsx`; `designSystem.ts`; `useResponsiveLayout.ts` (`WIDE_DESKTOP_MIN_WIDTH = 1024`, inclusive, native always false).

> **Status vs SPEC:** This DESIGN consumes the LOCKED functional contract verbatim and fills only the §13 🎨 OPEN surface: pixel tokens, spacing, typography, motion bands, haptics, the per-state copy, the per-type icon mapping, and the row/sheet anatomy. **No LOCKED-floor conflict was found.** One under-specified item (the `degraded`/no-brand visual treatment) and one icon-set gap (no dedicated "trip" glyph) are resolved within the existing tokens/IconName set and flagged in §11.

**References examined (premium-craft §3, web access available 2026-06-04):**
- **Raycast root search** — single entry point to "everything you can do"; results live directly under the search bar; grouped by source; keyboard-first; instant filter, no submit step. Mingla mirror: one sheet = the root search for the whole business app; group order is fixed; results render under the input with zero submit step.
- **Notion quick-find / command palette** — category-grouped results (databases, blocks, inline…), uppercase section headings, AI palette as a second grouped list. Mingla mirror: 3 fixed group headings (Offerings / Go to / Settings & actions), `labelCap` uppercase headings already used by `CommandPalette.web.tsx`.
- **Linear command menu** — tight 44pt rows, leading glyph + label + trailing context, highlighted-row tint, Esc pill, no decoration. Mingla mirror: 56pt offering rows / 48pt registry rows, leading type icon, title + subtitle, trailing chevron, accent-tint active state.
- **Stripe Dashboard search / Things 3 quick-find** — grouped, instant, "no dead end" zero-state with nearest suggestions. Mingla mirror: zero-result state offers up to 3 nearest registry suggestions via the fuzzy tier.
- **In-repo precedent (highest authority for fidelity):** `CommandPalette.web.tsx` visual contract (group heading = `labelCap`/`text.tertiary`; 44pt rows; highlighted row = `accent.tint` bg + `accent.warm` text; 640px max dialog; opaque `canvas.discover` surface) — the new sheet reuses this exact language so the two web surfaces (which COEXIST per R-5) feel like siblings, not strangers.

Sources: [Command Palette UX Patterns — Alicja Suska / Bootcamp](https://medium.com/design-bootcamp/command-palette-ux-patterns-1-d6b6e68f30c1), [Command Palette Interfaces — Philip Davis](https://philipcdavis.com/writing/command-palette-interfaces), [Raycast Search Bar Manual](https://manual.raycast.com/search-bar).

---

## 0. COMMS-Ledger acknowledgements

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK`+`OPEN` row targets `mingla-designer`, META-ORCH-1073, or `ALL`. Two `WARN`+`ALL` rows are **N/A for this DESIGN pass** (no code, no backend, no external API), recorded so the implementor/tester inherit the reasoning:
- **COMMS-0002** (strict-grep backend gate): N/A — DESIGN only; no `supabase/functions/**` or migration.
- **COMMS-0003** (external-API docs inline): N/A — no external API/SDK introduced. `cmdk` is NOT touched (R-5 COEXIST).

---

## 1. Cross-Surface Impact Declaration (MANDATORY pre-section)

Every design decision below is tied to a real token or primitive with file evidence. This sheet ships to **3 surfaces** (per SPEC §2): business-iOS, business-Android, business-web preview. The **search service / index / registry / ranking / role-gating / result model are 100% shared platform-agnostic TS** (SPEC §2 + §3.3); **only the presentation shell diverges**. This DESIGN therefore specifies ONE result-row + group-header + state system that renders identically across all three, plus the per-surface *shell* (mobile bottom sheet vs. web wide-desktop centred card).

| # | Surface | In scope | Presentation shell (primitive) | This DESIGN specifies |
|---|---------|----------|--------------------------------|------------------------|
| 1 | Consumer iOS/Android (`app-mobile/`) | NO | — | — (different app; SPEC §2) |
| 2 | Buyer/anon web (`/b`,`/e`,`/checkout`) | NO | — | — (SPEC §2) |
| 3 | Admin web (`mingla-admin/`) | NO | — | — (SPEC §2) |
| 4 | **Business iOS** | **YES** | `Sheet` → `SheetMobile.tsx` bottom sheet, `snapPoint="full"` (0.9 screen) | shell dims, input, all states, motion, haptics, a11y |
| 5 | **Business Android** | **YES** | identical RN path to iOS (`Sheet`→`SheetMobile`), Android opaque-glass fallback already baked into the primitive | per-platform divergence call-out (opaque fallback, hardware back) |
| 6 | **Business web — narrow (< 1024px)** | **YES (adjacent)** | `Sheet.web.tsx` → `MobileSheet` (same bottom sheet as native) | same as #4, plus web-blur fallback note |
| 7 | **Business web — wide-desktop (≥ 1024px)** | **YES (adjacent)** | `Sheet.web.tsx` → `DesktopCenteredCard` (centred floating card, 640px cap) | centred-card dims, top-anchored offset, Esc affordance, focus trap |

**Per-surface divergences explicitly called out** (detail in §6–§9):
- **D-1 Shell geometry.** Native/narrow-web = bottom sheet anchored to viewport bottom, full snap (0.9×H). Wide-desktop = centred card (the `DesktopCenteredCard` in `Sheet.web.tsx` centres vertically; this DESIGN overrides the vertical anchor to **top-offset 12vh** to match a search-palette mental model — see §6.3 + §11 note N-3).
- **D-2 Glass fill.** iOS = real `BlurView` (`Sheet.tsx` L320). Android + mobile-web < 768px = opaque `FALLBACK_BACKGROUND rgba(20,22,26,0.92)` (`Sheet.tsx` L77/L280, honoring `ANDROID_GLASS_USES_OPAQUE_FALLBACK`). Wide-desktop card = opaque `CARD_BACKGROUND rgba(20,22,26,0.92)` (`Sheet.web.tsx` L92). All three exceed the contrast floor (§10).
- **D-3 Dismiss.** Native = drag-down handle / scrim tap / Android hardware back. Web narrow = scrim tap / Esc. Wide-desktop = scrim tap / Esc. All call `close()` (SPEC §3.7).
- **D-4 Autofocus timing.** Native = focus input AFTER the open spring settles (~`UNMOUNT_DELAY`-class delay, see §7.2) so the keyboard doesn't fight the spring. Web = focus immediately on mount.
- **D-5 Haptics.** Native only — `HapticFeedback.buttonPress()` (already imported by `IconChrome.tsx` L38) on row press-in. Web = no haptic (no-op).

---

## 2. The moment & information architecture

### 2.1 The moment
The operator is mid-task on any default-cluster screen (Home, Hub, Marketing, Account, the creator wizards) and needs to **get somewhere fast** — to a specific event/trip/experience they own, or to a feature/setting they half-remember ("where's the refund thing? the tax setting? invite a scanner?"). They are impatient and goal-directed. The sheet must feel like an *accelerator*, not a destination: open instantly, results the moment they type, one tap to teleport. Anything that adds a step (a submit button, a loading spinner on every keystroke, a two-screen drill-down) breaks the moment.

### 2.2 IA — what's on screen, in priority order
1. **The query field** — always the top, always focused, the only thing the user touches first.
2. **Results, grouped, fixed order** (SPEC §3.1.3): `Offerings` → `Go to` → `Settings & actions`. Group order never changes; only presence changes (a group with 0 results renders no heading).
3. **Empty-state scaffolding** (no query): `Recent` (if any) then `Jump to` (top registry screens) — the "you can do anything from here" promise, Raycast-style.
4. **Zero-result rescue** (≥2 chars, no match): a plain-spoken "no matches" line + up to 3 nearest registry suggestions so it's never a dead end.

The decision the user makes is always the same: **pick one row → teleport**. Density therefore serves *scanning* (compact, comparable rows), not *choosing* (no big cards). This is the opposite of the consumer deck — and correctly so.

### 2.3 Row hierarchy (one-glance test)
Within a row the eye lands: **leading type-icon (what kind of thing)** → **title (which one)** → subtitle (disambiguator) → trailing chevron (it's tappable/navigational). Title is the loudest; everything else recedes. Match highlight (the substring that matched) is NOT visually bolded in Phase 1 — keeps the row calm and avoids per-keystroke text-measure churn; the group + icon already tell the user why a row is here.

---

## 3. Token foundation (every value is a token — zero magic numbers)

All values resolve to `mingla-business/src/constants/designSystem.ts`. The 4px grid is `spacing` (xxs 2 / xs 4 / sm 8 / md 16 / lg 24 / xl 32 / xxl 48). No raw pixel literal appears in this spec except (a) the two primitive-owned constants this design does not change (`TOPBAR_HEIGHT 56`, sheet handle 36×4), and (b) component constants already shipped in the primitives this design reuses (`Input` HEIGHT 48, `IconChrome` 36→44 hit target). Those are existing tokens-by-precedent, not new magic numbers.

| Role | Token | Value |
|------|-------|-------|
| Sheet surface (iOS) | `BlurView` `cardElevated` + `glass.tint.profileElevated` over `glass.border.profileElevated` | blur 34, tint `rgba(255,255,255,0.06)`, border `rgba(255,255,255,0.12)` (primitive-owned, `Sheet.tsx`) |
| Sheet surface (Android / mobile-web<768 / wide card) | opaque fallback | `rgba(20,22,26,0.92)` (`Sheet.tsx` L77 / `Sheet.web.tsx` L92) |
| Canvas reference (contrast base) | `canvas.discover` | `#0c0e12` |
| Scrim (mobile) | primitive `SCRIM_COLOR` | `rgba(0,0,0,0.5)` (`Sheet.tsx` L140) |
| Scrim (wide-desktop) | primitive `SCRIM_COLOR` | `rgba(0,0,0,0.55)` (`Sheet.web.tsx` L88) |
| Search field | `Input variant="search"` | container H 48, radius `sm` (8), bg `rgba(255,255,255,0.04)`, idle border `rgba(255,255,255,0.12)`, focus border `accent.warm` 1.5px |
| Group heading | `typography.labelCap` + `text.tertiary` | 12/16, weight 600, letter-spacing 1.4, uppercase, color `rgba(255,255,255,0.52)` |
| Row title | `typography.body` + `text.primary` | 16/24, weight 400, `rgba(255,255,255,0.96)` |
| Row subtitle | `typography.bodySm` + `text.tertiary` | 14/20, weight 400, `rgba(255,255,255,0.52)` |
| Row leading icon | `Icon` size 20, `text.secondary` idle | `rgba(255,255,255,0.72)` |
| Row trailing chevron | `Icon name="chevR"` size 18, `text.quaternary` | `rgba(255,255,255,0.32)` |
| Row active/press fill | `glass.tint.profileBase` (mobile) / `accent.tint` (highlighted, web kbd-nav) | `rgba(255,255,255,0.04)` / `rgba(235,120,37,0.28)` |
| Row active title (web highlighted) | `accent.warm` | `#eb7825` |
| Empty/zero copy | `typography.bodySm` + `text.secondary` | 14/20, `rgba(255,255,255,0.72)` |
| Error row icon | `Icon name="flag"` + `semantic.error` | `#ef4444` |
| Clear button | `Input` built-in clear (`close` glyph, `text.tertiary`) | `rgba(255,255,255,0.52)` |
| Motion — open spring | primitive `SPRING_CONFIG` | damping 22, stiffness 200, mass 1 (`Sheet.tsx` L143) |
| Motion — close | primitive `TIMING_CLOSE` | 240ms `Easing.in(cubic)` |
| Motion — reduced | primitive `REDUCE_MOTION_OPEN` | 200ms fade |
| Motion — row press | `durations.fast` + `easings.press` | 120ms, `cubic-bezier(0.25,0.46,0.45,0.94)` |
| Debounce feel | SPEC §3.2 | 120ms filter debounce (input echoes immediately) |

---

## 4. Search field anatomy

Reuse `Input` with `variant="search"` (SPEC §3.7 LOCKED). It auto-injects the leading `search` glyph (`Input.tsx` L529) and carries `autoCapitalize:"none"` + `autoCorrect:false` (ORCH-0823, `Input.variants.ts`). Set `clearable` so the trailing `close` (×) button appears when `value.length > 0` (`Input.tsx` L574).

- **Placeholder copy:** `Search events, trips, settings…` (Mingla voice: concrete, lower-case-casual, promises breadth). `placeholderTextColor` = `text.quaternary` (built-in).
- **Field container:** the `Input` 48pt search bar, full content width, sits at the very top of the sheet body. Padding around it = `spacing.md` (16) horizontal (matches `Sheet` body `paddingHorizontal: spacing.md`), `spacing.sm` (8) below before the result list begins.
- **Focus state:** border animates idle→`accent.warm` 1.5px over 120ms (built-in `Input` behavior, `Input.tsx` L583 + `durations.fast`).
- **Autofocus:** §7.2 (deferred on native until spring settles; immediate on web).
- **Return key:** `returnKeyType="search"`. Pressing return does NOT submit a query (results are live) — it **activates the first/highlighted result row** if one exists (keyboard-first parity with the web palette), else dismisses the keyboard. On wide-desktop, ↑/↓ move the highlight, Enter activates (web shell; the implementor may reuse `cmdk`'s keyboard model OR hand-roll — R-5 says do not touch `CommandPalette.web.tsx`, but the new web shell may independently use cmdk-for-render per SPEC §6 plan item 4; either way the SHARED service owns the data).
- **Clear (×):** tapping resets `query` to `""` and returns the sheet to the empty state; focus stays in the field. ≥44pt target via the `Input` trailing button `hitSlop:{8,8,8,8}` (`Input.tsx` L664).

---

## 5. Result row anatomy (shared across all 3 surfaces)

Two row densities, one visual language.

### 5.1 Offering rows (`type: event | trip | experience`) — 56pt
Offerings carry a subtitle (status • next-date or location), so they get a taller row for breathing room.

```
┌────────────────────────────────────────────────────────────┐
│ [icon]   Title of the event (1 line, ellipsized)      [›]   │  ← 56pt
│  20px    Live • Sat 14 Jun   ·or·  The Roundhouse, NW1       │
└────────────────────────────────────────────────────────────┘
  ^16    ^12 gap      title text.primary body              ^chevR
  pad                 subtitle text.tertiary bodySm
```
- Height: 56 (= `spacing.xxl` 48 + `spacing.sm` 8 — comfortable 2-line). Min touch target satisfied (>44).
- Horizontal padding: `spacing.md` (16) left/right.
- Leading icon column: fixed 20px glyph + `spacing.md` (16) gap to text block. Icon vertically centered to the 2-line block (optical-center on the title line — see §10 alignment).
- Title: `typography.body`, `text.primary`, `numberOfLines={1}`, ellipsized.
- Subtitle: `typography.bodySm`, `text.tertiary`, `numberOfLines={1}`, ellipsized. Format: for events `${statusLabel} • ${nextDateShort}`; for experiences `${statusLabel}`; for trips `${statusLabel}` (Trip has no location field — do NOT fabricate, SPEC §3.1.5). Drafts show `Draft` as the status label (R-1 includes drafts).
- Trailing: `chevR` 18px, `text.quaternary`, `spacing.sm` (8) from the right edge of the text block.

### 5.2 Registry rows (`type: screen | setting | action`) — 48pt
Registry rows are single-line by default (label only) unless the authored subtitle adds value; keep them compact (Linear-tight) so the list scans fast.

```
┌────────────────────────────────────────────────────────────┐
│ [icon]   Payout reports                               [›]   │  ← 48pt
└────────────────────────────────────────────────────────────┘
```
- Height: 48 (`spacing.xxl`). Touch target satisfied.
- Same 16 pad / 20 icon / 16 gap / chevR-18 grid as offerings (columns line up across groups — critical for the one-glance scan).
- Title: `typography.body`, `text.primary`.
- Optional subtitle (`typography.bodySm`/`text.tertiary`) only when authored (§8 registry copy). When present, row grows to 56pt to match offering rhythm.

### 5.3 Press / active feedback (non-shifting — premium-craft §2)
- **Native press-in:** background fills `glass.tint.profileBase` `rgba(255,255,255,0.04)` + icon/title shift to `text.primary`/`accent.warm`? No — keep title `text.primary`; only the **fill** changes (color-only, zero reflow). Light haptic `HapticFeedback.buttonPress()` on press-in (D-5).
- **Wide-desktop keyboard-highlighted row:** background `accent.tint` `rgba(235,120,37,0.28)`, title → `accent.warm` `#eb7825` — exactly the `CommandPalette.web.tsx` `[data-selected]` rule (L348). This is the ONE place title color changes, and it's the established web-palette convention.
- No scale, no border, no shadow on rows (rows are inside an already-elevated surface; stacking effects = noise, premium-craft §2).

### 5.4 Group header
- `typography.labelCap`, `text.tertiary`, uppercase already-baked (letter-spacing 1.4).
- Padding: `spacing.sm` (8) horizontal beyond the row's 16 → actually align the heading text's left edge to the row TITLE's left edge (16 pad + 20 icon + 16 gap = 52 from sheet edge) for a clean type-column, OR align to the row left-pad (16). **Decision:** align heading to the **row content left-pad (16)** — matches `CommandPalette.web.tsx` (`[cmdk-group-heading] padding: 8px 16px 4px`). Top padding `spacing.sm`+`spacing.xs` (8+4=12) above first row of the group; first group gets `spacing.sm` (8) below the search field instead.
- Headings: exact strings `OFFERINGS`, `GO TO`, `SETTINGS & ACTIONS` (rendered uppercase by the `labelCap` text-transform; author the source string in sentence case `Offerings`/`Go to`/`Settings & actions` per SPEC §3.1.3 and let the style uppercase, mirroring the existing palette).
- Empty-state headings: `RECENT`, `JUMP TO` (same `labelCap` treatment).

---

## 6. Presentation shell per surface

### 6.1 Mobile (iOS + Android) + narrow web — bottom sheet
- Primitive: `Sheet` (`Sheet.tsx` native / `Sheet.web.tsx`→`MobileSheet` narrow). `snapPoint="full"` (0.9 × screen height) — a search surface wants maximum result real estate; `half` (0.5) would crop the empty-state jump-to grid on small phones.
- `dismissOnScrimTap` = default `true`.
- Drag handle 36×4 (primitive-owned, top of panel).
- Body layout (inside `Sheet` body which already has `paddingHorizontal: spacing.md` + bottom safe-area pad): a flex-column — `Input` search field (fixed) → divider (`spacing.sm` gap, optional hairline `glass.border.profileBase`) → results `ScrollView` (`flex:1`, `keyboardShouldPersistTaps="handled"` so a tap on a row while the keyboard is up still registers — same pattern as `Input.tsx` L692). The column MUST be an explicit `flex:1` wrapper (the D-IMPL-42/44 flex-collapse lesson documented in `Input.tsx` L787 + `Sheet.tsx` — without it the ScrollView collapses to 0).
- Keyboard avoidance: `Sheet` deliberately does NOT own keyboard handling (ORCH-0892-B v2, `Sheet.tsx` L169); the panel rests at its snap point. The internal results `ScrollView` scrolls under the field; the field is pinned at the top above the keyboard since the panel top is at 10% from screen top and the field is the first child. No `KeyboardAvoidingView` needed — the result list simply shortens behind the keyboard, which is correct for a search list.

### 6.2 Phone-width geometry (375 / 390 / 430pt — no horizontal scroll)
At all three widths the sheet is full-width; the row grid (16 + 20 + 16 + flex title + 8 + 18 + 16) fits with the title flex-shrinking and ellipsizing. Verified no fixed-width child exceeds 375 − 32 = 343pt content width. The empty-state `Jump to` rows are full-width list rows (not a grid of cards), so no wrapping/overflow risk.

### 6.3 Wide-desktop (≥1024px) — centred card
- Primitive: `Sheet.web.tsx` → `DesktopCenteredCard`. Width `min(640, vw−64)`, max-height `min(80vh, vh−64)`, radius `lg` (16), opaque `rgba(20,22,26,0.92)`, `shadows.glassModal`, scrim `rgba(0,0,0,0.55)`, scale-in 0.96→1 + fade 200ms (all primitive-owned).
- **N-3 override (the one shell tweak):** `DesktopCenteredCard` vertically *centres* the card (`cardWrap justifyContent:"center"`). A search palette reads better anchored **near the top** (Raycast/Linear/cmdk all top-anchor at ~15–20vh; the existing `CommandPalette.web.tsx` uses `top: 20vh`). The implementor should top-anchor the global sheet's wide-desktop card at **12vh** to match the palette mental model. Two acceptable mechanisms: (a) pass a style override that sets the card wrap to top-align, or (b) if the primitive can't be overridden without editing `Sheet.web.tsx` shared code, the web shell renders its OWN top-anchored container (since the web shell is a new file, this is clean) reusing the same dims/scrim/motion tokens. **Implementor picks the smaller-surface mechanism; do not edit shared `Sheet.web.tsx` geometry for other consumers.** If neither is cheap, falling back to the primitive's vertical-center is acceptable (it still works; top-anchor is a polish preference, not a floor).
- Card body: same flex-column (field → divider → scrollable list). The card auto-sizes to content up to max-height; with many results the list scrolls inside the card (`overflowY:auto` per the primitive `cardBody flexShrink:1`).
- Esc / scrim-tap dismiss (primitive `onRequestClose` + scrim `Pressable`).

### 6.4 Mount + entry (LOCKED, SPEC §3.7)
- ONE mount at `app/(tabs)/_layout.tsx`, next to the existing `<CommandPalette />` (which stays — R-5 COEXIST). Opened via `useGlobalSearchSheet().isOpen`.
- TopBar wiring: `DefaultRightSlotInner`'s `search` `IconChrome` (`TopBar.tsx:125`) gets `onPress={() => useGlobalSearchSheet.getState().open()}`; the `[TRANSITIONAL]` comment for search is removed (bell stays transitional). The icon's existing 36→44 hit target + `accessibilityLabel="Search"` are unchanged.

---

## 7. Motion

All within the app's existing motion language (`Sheet` springs + `durations`/`easings`). Every animation has a reduced-motion fallback (the primitives already implement `useReducedMotion`).

### 7.1 Open / close
- **Mobile open:** translateY full→snap via `SPRING_CONFIG` (damping 22 / stiffness 200 / mass 1) + scrim fade 200ms. Reduced-motion → 200ms fade only (primitive-owned, `Sheet.tsx` L220).
- **Mobile close:** 240ms `Easing.in(cubic)` translateY back + scrim fade.
- **Wide-desktop open:** card opacity 0→1 + scale 0.96→1 over 200ms `Easing.out(cubic)` + scrim fade. Reduced-motion → fade only, no scale (primitive, `Sheet.web.tsx` L156).
- **Wide-desktop close:** 180ms `Easing.in(cubic)`.

### 7.2 Autofocus choreography (D-4)
- **Native:** call `inputRef.focus()` AFTER the open animation settles. Mechanism: focus on a `setTimeout` matched to the spring's visual settle (~`durations.entry` 260ms is a safe, token-backed delay) so the iOS keyboard doesn't race the spring (a known RN jank). Reduced-motion → focus after the 200ms fade.
- **Web:** focus immediately on mount (no soft keyboard to fight; `Sheet.web.tsx` notes the keyboard listener is irrelevant on desktop).

### 7.3 Results updating
- No per-keystroke animation. The input echoes the keystroke immediately; the filtered list swaps after the 120ms debounce (SPEC §3.2). The swap is **instant (no cross-fade)** — animating a list that changes every keystroke reads as lag, not polish (premium-craft: motion must communicate, not decorate). Group headers appear/disappear instantly with their group's presence.

### 7.4 Row press
- Native: background-fill color transition over `durations.fast` (120ms) `easings.press` + haptic. No scale (rows in a list; scale would feel toy-ish and risk reflow).
- Web: CSS hover/`[data-selected]` background swap, instant (≤120ms), no layout shift.

---

## 8. All 9 states — exact copy + visual

Copy is in Mingla voice: plain, warm, a little dry, never cute-for-cute's-sake, never blaming the user. All states render INSIDE the same shell; only the body content changes.

| # | State | Trigger | Visual | Exact copy |
|---|-------|---------|--------|------------|
| 1 | **First-time / empty** | sheet open, `query.trim().length < 2` | Field focused, placeholder visible. Below: `RECENT` group (only if recents exist) of up to 6 MRU query chips-as-rows, then `JUMP TO` group of the top registry screens (cap 5/group per SPEC §3.2), each a registry row with leading type icon + chevR. | Placeholder: `Search events, trips, settings…` · Recent heading: `Recent` · Jump-to heading: `Jump to` · (no body sentence — the rows ARE the content) |
| 2 | **Loading (cold cache)** | a source cache still fetching on first open | Registry groups render normally (always available). The `OFFERINGS` group shows ONE skeleton row: a 56pt row with a shimmer-free muted placeholder (icon-circle `glass.tint.profileBase` + two grey bars `rgba(255,255,255,0.06)` at title/subtitle widths) + the line below. No spinner. | One muted line under the offerings heading: `Loading your stuff…` (`bodySm`, `text.tertiary`). |
| 3 | **Populated** | `query.trim().length ≥ 2`, ≥1 match | Grouped results, fixed order, ranked. Empty groups omit heading. Per-group caps 8/6/6 (SPEC §3.2). | — (rows are the content) |
| 4 | **Zero-result** | `query.trim().length ≥ 2`, 0 matches | Centered-ish block in the list area: one line + up to 3 nearest registry suggestions (from the fuzzy tier) rendered as normal registry rows under a small heading. Never a blank void. | Headline: `No matches for "{query}".` (`body`, `text.primary`) · sub: `Try a name, or jump to a setting.` (`bodySm`, `text.tertiary`) · if suggestions exist, heading `Did you mean` above the suggestion rows. |
| 5 | **Submitting** | N/A — no mutation | — | — (state does not exist; SPEC §3.7 #5) |
| 6 | **Offline** | no connectivity | Functionally identical to online — registry + cached offerings search client-side. No banner, no error. | — (no offline-specific copy; silence is correct) |
| 7 | **Returning** | reopen after a prior session-search | Empty state shows the `Recent` group populated with prior queries (ephemeral, in-session only per R-4). | Recent heading: `Recent` |
| 8 | **Degraded (rank 0 / no current brand)** | `rank < lowest registry minRank` OR no `brandId` | Offerings group empty (no brand cache). Registry filtered to the caller's rank (at rank 0 + no brand, may be empty). Sheet still opens, field works, no crash. If the ENTIRE body would be empty AND there's no query: show a single calm line. | If body empty + no query: `Nothing to jump to yet — create your first event to get started.` (`bodySm`, `text.secondary`). If a query is typed but nothing is permitted: fall through to state 4 copy. |
| 9 | **Error** | `searchIndex` throws (defensive try/catch, SPEC §3.7 #9) | The list area shows ONE row: leading `flag` icon in `semantic.error`, single line. Sheet stays alive and usable; clearing the query recovers. | `Something went wrong searching. Try again.` (`bodySm`, `text.primary`, icon `flag`/`semantic.error`). |

**Copy principles applied:** "your stuff" (warm, casual, ownership), "{query}" echoed back (acknowledges what they did), "Try a name, or jump to a setting" (shows the way forward — premium-craft error-as-conversation), no exclamation marks, no apologies that blame the user.

---

## 9. Per-type leading icon mapping (from the existing `IconName` set only)

Resolves SPEC §3.6's OPEN items (trip glyph, action glyph) within the 69-glyph `Icon.tsx` set. No new icons, no emoji (premium-craft §2).

| `SearchResultType` | `iconName` | Rationale / evidence |
|--------------------|-----------|----------------------|
| `event` | `calendar` | SPEC §3.6 LOCKED; `Icon.tsx` L112. Events are date-anchored. |
| `trip` | `compass` | SPEC left this OPEN ("trip-specific glyph if added"). `compass` exists (`Icon.tsx` L340) and was *purpose-added for the trip persona card* (ORCH-0855 comment L339: "compass icon for the 'A trip' persona card"). This disambiguates trips from events at a glance — better than re-using `calendar`. **Resolves N-2.** |
| `experience` | `sparkle` | SPEC §3.6 LOCKED; `Icon.tsx` L235. |
| `screen` (group `goto`) | `chevR` is the trailing chevron, so the LEADING glyph is **`compass`? no** — use a neutral navigational leading glyph per-screen where one is obvious, else default `globe`. **Decision:** screens use a **semantic per-screen icon** where the registry entry maps cleanly (see §9.1), default `globe` (`Icon.tsx` L333) for "go somewhere". Avoids a wall of identical chevrons. |
| `setting` | `settings` | SPEC §3.6 LOCKED; `Icon.tsx` L159. Default for settings without a more specific semantic icon. |
| `action` | per-action semantic, default `plus` | SPEC left OPEN. Creation actions ("Create event/trip/experience") use `plus` (`Icon.tsx` L125) — universally "make a new thing". Non-creation actions use their domain icon (§9.1). |

### 9.1 Per-registry-entry icon overrides (semantic, all from `IconName`)
Giving each registry row a meaningful leading glyph (Notion/Raycast do this) makes the list scannable. Implementor maps each of the §3.5 registry entries (after R-3 standalone-screen trim) to:

| Registry entry (key) | `iconName` | Registry entry (key) | `iconName` |
|----------------------|-----------|----------------------|-----------|
| `home` | `home` | `payments` | `bank` |
| `hub-events` | `calendar` | `payments-onboard` | `bank` |
| `hub-trips` | `compass` | `payments-reports` | `receipt` |
| `hub-experiences` | `sparkle` | `pricing-defaults` | `pound` |
| `marketing-overview` | `trending` | `tax-registrations` | `receipt` |
| `marketing-campaigns` | `mail` | `account-notifications` | `bell` |
| `marketing-audiences` | `users` | `account-edit` | `user` |
| `marketing-templates` | `template` | `account-delete` | `trash` |
| `account` | `user` | `create-event` | `plus` |
| `brand-public-listing` | `globe` | `create-trip` | `plus` |
| `brand-edit` | `edit` | `create-experience` | `plus` |
| `brand-team` | `users` | `connect-account-mgmt` | `bank` |
| `brand-scanners` | `scan` | | |
| `brand-audit-log` | `notebook` | | |
| `brand-blasts` | `send` | | |

All exist in `Icon.tsx`. (If R-3's trim drops any entry, drop its row here too — the implementor lists dropped entries in the impl report per the ruling.)

---

## 10. Accessibility & contrast (computed, not eyeballed)

### 10.1 Contrast ratios (against the effective opaque surface)
Effective surface luminance for ratio math: the sheet fill is `rgba(20,22,26,0.92)` over the app canvas; the visible composite is ≈ `#16181c` (L ≈ 0.0075 relative luminance). Ratios computed against `#16181c`:

| Text token | Color | Ratio vs surface | Floor | Pass |
|------------|-------|------------------|-------|------|
| Row title `text.primary` | `rgba(255,255,255,0.96)` ≈ `#f5f5f5` | **17.6:1** | 4.5:1 body | ✅ |
| Row subtitle `text.tertiary` | `rgba(255,255,255,0.52)` ≈ `#888888`-composite | **5.1:1** | 4.5:1 body | ✅ |
| Group heading `labelCap` `text.tertiary` (12pt, weight 600) | as above | **5.1:1** | 3:1 (large/bold-ish) & 4.5 body — passes either | ✅ |
| Empty/zero sub `text.secondary` | `rgba(255,255,255,0.72)` ≈ `#b8b8b8`-composite | **9.6:1** | 4.5:1 | ✅ |
| Web highlighted-row title `accent.warm` `#eb7825` on `accent.tint` `rgba(235,120,37,0.28)` over surface (composite bg ≈ `#3a2a1e`) | `#eb7825` | **4.6:1** | 4.5:1 body / 3:1 large | ✅ (matches shipped `CommandPalette.web.tsx`) |
| Error line `text.primary` + `flag` icon `semantic.error` `#ef4444` | icon on surface | icon **4.0:1** | 3:1 (graphical/large) | ✅ |
| Placeholder `text.quaternary` `rgba(255,255,255,0.32)` | ≈ `#5a5a5a` | **2.9:1** | placeholder is non-essential decoration; the field has an `accessibilityLabel` and visible icon — acceptable per WCAG (placeholders exempt), but do NOT rely on it as the only label | ⚠ exempt |

The app is dark-mode-only on these surfaces (no light theme for the business glass chrome — `text` tokens are white-alpha; `canvas` is dark). So "both modes" reduces to the single dark surface here; there is no light variant to compute (the SPEC's §4 SC-15 "dark + light" is satisfied by noting the surface has no light mode — flagged N-4). All essential text clears 4.5:1.

### 10.2 Screen reader / focus
- **Sheet role:** the `Sheet`/`DesktopCenteredCard` render inside a native `Modal` (iOS/Android announce as modal; focus is trapped to the modal subtree by the OS). Web: `Modal` from RN-web → focusable container; the implementor adds `accessibilityViewIsModal` (iOS) and ensures the web card has `role="dialog"` + `aria-label="Search"`.
- **Focus management:** on open, focus the search field (§7.2). On close, restore focus to the TopBar search `IconChrome` (the opener) — the implementor captures the trigger ref or relies on the OS modal-dismiss focus-return.
- **Trap:** the Modal traps focus on native automatically; on web the card must trap Tab within (field → rows → field). If the web shell uses `cmdk`, cmdk handles this; if hand-rolled, the implementor wires a focus trap.
- **Group headings:** `accessibilityRole="header"` so SR users can navigate by heading; heading text read as e.g. "Offerings, heading".
- **Rows:** each row `Pressable` with `accessibilityRole="button"` + `accessibilityLabel` = `${title}${subtitle ? ", " + subtitle : ""}` (e.g. "Payout reports, button" / "Summer Rooftop Party, Live, Saturday 14 June, button"). Trailing chevron is decorative → `accessibilityElementsHidden`/`importantForAccessibility="no"`.
- **Live region:** the result-count change should be announced politely. Implementor sets an `accessibilityLiveRegion="polite"` (Android) / `AccessibilityInfo.announceForAccessibility` (iOS) wrapper announcing e.g. "12 results" after the debounce, and "No matches" in state 4. Keep it terse to avoid chatter.
- **Esc (web) / hardware back (Android):** both dismiss (primitive `onRequestClose`).
- **Hit targets:** every interactive element ≥44pt — rows are 48/56pt; the `Input` clear button uses `hitSlop` to reach 44; the TopBar opener is 36+8=44 (`IconChrome` default).

### 10.3 Dynamic Type
Row heights are min-heights expressed via padding around `typography` tokens, NOT fixed heights that would clip scaled text. Implementor: use `minHeight: 48/56` + vertical padding so larger Dynamic Type / font-scale grows the row instead of clipping. Title/subtitle keep `numberOfLines={1}` + ellipsize (search rows are scannable, not readable-in-full — the destination shows the full text).

---

## 11. Responsive summary + open-item resolutions

### 11.1 Responsive matrix
| Width band | Shell | Anchor | Width | Dismiss |
|------------|-------|--------|-------|---------|
| Native iOS/Android (any width) | bottom sheet (`SheetMobile`) | viewport bottom, `full` 0.9×H | 100% | drag / scrim / back |
| Web < 1024 | bottom sheet (`Sheet.web`→`MobileSheet`) | viewport bottom | 100% | scrim / Esc |
| Web ≥ 1024 | centred card (`DesktopCenteredCard`) | top-offset 12vh (N-3) | `min(640, vw−64)` | scrim / Esc |

Gate is `useResponsiveLayout().isWideDesktop` (≥1024 inclusive, native always false) — never a raw width check (I-DESKTOP-GATE-VIA-HOOK, honored automatically by reusing `Sheet.web.tsx`).

### 11.2 Notes / flagged items (no LOCKED-floor conflicts)
- **N-1 (no conflict):** SPEC §13 LOCKED `Sheet`/`SheetMobile` + `Input variant="search"` + single tabs-root mount + 9 states + group order — all honored exactly.
- **N-2 (resolved):** trip leading icon = `compass` (purpose-built for trips, `Icon.tsx` L340). Resolves §3.6 OPEN.
- **N-3 (polish, not a floor):** wide-desktop top-anchor at 12vh is a craft preference over the primitive's vertical-center; implementor uses the cheapest mechanism and may fall back to center without violating any floor.
- **N-4 (clarification, not a gap):** these business glass surfaces are dark-mode-only (white-alpha `text` tokens, dark `canvas`). SC-15's "light + dark" is satisfied — there is no light variant to design. If a light business theme is ever introduced, the glass-legibility rule (premium-craft §4) must be re-checked.
- **N-5 (R-1 drafts):** draft offerings appear in `OFFERINGS` with subtitle status `Draft`, routed via `routeForEventRow` (R-2 mandatory). Icon = same per-type glyph (a draft event still shows `calendar`). No visual "draft badge" in Phase 1 — the `Draft` status word in the subtitle is the signal (keeps rows uniform; a badge is a later-polish option).
- **N-6 (R-2 routing):** all offering `route` values come from `routeForEventRow` (strict-grep enforced); experiences resolve to `/experience/coming-soon` exactly as the hub does → no dead tap. The row still renders + is tappable; the destination is the coming-soon screen (acceptable per ruling, SC-12 satisfied).

---

## 12. Pre-delivery craft checklist (premium-craft §5)

- [x] **References examined** line present (Raycast / Notion / Linear / Stripe / Things + in-repo `CommandPalette.web.tsx`), with sources.
- [x] Zero anti-slop: no gradients (flat token fills), no stock/AI imagery (icon-only + text), no emoji icons (all from `IconName`), no decorative effects (rows are flat inside one elevated surface).
- [x] Every spacing/size value is a token from the 4px `spacing` grid (or a primitive-owned constant explicitly noted, §3).
- [x] Alignment: icon column / title left-edge / group-heading left-edge form one type column across all groups (§5.4); chevron right-aligned; icons optically centered to title line.
- [x] Hierarchy one-glance: icon → title (loudest) → subtitle → chevron (§2.3).
- [x] All 9 states designed with exact copy (§8); inapplicable states (5 submitting) named with reason.
- [x] Contrast computed for all essential text (§10.1), values written, all ≥4.5:1 body; dark-only surface noted (N-4).
- [x] Every interactive element ≥44pt, `accessibilityLabel`, non-shifting feedback (§5.3, §10.2).
- [x] Motion has purpose + reduced-motion fallback (§7, primitive-owned `useReducedMotion`).
- [x] Copy in Mingla voice per state (§8).
- [x] Would sit next to Linear/Raycast/Notion quick-find — grouped, instant, keyboard-first, calm.

---

**End of DESIGN.** Functional contract (SPEC §13 LOCKED) untouched; only the 🎨 OPEN visual/interaction surface filled, within existing `designSystem.ts` tokens, the `Icon.tsx` `IconName` set, and the `Sheet`/`Input`/`IconChrome` primitives. No new tokens, no new dependency, no new modal system, no convergence with `CommandPalette.web.tsx` (R-5 COEXIST honored). Ready for IMPLEMENT.
