# SPEC — ORCH-1143 [business Home live-card: scan-ticket parity + accordion + multi-live carousel]

**Skill:** mingla-forensics+claude · **Phase:** SPEC (artifact-only; no product code) · **Date:** 2026-06-15
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1143_LIVE_CARD_SCAN_PARITY.md`
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1143-[live-card-scan-accordion]/` on branch `ORCH-1143-live-card-scan-accordion`.
**App:** Mingla BUSINESS (`mingla-business/`).

---

## 1. Executive summary

The business Home "LIVE NOW" hero today shows a single live offering and only puts a "Scan QR codes" button on it when it is an **event**. The investigation PROVED (five-layer) that the ticket-scan backend (`scan-ticket` edge fn → `biz_ticket_scan` RPC), the scanner screen (`/event/[id]/scanner`), and the route resolver (`useManagedEventRoute`) are ALL event-type-agnostic and already work for events, experiences, AND trips with zero backend changes. The entire ORCH-1143 ask is therefore **UI-only on the business Home screen plus one new persisted collapse store**:

1. **Scan button on every live offering kind** (event/experience/trip), all routing to the shared `/event/[id]/scanner`.
2. **Collapsible accordion** for the live section, with a `hasHydrated`-gated persisted open/closed store (Constitution #14).
3. **Horizontal carousel** of cards when multiple offerings are live concurrently, each card carrying its own scan button.

NO backend work. NO new scanner routes. NO scope expansion.

---

## 2. Scope & non-goals

### In scope
- Generalize the live-offering scan affordance to all three kinds (event/experience/trip), routing all to `/event/{id}/scanner`.
- Lift the inline hero block (`home.tsx:469-535`) into a reusable per-card live component that normalizes any `UpcomingItem` (incl. trips via `tripToLiveEvent`) to a `LiveEvent`-shaped view for metrics.
- Render ALL concurrently-live offerings as a horizontally-scrollable carousel; single live offering renders as a single full-width card (no horizontal scroll needed for one).
- Wrap the live section in a collapsible accordion header (count + chevron), backed by a new persisted, `hasHydrated`-gated Zustand store.
- Correct the stale ORCH-0965 comment (`home.tsx:354-356`) (DISC-1143-A).
- Cross-surface: business iOS + Android (native camera scan), business web preview (card UI + scan button → existing kind-aware web scanner EmptyState).

### Non-goals (explicitly OUT)
- **Any backend / migration / edge-function change.** Proven unnecessary (INVESTIGATE F-1..F-8). Do NOT touch `scan-ticket`, `biz_ticket_scan`, `biz_ticket_checkout_finalize`, or any SQL.
- **New `/experience/[id]/scanner` or `/trip/[id]/scanner` routes.** `/event/[id]/scanner` is the shared route for all kinds (F-6). Do NOT create them.
- **A real "Scanned" count.** The tile stays "—" (honest-empty per Constitution #9; DISC-1143-C). No new aggregate read.
- **The `?? "GBP"` client fallback** in `useEventSalesSummaries`/`tripToLiveEvent` — deferred ORCH-1034 work; do NOT change it here.
- **The scanner screen itself** (`index.tsx`/`index.web.tsx`) — already kind-aware; byte-unchanged.
- **The "Upcoming" list section** below the live section — unchanged except that live items now live in the carousel (they already sort live-first; the Upcoming list should render the non-live items only, to avoid duplicating a live card both in the carousel and the list — see SC-7).

### Assumptions
- A live offering's per-card metrics (revenue/sold/capacity) use the existing `useEventSalesSummaries` + `finiteTicketCapacity`, fed a `LiveEvent` (trips adapted via `tripToLiveEvent`). Proven (F-8).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | NO | — | none | n/a — no business Home/scanner |
| 2 | Consumer Android (`app-mobile`) | NO | — | none | n/a |
| 3 | Buyer/anonymous Web | NO | — | none | n/a — buyer surface |
| 4 | Business iOS | YES | Live section is a collapsible accordion; ≥1 live offering renders as carousel cards (event/experience/trip), each with a working "Scan QR codes" button → native camera scanner. | `app/(tabs)/home.tsx`, new `LiveOfferingCard.tsx`, new `liveSectionCollapseStore.ts`, `upcomingBuilder.ts`, `useUpcomingForBrand.ts` | shared with Android → automatic |
| 5 | Business Android | YES | Same as iOS. New glass cards use `GlassCard` (opaque-fallback policy already in GlassCard). | same as iOS | automatic (shared RN) |
| 6 | Admin Web | NO | — | none | n/a |
| 7 | Business Web preview (adjacent) | YES (card UI; camera N/A) | Accordion + carousel + scan button render. Scan button routes to `/event/{id}/scanner`, whose `.web.tsx` shows the kind-aware "Scan tickets in the app" EmptyState (ORCH-1099). NOT a dead tap. | `home.tsx` (shared) | manual but already-built (web scanner override exists) |

---

## 4. Layered specification

No Database / Edge / Service / Realtime layers are touched. Hook + Util + Component + State only.

### 4.1 Util — `mingla-business/src/utils/upcomingBuilder.ts` (MODIFY)

Add a `liveItems` field to the `buildUpcomingItems` return (one-owner-per-truth for live-state; SC-2, Constitution #2). `liveItems` = the already-sorted live subset.

- Extend the return type: `{ items: UpcomingItem[]; counts: UpcomingCounts; primaryLiveItem: UpcomingItem | null; liveItems: UpcomingItem[] }`.
- Compute: `const liveItems = nonPast.filter((i) => i.status === "live");` (after the existing sort, so it inherits live-first start-ascending order — comparator lines 154-163).
- `primaryLiveItem` stays `liveItems[0] ?? null` (equivalent to the existing `find`); keep both for back-compat.
- Illustrative (≤2 lines): `const liveItems = nonPast.filter((i) => i.status === "live"); return { items: nonPast, counts, primaryLiveItem: liveItems[0] ?? null, liveItems };`

### 4.2 Hook — `mingla-business/src/hooks/useUpcomingForBrand.ts` (MODIFY)

- Add `liveItems: UpcomingItem[]` to the `UpcomingForBrand` interface.
- Destructure `liveItems` from `buildUpcomingItems` and return it. No query-key change, no new query.

### 4.3 State — `mingla-business/src/store/liveSectionCollapseStore.ts` (NEW)

Persisted Zustand store for the live-section accordion open/closed state, modeled EXACTLY on `currentBrandStore`'s hydration gate (Constitution #14).

- Shape:
  - `collapsed: boolean` — persisted. Default `false` (open on first load — see Open Question OQ-1).
  - `hasHydrated: boolean` — NOT persisted; flipped true in `onRehydrateStorage`.
  - `setCollapsed: (v: boolean) => void`, `toggle: () => void`, `setHasHydrated: (v: boolean) => void`, `reset: () => void`.
- `persist` config: `name: "mingla-business.liveSectionCollapse.v1"`, `storage: createJSONStorage(() => AsyncStorage)`, `partialize: (s) => ({ collapsed: s.collapsed })`, `version: 1`, `onRehydrateStorage: () => () => useLiveSectionCollapseStore.getState().setHasHydrated(true)`.
- Wire `reset` into `clearAllStores` (logout cascade, Constitution #6) — find the existing `clearAllStores` aggregator and add this store's `reset`.
- Decision: **whole-section collapse** (one toggle for the entire live section), NOT per-card. Rationale: Seth's ask is "save space on the home page"; a single collapse of the whole live block reclaims the most space and matches the `BusinessTodoToggle` precedent (one header, one chevron). Per-card collapse adds N persisted keys and clutter for no stated benefit. (See OQ-2.)

### 4.4 Component specs — PIXEL-PRECISE (mingla-designer+claude, 2026-06-15)

> Design contract embedded by **mingla-designer**. The implementor builds to these exact tokens/values without guessing. All tokens resolve from `mingla-business/src/constants/designSystem.ts` (`spacing` 2/4/8/16/24/32/48 = `xxs/xs/sm/md/lg/xl/xxl`; `radius` 8/12/16/24/28 = `sm/md/lg/xl/xxl`, `full`=999; `typography`; `accent.warm`=`#eb7825`; `text.*`; `glass.*`; `semantic.*`). **No new palette, no new token introduced — everything below maps to a token that already exists.** Glass is always `GlassCard`, whose internal `GlassChrome` already enforces the `ANDROID_GLASS_USES_OPAQUE_FALLBACK` policy (Android = opaque `rgba(20,22,26,0.92)` fill + `overflow:'hidden'` + no Android shadow under the rounded fill). Designer carries the iOS-translucent / Android-opaque deltas in §4.5.

#### 4.4-IA — Information architecture of the live section

```
LIVE SECTION (renders only when liveItems.length > 0)
├─ Accordion header row (always visible while ≥1 live)   ← collapse control, whole-section scope
│   ├─ left:  [live dot] "Live now" + count chip ("· 2" when N>1)
│   └─ right: chevron (chevU open / chevD collapsed)
└─ Body (only when expanded; hidden when collapsed)
    ├─ N === 1 → ONE full-width LiveOfferingCard
    └─ N >= 2 → horizontal ScrollView of LiveOfferingCards (peek), live-first by start time
```

Hierarchy rationale: the header is the new top-level affordance (collapse to "save space" — Seth). The card's own internal hierarchy is unchanged from today's hero (revenue is the hero number; sold/capacity/scanned are supporting stats; the scan button is the one action). The decision the user makes at this section: *"is something live I need to work the door for?"* → the answer is the card, and the action is **Scan QR codes**.

#### 4.4-A — `LiveSectionHeader` (the accordion control) — REVISED 2026-06-15 (continuous-section fix) — **AUTHORITATIVE**

> **This block SUPERSEDES the "REVISED 2026-06-15 (device-feedback fix)" block below it.** Build to THIS. The device-feedback block is retained for provenance only (it correctly fixed the 16pt gutter + the dropdown affordance — both PRESERVED here — but over-corrected by giving the header its OWN floating `GlassCard`, which Seth then rejected). Where the two conflict, this block wins.

> **Device-test defect (Seth, dev OTA 2026-06-15, verbatim):** "Its almost like it is two different sections as opposed to one continuous section with a divider."
>
> **Root cause (visual, not logical):** the device-feedback fix wrapped the header in its OWN `GlassCard variant="base"` (its own border + shadow + radius-16 surface). The body below it is a SEPARATE `LiveOfferingCard` = `GlassCard variant="elevated"` (its own border + shadow + radius-24 surface). Two independent glass surfaces, stacked, with flex air between them, read as **two cards = two sections**. Nothing groups them. Seth wants ONE continuous section where the header and content share a surface and are separated by a *divider*, not by a *gap between two cards*.

**Decision — OPTION A: one shared enclosing `GlassCard variant="base"` surface wraps the WHOLE section (header row → hairline divider → body), and the inner content drops its own glass chrome so there is no glass-on-glass and no air gap.** Chosen over Option B (header-as-bare-row, no enclosing surface) because Seth explicitly wants the section to feel *contained* AND have a *divider* — a divider with no surface around it floats in dead space and re-creates the "loose" feel; a single enclosing surface is what makes "header + content = one thing" inevitable. Chosen over keeping two cards because that IS the rejected state.

This is the **single-live** structure (the common case, and the one Seth is looking at). The carousel (≥2 live) is a deliberate exception, specified in 4.4-A.5 below — the enclosing surface can't cleanly contain a peek-scroller of independent cards, so for N≥2 the section uses the enclosing surface for header+divider and lets the carousel sit just under the divider INSIDE the same surface, full-bleed.

**New structure (single-live, N === 1):**

```
<View liveSection>                         // gutter wrapper: paddingHorizontal 16, marginBottom 16 (UNCHANGED)
  <GlassCard variant="base" padding={0}>   // THE shared section surface — padding 0 so we control insets per-region
    <Pressable liveSectionHeader>          // header region (the toggle), self-padded
      …live dot · Live now · count …  ⌄/⌃ chevron handle
    </Pressable>
    <View liveSectionDivider />            // hairline divider, full-width inside the surface, inset 16/16
    <View liveSectionBody>                 // body region, self-padded
      <LiveOfferingContent … />            // the live card CONTENT, NO own GlassCard (flat)
    </View>
  </GlassCard>
</View>
```

The header and the content are now visibly the SAME card, parted by one hairline. The chevron handle still signals collapsibility; the live dot + "Live now" still read as the header.

**A.1 — The shared surface (`liveSection` wrapper + the enclosing `GlassCard`).**
- `liveSection` wrapper `View`: **UNCHANGED** — `{ paddingHorizontal: spacing.md, marginBottom: spacing.md }`. Still the load-bearing 16pt Home gutter (flush with To-Do toggle, KPIs, Upcoming). Do NOT touch.
- The enclosing `GlassCard`: `<GlassCard variant="base" padding={0}>` — **`padding={0}`** (was `padding={spacing.md}`). We move the inset off the card and onto the header/body regions so the divider can run full-width inside the surface and each region controls its own inset. `variant="base"` = radius `lg`(16), softer chrome (lighter than the body content) — the section surface reads as the *container*, the content reads as *content within it*. The `GlassChrome` still auto-enforces `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (opaque ≥0.92 fill, `overflow:'hidden'`, no Android shadow) — zero manual `Platform.select`.

**A.2 — Header region (`liveSectionHeader`, was `liveHeaderRow`).** The same `Pressable` toggle, now self-padding (the card no longer pads it):
- `flexDirection:'row'`, `alignItems:'center'`, `justifyContent:'space-between'`, `paddingHorizontal: spacing.md` (16), `paddingVertical: spacing.sm` (8), `minHeight: 44`. The `paddingHorizontal:16` reinstates the inset the card used to provide; `paddingVertical:8` + `minHeight:44` keeps the ≥44pt target while sitting tight to the divider. (Rename optional — keeping the key `liveHeaderRow` is fine; if kept, just change its values per the delta table. This spec uses `liveHeaderRow` to minimize churn.)
- **Press feedback** stays on the header `Pressable` ONLY (NOT the whole card): `liveHeaderRowPressed { opacity: 0.6 }` — UNCHANGED. (Now only the header region dims on press, which is correct: the header is the button; the body is content, not part of the tap target.)
- Left cluster (`liveHeaderLeft`: dot + "Live now" + count chip) — **UNCHANGED** (dot `accent.warm` 7×7; title `bodySm`/700/`text.primary`; count `"· N"` `caption`/600/`text.secondary`, N>1 only).
- Chevron handle (`liveHeaderChevron`: 28×28 `radius.full` circle, `glass.tint.profileBase` fill, `chevD` collapsed / `chevU` open, 18pt `text.secondary`) — **UNCHANGED**. This is the collapsible affordance Seth approved; it stays.

**A.3 — The divider (`liveSectionDivider`) — NEW.** This is the element that replaces the inter-card gap with a hairline seam:
- `{ height: StyleSheet.hairlineWidth, backgroundColor: glass.border.profileBase, marginHorizontal: spacing.md }`.
- **Token:** `glass.border.profileBase` (`rgba(255,255,255,0.08)`) — the EXACT same border token the `base` GlassCard already draws its own perimeter with (`VARIANT_TOKENS.base.border` → `glass.border.profileBase`), so the divider reads as an *internal continuation of the card's own edge*, not a foreign line. Zero new token.
- **Thickness:** `StyleSheet.hairlineWidth` (1px device-independent hairline) — the house divider weight; matches the card border perimeter weight.
- **Inset:** `marginHorizontal: spacing.md` (16) on BOTH sides — the divider does NOT touch the card's rounded corners (a full-bleed divider would visually collide with the 16-radius corner and look broken). 16pt inset aligns the divider ends with the header text/chevron column, reinforcing "header above, content below, same column."
- **Renders ONLY when the body is open** (`showLiveOpen === true`). When collapsed, the body and the divider are both unmounted, so the header sits alone as a clean rounded bar (no orphan hairline under a collapsed header). See A.4.

**A.4 — Body region (`liveSectionBody`) — NEW wrapper, single-live case.** Wraps the live content beneath the divider, inside the shared surface:
- `{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md }` — i.e. `padding 16` horizontally, `8` top (tight under the divider, so content reads as belonging to the header), `16` bottom (comfortable base inset matching the old card feel).
- **The inner content (`LiveOfferingContent`) renders WITHOUT its own `GlassCard`** — see A.6. It is flat content laid directly on the shared `base` surface. No second border, no second shadow, no nested radius, no air gap. THIS is what collapses "two cards" into "one section."

**A.5 — Carousel exception (N ≥ 2).** The peek-scroller of independent cards cannot live flat-inside one base surface (multiple full-bleed flat blocks side-scrolling inside a rounded container clips badly and loses the peek). So for N≥2:
- The shared `GlassCard variant="base"` still wraps the **header row + divider** (identical to single-live: same continuous-surface read at the top).
- Directly under the divider, INSIDE the same `GlassCard`, the horizontal `ScrollView` of `LiveOfferingCard`s renders — but here each carousel card KEEPS its own `variant="elevated"` chrome (they need their own edges to read as discrete swipeable cards within the scroller). Body wrapper for the carousel: `liveSectionCarouselBody { paddingTop: spacing.sm, paddingBottom: spacing.md }` — NO `paddingHorizontal` (the `ScrollView` `contentContainerStyle` owns the 16 left inset + 16 right via `liveCarouselContent`, UNCHANGED). The carousel `contentContainerStyle` (`liveCarouselContent { gap: spacing.md, paddingRight: spacing.md }`) gains `paddingLeft: spacing.md` so the first card's left edge aligns to the divider's 16pt inset (previously the parent column supplied this; now the `GlassCard padding:0` does not, so the carousel must self-supply its left inset).
- Net for N≥2: header + divider read as ONE continuous header band (the fix Seth asked for), and the carousel of discrete cards sits clearly *under* that band, grouped by the shared surface above them. This is acceptable and coherent — the "two sections" complaint was specifically about the single floating header card vs. the single content card; binding the header band to the surface and parking the cards directly beneath the divider, all in one container, resolves it for both cases.

**A.6 — `LiveOfferingCard` content/chrome split (the one structural change to the card component).** Today `LiveOfferingCard` IS a `GlassCard variant="elevated"` wrapping the hero content (`LiveOfferingCard.tsx:87-92`). To render the single-live content FLAT inside the shared surface (A.4) while keeping the carousel cards as elevated cards (A.5), the card must support a chrome-less mode:
- Add a prop `flat?: boolean` (default `false`). When `flat === true`, the component renders its content `View` **without** the outer `<GlassCard>` (just the inner content tree + the existing inner padding, applied via a plain `View style={{ padding: spacing.lg }}`-equivalent OR by letting the A.4 `liveSectionBody` own the inset — see note). When `flat` is unset/false, it renders exactly as today (`GlassCard variant="elevated" padding={spacing.lg}`), used by the carousel.
- **Inset reconciliation (single-live `flat` path):** the body inset is owned by `liveSectionBody` (A.4: `paddingHorizontal:16, paddingTop:8, paddingBottom:16`). So in `flat` mode the card content should render with **NO additional outer padding** (set the flat wrapper to `padding: 0`), letting `liveSectionBody` supply the 16/8/16. This keeps the single-live content insets close to the old 24pt card feel without double-padding. (If the implementor finds the 16 too tight vs. the old 24, bump `liveSectionBody.paddingHorizontal` to `spacing.lg`/24 — token-only, designer-approved fallback.)
- The home parent passes `flat` only on the single-live `<LiveOfferingCard>` (N===1); the carousel maps pass no `flat` (stay elevated). `width` prop behavior UNCHANGED (carousel sets it; single-live leaves it undefined → full width of the body region).

**A.7 — Why this is one continuous section now (the inevitability check).** (1) One outer surface (`base` GlassCard) encloses header + divider + content → a single bounded card, not two. (2) The content has NO competing surface (flat in single-live; clearly-subordinate cards parked under the divider in carousel) → no "second card." (3) The header and content are parted by a hairline using the card's OWN border token → reads as an internal seam, the literal "divider" Seth named, not a gap. (4) Press feedback is scoped to the header region → the body doesn't behave like a button. (5) Everything the prior fix earned is preserved: 16pt gutter (`liveSection` wrapper unchanged), the chevron handle dropdown affordance (unchanged), ≥44pt target (`minHeight:44` on header), Android opaque glass (inherited from the single `base` GlassCard), zero new tokens.

**Exact `home.tsx` style-key deltas (StyleSheet at `:1135`+):**

| Key | BEFORE (current) | AFTER (continuous-section fix) |
|-----|------------------|--------------------------------|
| `liveSection` | `{ paddingHorizontal: spacing.md, marginBottom: spacing.md }` | **UNCHANGED.** |
| `liveHeaderRow` | `{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', minHeight: 44 }` | `{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44 }` — re-add header inset (the GlassCard no longer pads, now `padding={0}`). |
| `liveSectionDivider` | (NEW) | `{ height: StyleSheet.hairlineWidth, backgroundColor: glass.border.profileBase, marginHorizontal: spacing.md }`. |
| `liveSectionBody` | (NEW) | `{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md }` — single-live body region. |
| `liveSectionCarouselBody` | (NEW) | `{ paddingTop: spacing.sm, paddingBottom: spacing.md }` — carousel body region (no h-padding; ScrollView content owns it). |
| `liveCarouselContent` | `{ gap: spacing.md, paddingRight: spacing.md }` | `{ gap: spacing.md, paddingLeft: spacing.md, paddingRight: spacing.md }` — add left inset (GlassCard `padding:0` no longer supplies it). |
| `liveHeaderRowPressed`, `liveHeaderChevron`, `liveHeaderLeft`, `liveHeaderDot`, `liveHeaderTitle`, `liveHeaderCount` | (current) | **UNCHANGED.** |

> NOTE: `glass.border.profileBase` is imported in this file as part of the `glass` token object already in use (`glass.tint.profileBase` at the `liveHeaderChevron` style). `StyleSheet.hairlineWidth` is already available (RN core). `radiusTokens.full`, `spacing.*` already imported. **No new import, no new token.**

**JSX delta (`renderLiveSection`, `home.tsx:506-591`):**
1. Change the enclosing card from `<GlassCard variant="base" padding={spacing.md}>` to `<GlassCard variant="base" padding={0}>`.
2. The card now contains BOTH the header `Pressable` AND the body — i.e. the body block currently rendered as a SIBLING of the `GlassCard` (lines 557-590) moves INSIDE the `GlassCard`, BELOW the header `Pressable`, with the divider between them:
   ```
   <GlassCard variant="base" padding={0}>
     <Pressable …header…>…</Pressable>
     {showLiveOpen ? <View style={styles.liveSectionDivider} /> : null}
     {showLiveOpen ? (
       liveItems.length === 1 ? (
         <View style={styles.liveSectionBody}>
           <LiveOfferingCard flat item={liveItems[0]} metrics={…} onScanPress={handleScanPress} testID="home-live-card" />
         </View>
       ) : (
         <View style={styles.liveSectionCarouselBody}>
           <ScrollView horizontal …same props… contentContainerStyle={styles.liveCarouselContent}>
             {liveItems.map((liveItem) => (
               <LiveOfferingCard key={liveItem.key} item={liveItem} metrics={…} onScanPress={handleScanPress} width={liveCardWidth} />
             ))}
           </ScrollView>
         </View>
       )
     ) : null}
   </GlassCard>
   ```
   (The single-live `<LiveOfferingCard>` gains `flat`; carousel cards do NOT.)
3. The body is no longer a sibling of the GlassCard — there is now a SINGLE child tree under `liveSection`: the one `GlassCard`. Remove the now-stale comment fragment claiming "The card body … stays a SIBLING below this card, NOT inside it" and replace with one noting the continuous-section structure (header → hairline divider → body, all inside one `base` surface; single-live content is `flat`, carousel cards stay elevated).

**`LiveOfferingCard.tsx` delta (A.6):** add `flat?: boolean` to props; when `flat`, render the content tree inside a plain `<View style={{ padding: 0 }}>` (or no wrapper) instead of `<GlassCard variant="elevated" padding={spacing.lg}>`; default/unset = today's elevated card. The `width` prop is ignored in `flat` mode (single-live is full-width of `liveSectionBody`). No token/style changes inside the card beyond gating the outer wrapper.

---

##### Provenance only — REVISED 2026-06-15 (device-feedback fix) — SUPERSEDED by the continuous-section fix above

> **Device-test defect (Seth, dev OTA 2026-06-15):** "the live now toggle … is the close to the edge of the screen and it is not styled properly so we know its a drop down." TWO root causes, both **SPEC UNDER-SPEC** (the implementor built faithfully to the prior §4.4-A; the prior contract was wrong):
> 1. **Gutter mismatch.** §4.5 renders `renderLiveSection()` OUTSIDE the `spacing.md`(16)-padded column — on mobile it sits ABOVE `<View style={styles.mobileBody}>` (`home.tsx:844`, body at `:1037`), and on desktop inside `desktopScroll` (`paddingHorizontal: 0`, `:1006`). So the prior `paddingHorizontal: spacing.xs` (4) left the header only 4pt from the edge while every sibling (KPIs, `sectionTitle`, Upcoming rows) is inset 16pt. The header was 12pt closer to each edge than the rest of Home. The prior contract assumed the header lived INSIDE a 16pt-padded column (like `sectionHeaderRow` does) — it does not. **Fix: the header must self-supply the full Home gutter (`spacing.md` = 16), because it is rendered outside the padded column.**
> 2. **No dropdown affordance.** The prior contract rendered a flat label row with a bare 20pt chevron on the bare page background — visually identical to a static section label (`sectionTitle`). The accordion precedent it cited, `BusinessTodoToggle`, actually wraps its header in a **`GlassCard`** (a visible pressable surface) — that card chrome is what signals "this is interactive." The Live-now header had none. **Fix: give the header a contained, pressable control surface modeled on `BusinessTodoToggle` + a clearly-contained chevron affordance + a real press state.**

**Decision — wrap in a `GlassCard`, matching the `BusinessTodoToggle` precedent exactly.** This is the lowest-risk, most house-consistent fix: it reuses the SAME visible-pressable-surface treatment the user already learns from the To-do toggle directly above it on the same screen, it bakes in the Android opaque-glass policy automatically (no manual `Platform.select`), and it makes "this is a dropdown" unambiguous. The header is NO LONGER the bare `sectionHeaderRow` pattern (that was the under-spec).

Rendered inline in `home.tsx` (not a separate file — a few rows of JSX). Structure mirrors `BusinessTodoToggle.tsx:77-94`: an outer `GlassCard` (the surface) whose only child is the header `Pressable`.

- **Outer surface** (`liveSection` GlassCard): `<GlassCard variant="base" padding={spacing.md}>` (NOT `elevated` — `base` = radius `lg`(16) + softer chrome, lighter than the `elevated` LiveOfferingCard below it, so the header reads as chrome and the card reads as content). `variant="base"` default radius is `lg` (16). The GlassCard's internal `GlassChrome` enforces `ANDROID_GLASS_USES_OPAQUE_FALLBACK` automatically — no manual Android fill needed. **This GlassCard provides the inner content padding (`spacing.md`/16); the OUTER section spacing/gutter is supplied by the wrapper `View` below.**
- **Gutter wrapper** (`liveSection` — the `View` wrapping the GlassCard): `paddingHorizontal: spacing.md` (16), `marginBottom: spacing.md` (16). **This is the load-bearing gutter fix** — `spacing.md` (16) is the exact Home page gutter used by `barWrap` (`:984`), `todoWrap` (`:990`), `mobileBody` (`:1037`), and `scroll` (`:994`). Now the GlassCard's left/right edges line up flush with the To-do toggle above it and the KPI/Upcoming column below it. Replaces the prior `liveSection { marginBottom: spacing.md }` (which had no horizontal padding). NOTE: because the gutter now lives on this wrapper, the live **carousel** (§4.4-D) and the **single full-width card** also become inset 16/16 automatically — which is the correct, consistent result (the card edges already aligned with `mobileBody`'s 16 on mobile; on desktop they now gain the gutter they were missing). Re-verify carousel `cardWidth` math in §4.4-D still subtracts `spacing.md * 2` (it does — unchanged).
- **Header row** (`liveHeaderRow`): the `Pressable` (whole row toggles). `flexDirection:'row'`, `alignItems:'center'`, `justifyContent:'space-between'`. NO `paddingHorizontal` (the GlassCard's `padding={spacing.md}` already insets the content; adding more would double-pad). `minHeight: 44` so the touch target is ≥44pt (the visible content is ~24pt tall). Drop the prior `paddingTop`/`paddingBottom: spacing.sm` — the GlassCard padding now owns vertical inset; keep `minHeight:44` to guarantee the target.
- **Left cluster** (`liveHeaderLeft`): `flexDirection:'row'`, `alignItems:'center'`, `gap: spacing.xs` (4).
  - **Live dot:** plain `View`, `width:7,height:7,borderRadius:999,backgroundColor: accent.warm` (`#eb7825`) — same warm as the live-pill family. Static (no pulse — pulse lives on the card's pill; a second pulsing dot is noise). Reduce-motion N/A.
  - **Title** (`liveHeaderTitle`): text `"Live now"`, `typography.bodySm` (14/20), `fontWeight:'700'`, `color: text.primary` (`rgba(255,255,255,0.96)`). Contrast on the glass ≈ 18:1 (PASS AAA). Matches `BusinessTodoToggle`'s `headerTitle` weight/size.
  - **Count chip** (`liveHeaderCount`): rendered ONLY when `liveItems.length > 1`. Text `"· {N}"` (e.g. `"· 2"`). `typography.caption` (12/16) `fontWeight:'600'`, `color: text.secondary` (`rgba(255,255,255,0.72)`), `marginLeft: 2`. Contrast ≈ 13:1 (PASS). Decorative — count folded into the header `accessibilityLabel` (see a11y). Omitted when N===1.
- **Right cluster — the chevron affordance** (`liveHeaderChevron`): the chevron now sits inside a **contained circular affordance** (the explicit "this is a dropdown handle" signal Seth asked for), modeled on a contained icon button:
  - **Container** (`liveHeaderChevron`): `width:28,height:28,borderRadius: radius.full`(999), `alignItems:'center'`, `justifyContent:'center'`, `backgroundColor: glass.tint.profileBase` (the same faint glass tint the LiveOfferingCard progress track uses — token already in use in this file, zero new palette). A subtle filled circle reads as a tappable handle, not a static glyph. The 44pt row `minHeight` still supplies the touch target; this circle is the visual affordance.
  - **Glyph:** `Icon name={collapsed ? "chevD" : "chevU"} size={18} color={text.secondary}` — `chevD` (down) when collapsed = "tap to open", `chevU` (up) when expanded = "tap to close". 18pt glyph centered in the 28pt circle (matches `BusinessTodoToggle`'s `size={18}` chevron exactly). Glyph SWAPS on toggle (no rotation animation — matches `BusinessTodoToggle`; motion in §4.4 motion spec is unchanged).
- **Press feedback** (`liveHeaderRowPressed`): `Pressable` `style={({pressed}) => [styles.liveHeaderRow, pressed && styles.liveHeaderRowPressed]}` with `liveHeaderRowPressed: { opacity: 0.6 }` (unchanged from current; matches house Pressable feedback; no scale). The whole GlassCard surface dims on press, reinforcing "the surface is the button."
- **a11y:** `accessibilityRole="button"`, `accessibilityState={{ expanded: !collapsed }}`, `accessibilityLabel={liveItems.length === 1 ? "Live now, 1 offering, " + (collapsed ? "tap to expand" : "tap to collapse") : \`Live now, ${liveItems.length} offerings, ${collapsed ? "tap to expand" : "tap to collapse"}\`}`. The chevron `Icon` is inert (no `accessibilityRole`; state is announced on the row).

**Exact `home.tsx` style-key deltas the implementor must apply (StyleSheet at `:1124`):**

| Key | BEFORE | AFTER |
|-----|--------|-------|
| `liveSection` | `{ marginBottom: spacing.md }` | `{ paddingHorizontal: spacing.md, marginBottom: spacing.md }` — **the gutter fix** (this `View` wraps the new `GlassCard`). |
| `liveHeaderRow` | `{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.sm, minHeight: 44 }` | `{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', minHeight: 44 }` — drop all padding (GlassCard `padding={spacing.md}` owns inset). |
| `liveHeaderChevron` | (NEW) | `{ width:28, height:28, borderRadius: radius.full, alignItems:'center', justifyContent:'center', backgroundColor: glass.tint.profileBase }`. |
| `liveHeaderRowPressed` | `{ opacity: 0.6 }` | unchanged. |
| `liveHeaderLeft`, `liveHeaderDot`, `liveHeaderTitle`, `liveHeaderCount` | (current) | unchanged. |

**JSX delta (in `renderLiveSection`, `home.tsx:506-542`):** wrap the existing header `Pressable` in `<GlassCard variant="base" padding={spacing.md}>…</GlassCard>`. **`GlassCard` is NOT yet imported in `home.tsx`** (verified — only `LiveOfferingCard`/`BusinessTodoToggle` import it). Add `import { GlassCard } from "../../src/components/ui/GlassCard";` to the `home.tsx` import block (alphabetical, next to `Icon`/`KpiTile`/`Pill` at `:50-52`). `glass.tint.profileBase` and `radius.full` are already imported and in use in this file (`glass.tint.profileBase` at `:1214`, `radius` tokens in the same StyleSheet) — no new design-system import needed. The `<View style={styles.liveSection}>` stays as the OUTER wrapper (now carrying the gutter); the GlassCard goes inside it, wrapping ONLY the header Pressable (the card body — single card or carousel — stays a sibling BELOW the GlassCard, inside `liveSection`, so it is NOT enclosed in the header's glass). Replace the bare `<Icon name=… size={20} …/>` with `<View style={styles.liveHeaderChevron}><Icon name={showLiveOpen ? "chevU" : "chevD"} size={18} color={textTokens.secondary} /></View>`.

#### 4.4-B — `LiveOfferingCard.tsx` (NEW) — the reusable live card

A reusable per-card live component, lifted verbatim (token-for-token) from the inline hero block (`home.tsx:469-535` / mobile `737-802`). The existing hero styles (`heroLiveTagRow`, `heroEventName`, `heroEventDate`, `heroAmountRow`, `heroAmountSold`, `heroAmountGoal`, `progressBarTrack`, `progressBarFill`, `heroStatRow`, `heroStatCell`, `heroStatValue`, `heroStatLabel`, `heroScanAction`, `heroScanActionText`) are MOVED into this component's local `StyleSheet` (they leave `home.tsx`). The scan button gets a contained-button restyle (below) — it is no longer a bare text link.

- **Props:**
  ```ts
  interface LiveOfferingCardProps {
    item: UpcomingItem;
    metrics: LiveCardMetrics;          // { revenueLabel; soldValue; capacityLabel; capacity: number | null; progress: number }
    onScanPress: (id: string) => void;
    width?: number;                    // set by parent in the carousel; undefined ⇒ full-width (single-live)
    testID?: string;
  }
  ```
- **Internal normalization (display only):** the parent owns metric computation (§4.5). The card only needs `name` + `dateLine`: `const name = getEventName(displayEvent.name, "Untitled");` and `const dateLine = formatDraftDateLine(displayEvent);`, where `displayEvent = item.kind === "trip" ? tripToLiveEvent(item.source as Trip) : (item.source as LiveEvent)`. (Trips already adapt cleanly — INVESTIGATE F-8.)
- **Root:** `<GlassCard variant="elevated" padding={spacing.lg} style={width !== undefined ? { width } : undefined} testID={testID}>`. `variant="elevated"` (radius `xl`=24, intensity 34) — same as today's hero. `padding: spacing.lg` (24) — same as today.
- **Anatomy + spacing (top→bottom, all values exact):**

  | Element | Style token / value | Type token | Color token | "Why it's here" |
  |---|---|---|---|---|
  | Live pill row (`liveTagRow`) | `flexDirection:'row'`, `marginBottom: spacing.sm` (8) | — | — | anchors "live" status |
  | `Pill variant="live" livePulse` | content `"Live now"` | (Pill internal) | (Pill `live` tokens) | breathing dot = "happening right now" |
  | Offering name (`offeringName`) | `marginBottom: 2` | `typography.bodySm` (14/20) | `text.secondary` | what is live |
  | Date line (`offeringDate`) | `marginBottom: 4` | `typography.caption` (12/16) | `text.tertiary` | when |
  | Revenue row (`amountRow`) | `flexDirection:'row'`, `alignItems:'baseline'`, `marginBottom: spacing.md` (16) | — | — | the hero number |
  | — revenue value (`amountValue`) | — | `fontSize:32, lineHeight:36, fontWeight:'700', letterSpacing:-0.4` | `text.primary` | money is the headline |
  | — " revenue" suffix (`amountSuffix`) | — | `fontSize:18, lineHeight:22, fontWeight:'500'` | `text.tertiary` | labels the number |
  | Progress track (`progressTrack`) | `height:4`, `borderRadius:999`, `bg: glass.tint.profileBase`, `overflow:'hidden'`, `marginBottom: spacing.md` (16); render ONLY when `metrics.capacity !== null` | — | — | sold-vs-capacity at a glance |
  | Progress fill (`progressFill`) | `height:'100%'`, `width:\`${round(progress*100)}%\``, `borderRadius:999`, `bg: accent.warm` | — | `accent.warm` | fill = how full |
  | Stat row (`statRow`) | `flexDirection:'row'`, `justifyContent:'space-between'` | — | — | supporting metrics |
  | — 3× stat cell (`statCell`) | `flex:1` | value `typography.body` (16/24) `fontWeight:'700'` `text.primary`; label `typography.caption` (12/16) `text.tertiary`, `marginTop:2` | — | sold / capacity / scanned |
  | Scan button (`scanButton`) | see 4.4-C | — | — | the one action |

  Stat cells: **Tickets sold** (`metrics.soldValue`), **Capacity** (`metrics.capacityLabel`), **Scanned** (`"—"` — honest-empty, Constitution #9; NEVER a fabricated number). When `metrics.soldValue === "Unable"` (sales-summary error) the cell shows "Unable" exactly as today — no new error UI.

#### 4.4-C — The Scan button (on EVERY card, all kinds)

Today's `heroScanAction` is a bare orange text+icon link (`alignSelf:'flex-start'`). For ORCH-1143 it becomes a **contained, full-width primary-tinted button** so it reads as the card's clear primary action on every card and is an unambiguous ≥44pt target in a carousel (the bare link was too easy to miss / too small a hit area). It does NOT use the heavy `Button` component (keeps the card self-contained + light); it is a styled `Pressable`.

- **Container** (`scanButton`): `flexDirection:'row'`, `alignItems:'center'`, `justifyContent:'center'`, `gap: spacing.xs` (4), `marginTop: spacing.lg` (24), `height: 44` (exact min target), `borderRadius: radius.md` (12), `backgroundColor: accent.tint` (`rgba(235,120,37,0.28)`), `borderWidth: StyleSheet.hairlineWidth`, `borderColor: accent.border` (`rgba(235,120,37,0.55)`), `paddingHorizontal: spacing.md` (16). Full card width (no `alignSelf`).
- **Icon:** `Icon name="qr" size={18} color={accent.warm}`.
- **Label** (`scanButtonText`): `"Scan QR codes"`, `typography.buttonMd` (14/20, `fontWeight:'600'`, `letterSpacing:0.2`), `color: accent.warm`. Kind-neutral copy is correct for all three kinds (event/experience/trip) — do NOT vary it. Contrast `#eb7825` on the `0.28` warm tint over the dark glass ≈ 4.7:1 (PASS AA for ≥14pt semibold; the text is ≥14pt 600-weight = "large text" threshold also clears).
- **States:**
  - **enabled (default, ALL platforms incl. web):** as above. The button is NEVER disabled and is NEVER a dead tap — on web it routes to `/event/{id}/scanner`, whose `.web.tsx` renders the ORCH-1099 kind-aware "Scan tickets in the app" EmptyState (verified: coherent end state, no camera, no crash). **Decision: keep the button ENABLED on web** (not greyed) — the web destination is a real, useful screen (kind-aware copy + "Back to {Kind}"), so disabling it would hide a working path. Web parity = enabled button → coherent EmptyState.
  - **press:** `Pressable` `style={({pressed}) => [styles.scanButton, pressed && styles.scanButtonPressed]}` where `scanButtonPressed = { opacity: 0.7 }`. No scale (avoids layout shift in a horizontal scroller).
  - **focus (web keyboard):** rely on RN-web default focus ring; do not suppress `outline`. (The button is a real focusable Pressable.)
  - **loading/empty/disabled:** N/A — the card only mounts for a live item that already has data; there is no per-button async. (Sales metrics loading is handled at the parent; the button itself never waits.)
- **a11y:** `accessibilityRole="button"`, `accessibilityLabel={\`Scan tickets for ${name}\`}` (kind-neutral label; name disambiguates between carousel cards for VoiceOver/TalkBack), `testID="home-live-card-scan-button"`. `onPress={() => onScanPress(item.id)}`. Hit target = 44pt height × full card width (far exceeds the 44pt minimum).
- **Protective comment** (required by §9) sits directly above this button JSX.

#### 4.4-D — Carousel sizing (when `liveItems.length >= 2`)

House style = `ExperienceStopsGalleryTile`'s `ScrollView horizontal showsHorizontalScrollIndicator={false}` with a `contentContainerStyle` gap. Exact sizing:

- **Card width:** `cardWidth = Math.min(Math.round(windowWidth - spacing.md * 2 - PEEK), CARD_MAX)` where:
  - `windowWidth` from `useWindowDimensions()`.
  - `spacing.md * 2` = 32 (the `mobileBody` horizontal padding, 16 each side — the live section lives inside `mobileBody`).
  - `PEEK = 40` — the visible sliver of the next card that signals "swipe for more". On a 390pt-wide iPhone: `390 − 32 − 40 = 318` → clamped by `CARD_MAX`.
  - `CARD_MAX = 360` — keeps the card from over-stretching on wide phones/foldables; on a ≤390pt phone the clamp is inert (318 < 360).
- **Gap between cards:** `spacing.md` (16) via the ScrollView `contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.md }}`. NOTE: because the parent `mobileBody` already pads 16, set the ScrollView itself to bleed by negative-margin OR (cleaner) render the carousel OUTSIDE `lockedZone`'s horizontal padding. **Recommended:** keep the carousel inside the normal padded column; first card's left edge aligns with the page gutter (16), `contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.md }}` (no extra left pad — the parent supplies it). The `PEEK` math above already reserves the right-edge sliver.
- **Snap:** `snapToInterval={cardWidth + spacing.md}`, `snapToAlignment="start"`, `decelerationRate="fast"` — each swipe lands one card cleanly at the gutter, next card peeking. (RN `ScrollView` native snap; works iOS + Android. On web, RN-web honors `snapToInterval` via CSS scroll-snap fallback; if it no-ops on web that is acceptable — free horizontal scroll still works, no dead state.)
- **Single live (`liveItems.length === 1`):** NO ScrollView, NO snap, NO peek. Render one `<LiveOfferingCard />` with `width` UNDEFINED ⇒ full-width (fills the padded column exactly as today's hero does). No carousel chrome whatsoever.
- **`accessibilityLabel` on the ScrollView:** `"Live offerings, swipe horizontally to see more"`. Each card is independently focusable; VoiceOver/TalkBack reads card name + scan button per card.

### 4.5 Component — `mingla-business/app/(tabs)/home.tsx` (MODIFY)

- **Live-state consumption:** replace single-`primaryLiveEvent` consumption with `liveItems` from `upcoming`. Keep `primaryLiveItem`/`primaryLiveEvent` only where still needed for non-card logic (e.g. `showRevenueTile = primaryLiveEvent !== null || hasRevenueData` — keep semantics: "there is a live offering"; change to `upcoming.liveItems.length > 0 || hasRevenueData`).
- **Per-card metrics:** build a `LiveEvent[]` from `liveItems` (trips via `tripToLiveEvent`), feed `useEventSalesSummaries(liveEventViews, currentBrand?.defaultCurrency)`. Compute a `metricsById` map (revenueLabel/soldValue/capacityLabel/capacity/progress) reusing the existing `liveHeroMetrics` logic generalized over the array. Currency = `view.currency ?? currentBrand?.defaultCurrency` (currency-aware; do NOT introduce new `?? "GBP"`).
- **Scan handler (generalize, all kinds):** replace `handleScanPress` (event-only guard) with `handleScanPress(id: string) => router.push(`/event/${id}/scanner` as never)`. Remove the `kind !== "event"` guard. Delete `showScanAction` (the card always shows the button). (F-9, DISC-1143-A.)
- **Accordion + carousel render** (replacing the inline hero at lines 469-535):
  - Read `const collapsed = useLiveSectionCollapseStore(s => s.collapsed); const hasHydrated = useLiveSectionCollapseStore(s => s.hasHydrated);`.
  - **Hydration gate:** until `hasHydrated`, render the section in its default (open) state without animating, to avoid a flash (Constitution #14). Do NOT read `collapsed` for layout decisions before `hasHydrated` is true.
  - Render a header row (when `liveItems.length > 0`): "Live now" + count (`N live` when N>1) + chevron (`chevU` open / `chevD` collapsed), `Pressable` calling `toggle()` wrapped in `LayoutAnimation.configureNext(easeInEaseOut)` (BusinessTodoToggle precedent). `accessibilityRole="button"`, `accessibilityState={{ expanded: !collapsed }}`.
  - When open (`!collapsed` or `!hasHydrated`):
    - If `liveItems.length === 1`: render one `LiveOfferingCard` full-width.
    - If `liveItems.length > 1`: render a horizontal `ScrollView horizontal showsHorizontalScrollIndicator={false}` (ExperienceStopsGalleryTile house style) with one `LiveOfferingCard` per live item (fixed peek width). `accessibilityLabel="Live offerings, swipe horizontally"`.
  - When `liveItems.length === 0`: render NOTHING for the live section (today's KpiTile fallback for the revenue cell stays as-is for the "no live, has revenue" case).
- **Delete the stale comment** at `home.tsx:354-356` (DISC-1143-A) and replace with an accurate one referencing this ORCH (all kinds scannable; route shared).
- **Android:** `LayoutAnimation` requires the `UIManager.setLayoutAnimationEnabledExperimental(true)` guard already present in `BusinessTodoToggle` — replicate it (or hoist to the new card/section).

### 4.5-D — States, motion, accessibility, platform deltas (mingla-designer+claude)

> The buildable design spec for every state + animation + per-platform delta. Implementor builds to these exact triggers/curves/durations.

#### Every interactive state — the live section

| State | Trigger | Visual | Exact values |
|---|---|---|---|
| **loading** (cold start, sales not yet resolved) | `useEventSalesSummaries` pending | Card renders immediately with its live pill + name + date; revenue/sold show their resolved-or-zero values from the existing hook (today the hook returns `"0 sold"` / `formatCurrencyRound(0,…)` until data lands — keep that). NO new skeleton — the existing hero never had one and the values resolve fast. The **accordion section structure does NOT wait on sales** — it gates on `liveItems.length`, which is known synchronously from `upcoming`. | Default-open layout shown the instant `liveItems.length > 0`. |
| **no-revenue ($0)** | live offering, zero orders | Revenue value renders `formatCurrencyRound(0, currency)` (e.g. `"$0"` / `"₦0"` / `"£0"` per the offering's currency) + " revenue"; progress bar at 0% (renders only if capacity known); sold = `"0 sold"` (existing). Scanned = `"—"`. | progressFill `width:'0%'`; no special empty copy — $0 is honest. |
| **populated** | live offering with orders | Hero number = `metrics.revenueLabel`; progress fill `width:\`${round(progress*100)}%\``; sold/capacity populated; Scanned still `"—"`. | as 4.4-B. |
| **header default** | `liveItems.length > 0` | "Live now" (+ "· N" when N>1) + chevron `chevU`; body expanded. | — |
| **header collapsed** | user tapped header / persisted collapsed | Body height → 0 (cards unmounted from layout); chevron `chevD`; "Live now"+count remain so the user knows live work is hidden. | — |
| **header press** | finger down | row `opacity:0.6` while pressed. | — |
| **scan button** (enabled / press / web) | see 4.4-C | — | — |
| **empty (0 live)** | `liveItems.length === 0` | Entire live section (header + body) renders NOTHING. The existing `KpiTile` "Last 7 days" revenue fallback still shows for the "no live but has rev7d" case (unchanged). | section returns `null`. |
| **not hydrated** | `hasHydrated === false` on cold start | Section renders in its **default (open)** state, body visible, NO collapse animation, `collapsed` NOT read for layout. Prevents flash-of-collapsed on a user who had it open (and vice-versa). | gate: `const showOpen = !hasHydrated || !collapsed;` |

#### Motion spec (trigger → curve → duration → property + reduced-motion)

1. **Accordion collapse / expand.** Trigger: header tap (or row-set change). Mechanism: `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` called synchronously *immediately before* `toggle()` — EXACT `BusinessTodoToggle` precedent (`BusinessTodoToggle.tsx:69`). Property: the body block mounts/unmounts → LayoutAnimation tweens the surrounding layout height + opacity. Curve: `easeInEaseOut` preset. Duration: LayoutAnimation default (~300ms) — do NOT override (matches the to-do toggle's feel for cross-component consistency). **Android guard:** the `UIManager.setLayoutAnimationEnabledExperimental(true)` module-top guard from `BusinessTodoToggle.tsx:38-43` MUST be present (in `home.tsx` or hoisted) or Android won't animate.
   - **prefers-reduced-motion:** `LayoutAnimation` is a layout tween, not a transform/opacity flourish, and is the established app pattern; it is acceptable under reduced-motion (no parallax/scale/spring). No special fallback required — the content still simply appears/disappears. (If a reduced-motion gate is trivially available at the call site, skip `configureNext` when reduce-motion is on so the toggle is instant; OPTIONAL, not required for parity with `BusinessTodoToggle`, which does not gate it.)
2. **Live-pill breathing dot.** Trigger: card mounted with `Pill variant="live" livePulse`. Owned entirely inside `Pill` (scale 1.0↔1.4 over 1.5s, already reduce-motion-gated inside `Pill`). The card does NOT add motion. The header live-dot is **static** (no second pulse — avoids two competing pulses on screen).
3. **Chevron flip.** Trigger: collapse toggle. The icon SWAPS glyph (`chevU`↔`chevD`) inside the same LayoutAnimation frame — no separate rotation animation (matches `BusinessTodoToggle`, which swaps glyphs, does not rotate). No reduced-motion concern.
4. **Carousel scroll.** Native momentum + `snapToInterval` snap; no custom animation. Reduced-motion: native scroll honors the OS setting automatically.
5. **Scan-button press.** `opacity:0.7` on press (no scale, no spring) — intentionally minimal so a card in a horizontal scroller doesn't jitter. Reduced-motion: opacity-only press is fine.

#### Accessibility (WCAG AA)

- **Touch targets:** header row `minHeight:44`; scan button `height:44` × full card width. Both ≥44pt. Chevron/Icon glyphs are 18–20pt but inherit the 44pt parent target.
- **Contrast (all on the dark glass surface):** "Live now" title `text.primary` ≈18:1; count chip `text.secondary` ≈13:1; revenue value `text.primary` ≈18:1; stat labels `text.tertiary` ≈7:1; scan label `#eb7825` on warm tint ≈4.7:1 — ALL ≥4.5:1 (the 4.7:1 scan label also clears as ≥14pt/600 large text). PASS.
- **Roles/labels:** header = `button` + `accessibilityState={{expanded}}` + count folded into label (count chip itself decorative); scan button = `button` + per-card name in label; ScrollView = `accessibilityLabel="Live offerings, swipe horizontally to see more"`. Scanned `"—"` reads as "dash"; acceptable (honest-empty). The `GlassCard` has no role (decorative container).
- **Reading order (per card):** Live pill → name → date → revenue → progress → sold/capacity/scanned → Scan button. Matches visual order.
- **Color is never the only signal:** live state = pill TEXT "Live now" + pulsing dot (not color alone); collapse state = chevron glyph direction + `accessibilityState.expanded` (not chevron color).
- **Dynamic Type:** all text uses named `typography` tokens (scale-respecting). The 32pt revenue and 44pt-fixed button heights are the only hard numbers; at the largest accessibility sizes the button label may wrap — acceptable (the row is `justifyContent:'center'`, label can wrap to 2 lines, height grows). No text is clipped (`numberOfLines` is NOT set on the scan label).
- **One-handed reach:** the live section sits high on Home (below the to-do toggle), so the scan button is mid-screen — reachable. Carousel swipe is a horizontal thumb gesture in the comfortable mid zone.

#### Per-platform deltas

| Aspect | iOS | Android | Web (business preview) |
|---|---|---|---|
| **Glass fill** | `GlassChrome` translucent blur stack (intensity 34 for `elevated`), tint `glass.tint.profileElevated`, real blur | `GlassChrome` **opaque fallback** `rgba(20,22,26,0.92)`, `overflow:'hidden'`, NO drop shadow under the rounded fill — already enforced inside `GlassChrome` per `ANDROID_GLASS_USES_OPAQUE_FALLBACK`. Do NOT re-introduce a translucent Android fill in `LiveOfferingCard`. | RN-web renders the `GlassChrome` web path (existing); card chrome already ships on business web today. |
| **Accordion animation** | `LayoutAnimation` easeInEaseOut | Same, BUT requires `setLayoutAnimationEnabledExperimental(true)` guard | RN-web maps `LayoutAnimation` to a no-op/instant; acceptable — toggle still works, just not animated. No crash. |
| **Carousel snap** | native `snapToInterval` | native `snapToInterval` | CSS scroll-snap fallback or free scroll; either is fine (no dead state). |
| **Scan button destination** | native camera scanner (`/event/[id]/scanner` index.tsx; permission flow) | native camera scanner (same) | `/event/[id]/scanner` **`.web.tsx`** → ORCH-1099 kind-aware "Scan tickets in the app" EmptyState + "Back to {Kind}". NOT a dead tap, NOT disabled. |
| **Live-pulse / press opacity** | full | full | honored by RN-web |

#### Build-ready handoff (designer)

- **Tokens used — ALL pre-existing, zero new:** `spacing.{xxs,xs,sm,md,lg}`, `radius.{md,xl,full}`, `typography.{bodySm,caption,body,buttonMd}` + the two raw hero sizes (32/36 revenue, 18/22 suffix) lifted verbatim, `accent.warm`/`accent.tint`/`accent.border`, `text.{primary,secondary,tertiary}`, `glass.tint.profileBase`, `glass.border.profileBase` (the continuous-section divider — same token the `base` GlassCard draws its own perimeter with), `StyleSheet.hairlineWidth`. **No new token proposed.**
- **Continuous-section fix (4.4-A AUTHORITATIVE, 2026-06-15):** the enclosing `GlassCard variant="base"` switches to `padding={0}` and now wraps header + a `glass.border.profileBase` hairline divider + the body in ONE surface; the single-live `LiveOfferingCard` gains a `flat?: boolean` prop to render chrome-less inside that surface (carousel cards stay `variant="elevated"`). Zero new tokens; the only component-API change is the `flat` prop.
- **Components reused:** `GlassCard variant="elevated"` (Android glass policy baked in), `Pill variant="live" livePulse`, `Icon` (`qr`/`chevU`/`chevD` — all confirmed present in `Icon.tsx`). **No new shared component** beyond the spec's `LiveOfferingCard`.
- **Precedents reused:** accordion = `BusinessTodoToggle` (header layout, `LayoutAnimation` easeInEaseOut, chevron glyph-swap, Android guard, `accessibilityState.expanded`); horizontal scroller = `ExperienceStopsGalleryTile` (`ScrollView horizontal showsHorizontalScrollIndicator={false}` + `contentContainerStyle` gap); section header = existing `home.tsx` `sectionHeaderRow`/`sectionTitle`.
- **One restyle introduced (justified):** the scan affordance changes from a bare orange text link (`heroScanAction`) to a contained 44pt warm-tinted button (4.4-C) — needed because in a carousel the bare link was a sub-44pt, easy-to-miss target and the per-card primary action must read as a button. Still token-only (`accent.tint`/`accent.border`/`accent.warm`).

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1 (scan button on every live kind):** For each of event, experience, trip that is live, the live card renders a "Scan QR codes" button. Tapping it navigates to `/event/{id}/scanner`.
  - SC-1-iOS / SC-1-Android: native scanner screen mounts (camera permission flow), kind-aware copy.
  - SC-1-Web: routes to `/event/{id}/scanner` → renders the "Scan tickets in the app" EmptyState (kind-aware noun), NOT a dead tap, no crash.
- **SC-2 (enumerate all live):** When ≥2 offerings are live for the current brand, ALL of them render as cards (count matches `liveItems.length`), sorted live-first by start time ascending.
- **SC-3 (carousel):** With ≥2 live offerings, the cards render in a horizontal `ScrollView` (swipeable), each independently scannable. With exactly 1 live offering, a single full-width card renders (no horizontal scroll required).
- **SC-4 (accordion collapse):** Tapping the live-section header toggles the card(s) hidden/shown with an `easeInEaseOut` animation; the chevron flips `chevU`↔`chevD`; `accessibilityState.expanded` reflects state.
- **SC-5 (persisted collapse + hydration gate):** The collapsed/open choice survives app restart (persisted). On cold start, before hydration completes, the section renders in its default state (no flash of the wrong state); after hydration, it reflects the persisted choice. (Constitution #14.)
- **SC-6 (honest data):** The "Scanned" tile shows "—" (no fabricated count). Per-card revenue uses the offering's currency (or brand default), never a hardcoded symbol introduced by this ORCH.
- **SC-7 (no duplication):** A live offering appears in the carousel only — it is NOT also rendered as an Upcoming-list row below (the Upcoming list renders non-live items; live items are surfaced exclusively in the live carousel). [Confirm current Upcoming-list behavior in IMPLEMENT; if the list already excludes live items, this is a no-op assertion.]
- **SC-8 (logout cascade):** After logout, `liveSectionCollapseStore` is reset (collapsed back to default) via `clearAllStores`. (Constitution #6.)
- **SC-9 (trip live card):** A live TRIP (previously excluded from the hero, DISC-1143-B) now renders a card with name/date/revenue/capacity (via `tripToLiveEvent`) and a working scan button.

---

## 6. Invariants

- **Preserve Constitution #1 (no dead taps):** scan button only emitted because all kinds are scannable (INVESTIGATE A/A/A); on web it routes to a coherent EmptyState. Test: SC-1-Web asserts navigation, not a no-op.
- **Preserve Constitution #2 (one owner per truth):** live-state owned by `upcomingBuilder.liveItems`; `home.tsx` must not re-derive live status. Test: the carousel maps `upcoming.liveItems`, asserted in the home component test.
- **Preserve Constitution #9 (no fabricated data):** "Scanned" stays "—"; revenue currency-aware. Test: card test asserts the Scanned tile text is "—".
- **Preserve Constitution #14 (persisted-state startup gate):** collapse store `hasHydrated`-gated. Test: a store test asserts `hasHydrated` starts false, flips true on rehydrate, and is NOT in the persisted partition.
- **Preserve Constitution #6 (logout clears):** `reset` wired into `clearAllStores`.
- **NEW — `I-PROPOSED-ORCH1143-LIVE-SCAN-ALL-KINDS` (DRAFT):** the business Home live card must render a scan affordance for every live offering regardless of `event_type`, and the scan affordance must route to `/event/{id}/scanner` (the shared kind-agnostic scanner route). Flips ACTIVE on CLOSE (orchestrator owns the flip). Verified by the fails-on-revert test in §9.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy) | 1 live event | `liveItems=[event]` | 1 full-width card, scan button present, tap → `/event/{id}/scanner` | component |
| T2 (happy) | 1 live experience | `liveItems=[experience]` | card + scan button (NOT suppressed) | component |
| T3 (happy) | 1 live trip | `liveItems=[trip]` | card via `tripToLiveEvent`, revenue/capacity shown, scan button present (SC-9, DISC-1143-B) | component |
| T4 (happy) | 3 live (event+experience+trip) | `liveItems=[e,x,t]` | horizontal ScrollView, 3 cards, each scannable, live-first start-ascending order (SC-2,SC-3) | component |
| T5 (edge) | 0 live | `liveItems=[]` | live section renders nothing | component |
| T6 (happy) | toggle accordion | tap header | cards hide; chevron `chevU`→`chevD`; `expanded=false` (SC-4) | component |
| T7 (happy) | persisted collapse | set collapsed=true, remount | section collapsed after hydration; default (open) before hydration (SC-5) | state |
| T8 (edge) | hydration gate | `hasHydrated=false` | NOT in persisted partition; starts false; flips on `onRehydrateStorage` | state |
| T9 (error/web) | web scan tap | tap scan on web | navigates to `/event/{id}/scanner` (web EmptyState), no crash (SC-1-Web) | component (web) |
| T10 (regression) | revert the all-kinds gate | restore `kind === "event"` scan gate | experience/trip cards lose the scan button → test FAILS (§9) | component |
| T11 (logout) | reset cascade | call `clearAllStores` | `liveSectionCollapseStore.collapsed` back to default (SC-8) | state |
| T12 (builder) | `liveItems` field | mixed statuses | `liveItems` = only `status==="live"`, sorted live-first | util |

---

## 8. Implementation order

1. **Util:** add `liveItems` to `upcomingBuilder.buildUpcomingItems` + its return type (§4.1). Add T12 to `upcomingBuilder.test.ts`.
2. **Hook:** thread `liveItems` through `useUpcomingForBrand` interface + return (§4.2).
3. **State:** create `liveSectionCollapseStore.ts` (§4.3), wire `reset` into `clearAllStores`. Add T7/T8/T11.
4. **Component (card):** create `LiveOfferingCard.tsx` (§4.4) lifting the hero block; reuse existing hero styles. Add T1/T2/T3.
5. **Component (home):** rewire `home.tsx` (§4.5) — generalize scan handler, build metrics over `liveItems`, render accordion header + carousel/single, delete stale comment + `showScanAction`. Add T4/T5/T6/T9/T10.
6. Run jest gates (the 4 existing business-web contract gates per memory + the new tests); run the ORCH-1083 `__common` bundle-budget gate locally (web import hygiene — keep per-icon named imports, no barrel imports).

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** the scan affordance is emitted unconditionally inside `LiveOfferingCard` (no per-kind gate), and the home screen maps the carousel off `upcoming.liveItems` (no `kind === "event"` filter).

**Fails-on-revert test (T10):** in `app/(tabs)/__tests__/home.orch_1143.test.tsx`, render `home.tsx` with `useUpcomingForBrand` mocked to return `liveItems = [oneExperience, oneTrip]`. Assert BOTH cards render a `testID="home-live-card-scan-button"`. The implementor MUST verify fails-on-revert: re-introduce the `primaryLiveItem.kind === "event"` gate (or scope the carousel to events) → the experience/trip scan buttons disappear → the test FAILS; restore → PASSES. Document the `sed`-revert proof in the implementation report.

**Protective comment** in `LiveOfferingCard.tsx` and at the home scan handler: `// ORCH-1143 — scan button on EVERY live kind (event/experience/trip). The scan backend (biz_ticket_scan) + /event/[id]/scanner are event-type-agnostic — INVESTIGATE_ORCH-1143 verdict A/A/A. Do NOT re-gate to kind==="event" (regresses experience/trip scan). I-PROPOSED-ORCH1143-LIVE-SCAN-ALL-KINDS.`

---

## 10. Open questions

- **OQ-1 (collapse default):** Default OPEN on first load (recommended — the live card is operationally important; collapse is a user choice that persists). Confirm with Seth or accept the default.
- **OQ-2 (collapse granularity):** Whole-section collapse (recommended, §4.3) vs per-card. SPEC chooses whole-section; flag for the notify-list if Seth wants per-card.
- **OQ-3 (carousel ordering when many live):** SPEC uses the existing live-first **start-time ascending** order (inherited from `compareUpcomingItems`). Alternatives (revenue desc, alphabetical) were raised at INTAKE. Confirm start-ascending is acceptable (it surfaces the longest-running / soonest-started live offering first).
- **OQ-4 (Scanned tile):** Stays "—" (no per-offering scanned count source exists; DISC-1143-C). Confirm Seth is OK leaving it honest-empty rather than wiring a new aggregate (out of scope).

---

## 11. Downstream routing

NEXT = **mingla-designer** (DESIGN: pixel spec for the accordion header + horizontal carousel card sizing/peek + collapse motion + Android glass deltas), embedded back into this SPEC's §4.4/§4.5; THEN **mingla-implementor** (build per allowlist); THEN **mingla-tester** (live-fire the per-kind scan happy path on device + the fails-on-revert T10); THEN **mingla-orchestrator** CLOSE (flip `I-PROPOSED-ORCH1143-LIVE-SCAN-ALL-KINDS` ACTIVE, OTA the business `development`/`production` channel per memory EAS gotchas — pure-JS change, no native build needed). Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1143-[live-card-scan-accordion]/` on branch `ORCH-1143-live-card-scan-accordion`.

---

## Scoped allowlist (implementor may modify ONLY these)

- `mingla-business/src/utils/upcomingBuilder.ts` (add `liveItems`)
- `mingla-business/src/hooks/useUpcomingForBrand.ts` (thread `liveItems`)
- `mingla-business/src/store/liveSectionCollapseStore.ts` (NEW)
- `mingla-business/src/components/home/LiveOfferingCard.tsx` (NEW)
- `mingla-business/app/(tabs)/home.tsx` (rewire live section; generalize scan)
- the `clearAllStores` aggregator file (add the new store's `reset` — locate in IMPLEMENT)
- Tests: `mingla-business/src/utils/__tests__/upcomingBuilder.test.ts` (extend), new `mingla-business/app/(tabs)/__tests__/home.orch_1143.test.tsx`, new store test under `mingla-business/src/store/__tests__/`.

## DO-NOT-TOUCH

- Any `supabase/` file (migrations, edge functions) — no backend change.
- `app/event/[id]/scanner/index.tsx` + `index.web.tsx` — already kind-aware; byte-unchanged.
- `useManagedEventRoute.ts`, `tripToLiveEvent.ts`, `businessEvents.ts` `fetchBusinessEventById` — read-only consumers; do not modify.
- The `?? "GBP"` fallbacks (ORCH-1034 deferred work).
- The Upcoming list component beyond confirming live/non-live partitioning (SC-7).

The implementor must STOP-AND-AMEND (request a SPEC amendment) before touching anything outside the allowlist.
