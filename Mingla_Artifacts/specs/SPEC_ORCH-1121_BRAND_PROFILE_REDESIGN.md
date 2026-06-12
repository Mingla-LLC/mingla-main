# SPEC — ORCH-1121 [Business brand-profile redesign: cover/avatar/about hero + wire Recent Events to real data]

- **Type:** UI redesign + data-wiring bug-fix (S2-medium). Single product file.
- **Surfaces (IN SCOPE):** Business iOS + Business Android ONLY — the owner's OWN brand profile (`/brand/{id}` in `mingla-business`).
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1121-[brand-profile-redesign]/` on branch `ORCH-1121-brand-profile-redesign` (rebased on origin/main).
- **Inputs (read both before building):**
  - `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1121_BRAND_PROFILE_REDESIGN.md` (root causes, named hook, brand-scoping).
  - `Mingla_Artifacts/specs/DESIGN_ORCH-1121_BRAND_PROFILE_REDESIGN.md` (pixel spec — this SPEC binds **Direction 1 only**; ignore Directions 2/3 and PART 7 "Direction deltas").
- **Comms ledger acks (binding on this build):**
  - **COMMS-0024** (WARN) — ORCH-1121 is a legitimately-held number for this lineage; **no renumber**.
  - **COMMS-0021** (WARN) — provider-neutral seller copy lives in `BrandProfileView.tsx` ("Payments & Bank" Operations row + `isBrandPayoutReady` banner logic, L52/L314/L342). **Preserve it verbatim** — this redesign touches the hero (SECTION A) and Recent Events (SECTION E) only; do NOT alter SECTIONS B/C/D.

---

## 1. Executive summary

The business brand-profile screen has two defects in one file (`mingla-business/src/components/brand/BrandProfileView.tsx`):

- **Issue A (cover hero):** the cover image is hard-cropped into a fixed `height:140` `overflow:'hidden'` band with `cover`-fit, and the 84×84 avatar is yanked up `marginTop:-42` to half-overlap it. Tall/wide covers become an awkward thin strip.
- **Issue B (lying Recent Events — higher severity, Constitution #9):** SECTION E is a 100%-hardcoded empty-state ("No events yet / Create your first event") with ZERO data wiring. It renders unconditionally — a brand with 50 events still sees "Create your first event."

This SPEC rebuilds the hero as **Direction 1 — Full-bleed banner** (taller 16:9 cover, baked-in bottom scrim, 96px avatar half-overlapping the seam, centered name/verified/tagline/location, About-us block, centered social chips) and wires SECTION E to real data via the existing `useBusinessEventsForBrand(brand.id)` hook → up to 5 most-recent **published** events (including past), rendered with the existing `OfferingListCard` (manage 3-dot hidden), tap → that offering's detail, with the existing "Create your first event" empty card kept but shown **only** when the query genuinely returns zero events.

`PublicBrandPage.tsx` is explicitly OUT OF SCOPE; the resulting divergence between the in-app hero and the buyer-facing public page is accepted (Seth).

---

## 2. Scope & non-goals

### In scope (single product file + one shared mapper module)
1. `mingla-business/src/components/brand/BrandProfileView.tsx` — SECTION A hero rewrite (Direction 1) + SECTION E data wiring. (allowlisted)
2. `mingla-business/src/components/offering/offeringCardModels.ts` — ADD one pure mapper `liveEventToOfferingModel(event, status)` (no such builder exists today; `tripToOfferingModel` + `experienceToOfferingModel` already live here — this is their canonical home). (allowlisted)
3. `mingla-business/app/brand/[id]/index.tsx` — supply two new navigation props (`onOpenEvent`, `onSeeAllEvents`) to `BrandProfileView`, mirroring the existing `onCreateEvent` prop pattern. (allowlisted)
4. A new co-located jest test for the populated-vs-empty regression (see §7/§9). (allowlisted)

### Non-goals (do NOT do)
- **No `PublicBrandPage.tsx` change** (`packages/brand-rendering/PublicBrandPage.tsx`). Divergence accepted.
- **No drafts in Recent Events.** Published + past only. Do NOT merge `useDraftsForBrand`/`draftEventStore`. (LOCKED — Seth)
- **No new design tokens.** Everything maps to existing `designSystem.ts` tokens.
- **No change to the shared `Avatar` component** (the 84→96 ring is achieved with a wrapper, §4.A.4).
- **No change to SECTIONS B (stats), C (Stripe banner), D (Operations), F (sticky shelf), or the danger zone** — and specifically no edits to the COMMS-0021 provider-neutral copy/logic.
- **No per-row orders fetch.** The Recent-Events rows are a glanceable summary; do NOT add a `useEventOrders` hook per row (see §4.B.5 metric decision).
- **No backend / migration / edge / RLS change.** The data source (`business_management_events_view`) already exists and is queryable.

### Assumptions (verified during SPEC)
- `useBusinessEventsForBrand(brandId)` returns PUBLISHED `LiveEvent[]` (scheduled/live/ended/cancelled), excludes trips, includes past; gates on `isAuthReady && brandId !== null` (returns `[]` otherwise). Verified `useBusinessEvents.ts` L112–130.
- `deriveCardStatus(event)` (`app/(tabs)/hub/eventCardStatus.ts`) returns `EventCardStatus = "live"|"upcoming"|"draft"|"past"` (collapses `cancelled→past`). This is a SUBSET of `OfferingCardStatus = "live"|"upcoming"|"draft"|"past"|"cancelled"` → directly assignable to `OfferingListCardModel.status`. Verified.
- `OfferingListCard` omits the 3-dot manage trigger when `onManageOpen` is `undefined`. Verified `OfferingListCard.tsx` L165.
- `summarizeTicketCapacity(event.tickets)` is a PURE function (no orders hook) yielding `finiteCapacity`. Verified `eventSalesSummary.ts` L36–54.
- Row-tap routing must go through `routeForEventRowDefensive` (`src/utils/routeForEventRow.ts`); a strict-grep gate (`i-proposed-tr2-route-by-event-type.mjs`) BANS hardcoded `router.push(\`/event/${id}\`)` outside the helper. Verified.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | NO | — | none | n/a — different app |
| 2 | Consumer Android (`app-mobile/` Android) | NO | — | none | n/a — different app |
| 3 | Buyer/anon Web | NO | — | none | n/a — `/b/{slug}` is `PublicBrandPage`, explicitly excluded |
| 4 | **Business iOS** | **YES** | Redesigned full-bleed hero (un-cropped cover, 96px ring avatar, centered identity, location, About, centered chips); Recent Events lists ≤5 real most-recent published events incl. past (ENDED pill, faded), "See all" when >5, row tap → detail; empty card only at zero events | `BrandProfileView.tsx`, `offeringCardModels.ts`, `app/brand/[id]/index.tsx` | Shared RN code → iOS/Android render from the same source |
| 5 | **Business Android** | **YES** | Same as iOS, honoring `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (opaque ≥0.92 fills, `overflow:'hidden'`, no Android shadow under rounded fills) | same files | Manual deltas: opaque-Android glass + no-shadow specified per surface in §4.A.6 / §6 |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NO | — | none | unaffected |
| 7 | Business Web preview (adjacent) | NO regression | The hero must not crash on web; `EventCoverMedia` already has the web `<Image>`/`expo-video` path; raw-image web hotfix is removed because ECM owns the per-platform element | same files | Automatic via ECM's existing web path; verify no web build break |

`EventCoverMedia` already abstracts the per-platform image/GIF/video element across web+native, so switching the hero cover from raw `ExpoImage`/`RNImage` to `EventCoverMedia` keeps iOS/Android/web parity automatic (and fixes discovery D-1: video covers now animate).

---

## 4. Layered specification

> Layers touched: **Component** (BrandProfileView), **shared model util** (offeringCardModels), **route file** (prop supply). No DB/edge/service/hook/realtime changes — the hook already exists and is consumed as-is.

### 4.A — SECTION A: the Direction-1 full-bleed hero (rewrite)

Build to DESIGN doc PART 2 (Direction 1) verbatim for visual values. The contract below is the build-step authority; where a value is given here it is binding, otherwise defer to the DESIGN doc's named token.

#### A.1 — Wrapper (unchanged contract)
Keep `<GlassCard variant="elevated" padding={0}>` (L495). The `padding={0}` is load-bearing for the edge-to-edge cover — do NOT change it.

#### A.2 — Cover region (`heroCover`, replaces `heroCoverBand`)
- Compute the cover height from the card inner width:
  - `COVER_H = clamp(176, Math.round(coverWidth * 9 / 16), 240)` (16:9, floor 176 so the avatar overlap never eats the whole cover, ceil 240 for tall screens). `coverWidth` = the hero card's inner width — derive from `useWindowDimensions().width` minus the page horizontal padding (`scroll` style uses `paddingHorizontal: spacing.md` on each side; on a 375pt screen `coverWidth ≈ 343` → `COVER_H ≈ 193`). A `useWindowDimensions` hook is acceptable (add at top-level with the other hooks — see A.7).
- `width:'100%'`, `overflow:'hidden'`, `borderTopLeftRadius`/`borderTopRightRadius: radiusTokens.xl` (24 — matches the elevated card's top corners; UPGRADE from the old `lg`/16).
- **3-state media chain (PRESERVE exactly; only the container + element change):**
  - Keep `coverMediaUrl` coercion (L254–255), `coverMediaFailed` state (L256), and the URL-change reset `useEffect` (L258–260) **unchanged**.
  - **State 1** (`coverMediaUrl` non-null + non-empty + `!coverMediaFailed`): render `<EventCoverMedia>` (`../ui/EventCoverMedia` — already in this app) filling the region:
    `hue={brand.coverHue}`, `mediaUrl={coverMediaUrl}`, `mediaType={brand.coverMediaType ?? null}`, `radius={0}` (parent clips corners), `width="100%"`, `height={COVER_H}`, `videoContentFit="cover"`, `label=""`, `onError={() => setCoverMediaFailed(true)}`, and motion-gated autoplay: `autoplay={!reduceMotion}` / `playbackActive={!reduceMotion}` / `loop` / `muted` (reduce-motion → first frame; see §5). This REMOVES the raw `ExpoImage`/`RNImage` branches (L497–528) and the ORCH-0805-WEB width/height hotfix (ECM owns the element).
  - **State 2** (`coverMediaFailed === true`): hue fallback (same as State 3) — ECM's `onError` flips the flag.
  - **State 3** (`coverMediaUrl === null`): hue fill `backgroundColor: \`hsl(${brand.coverHue}, 60%, 45%)\`` (UNCHANGED token math). Optional `LinearGradient` depth per DESIGN §2.5 — only if `expo-linear-gradient` is already a dependency; otherwise the flat hsl fill is the contract.
- **Scrim (REQUIRED, all media states):** an absolute bottom scrim INSIDE `heroCover`, above the media: `position:'absolute', left:0, right:0, bottom:0, height:'50%'`, `LinearGradient ['rgba(0,0,0,0)','rgba(0,0,0,0.55)']` top→bottom, `pointerEvents:'none'`. If `expo-linear-gradient` is unavailable, the DESIGN-specified flat fallback (`View height '32%' bottom, backgroundColor 'rgba(0,0,0,0.45)'`) is acceptable. Confirm dependency availability before choosing; do not add a new dependency without a stop-and-amend.

#### A.3 — Body region (`heroBody`)
Keep `heroBody` padded but change to `paddingHorizontal: spacing.lg, paddingBottom: spacing.lg` (top padding handled by the avatar overlap). Composition top→bottom:

1. **Avatar ring row** (`heroAvatarRing`, replaces `heroAvatarRow` overlap math): `width:96, height:96, borderRadius:999, alignItems:'center', justifyContent:'center', backgroundColor: canvas.profile (#141113)`, `alignSelf:'center'`, `marginTop:-48` (50% of 96 overlaps the cover seam), `marginBottom: spacing.sm`. Child = the **existing** `<Avatar name={brand.displayName} size="hero" photo={brand.photo} />` (84×84) centered inside → reads as a 6px page-color ring. Do NOT fork `Avatar`.
2. **Name row** (`heroNameRow`): `flexDirection:'row', justifyContent:'center', alignItems:'center', gap: spacing.xs`. Name `<Text style={heroName}>` (existing `heroName` style, `numberOfLines={2}`). Verified badge: render `<Icon name="check" size={16} color={accent.warm} accessibilityRole="image" accessibilityLabel="Verified brand" />` ONLY when `brand.verified === true` (guard the field's existence; if `brand` has no `verified` field, omit the badge entirely — confirm the field on `Brand` before rendering; absence is acceptable, do NOT invent it).
3. **Tagline** (`heroTagline`, existing style): rendered only when `brand.tagline` non-empty (preserve existing guard L539–541), `textAlign:'center'`.
4. **Location row** (`heroLocationRow`, new): rendered only when `brand.address` non-empty (resolves discovery D-2). `flexDirection:'row', justifyContent:'center', alignItems:'center', gap:4, marginTop:4`. `<Icon name="pin" size={13} color={text.tertiary} />` + `<Text style={heroLocation} numberOfLines={1}>` (caption, `text.tertiary`). Confirm an existing `pin`/`mapPin` icon name in `Icon.tsx`; if neither exists, omit the icon and render the text only — do NOT add an icon asset.
5. **Divider** (`heroDivider`, new): rendered only when About OR chips follow. `height: StyleSheet.hairlineWidth, backgroundColor: glass.border.profileBase, marginTop: spacing.md`.
6. **About-us block:**
   - When `hasBio` (existing L469 derivation, keep): eyebrow `<Text style={heroAboutEyebrow}>ABOUT US</Text>` (labelCap, `text.tertiary`, uppercase, `marginTop: spacing.md, marginBottom: spacing.xs`) + body `<Text style={heroAboutBody} numberOfLines={aboutExpanded ? undefined : 4}>{brand.bio}</Text>` (body, `text.secondary`, `textAlign:'left'`). Read-more toggle per A.6.
   - ELSE (no bio): PRESERVE the existing empty-bio dashed CTA verbatim (L546–557 `emptyBioCta`/`emptyBioText` → `handleEmptyBio` → `onEdit`). Unchanged.
7. **Social chips** (existing IIFE L559–614, logic UNCHANGED): only the container style changes — `socialsRow` adds `justifyContent:'center'`; each `socialChip` Pressable adds `hitSlop={{top:6,bottom:6,left:6,right:6}}` (44pt effective; current 36×36 fails the touch-target floor). Keep `marginTop: spacing.md`.

#### A.4 — Avatar upsize 84→96 (no shared-component fork)
Use the ring-container approach in A.3.1. The shared `Avatar` takes no border prop, so the 96px disc in `canvas.profile` color IS the ring + crisp cutout + cover-bleed mask. Do NOT add an `Avatar` size token or border prop.

#### A.5 — `coverMediaType` / video (discovery D-1)
Switching to `EventCoverMedia` (A.2 State 1) makes video/GIF covers animate (motion-gated), resolving D-1. No separate still-vs-video branch in this file.

#### A.6 — Interactive + read-more state
- New local state: `const [aboutExpanded, setAboutExpanded] = useState(false);`.
- Show a "Read more"/"Show less" `<Pressable>` (`heroReadMore`, caption, `accent.warm`, `hitSlop={8}`) ONLY when `brand.bio` is long enough to clip — heuristic `brand.bio.length > 160`. Toggles `aboutExpanded`. `opacity:0.7` on pressed. When ≤160 chars: no clamp, no toggle.
- Social chip press: `opacity:0.7` pressed (existing pattern); `selection` haptic iOS, none Android (preserve existing behavior if present, else no haptic).

#### A.7 — Hook ordering (ORCH-0710 invariant)
Any new hook (`useWindowDimensions`, the events query in §4.B, plus existing `useState` for `aboutExpanded`) MUST be declared at the TOP of the component alongside the existing hooks (before the L421/L440 early returns). The events query passes `brand?.id ?? null` (never a conditional hook). The component already has early returns at L421 (resolving) and L440 (not-found) — every hook must sit above them.

#### A.8 — Comment cleanup (discovery D-3)
Remove/repair the now-false "mirrors PublicBrandPage.tsx:259-346 / :259-304" comments at L248–253, L489–494, L819–821. The business hero intentionally diverges.

### 4.B — SECTION E: Recent Events (rewrite)

#### B.1 — The shared mapper (new, in `offeringCardModels.ts`)
Add a pure exported function mirroring `tripToOfferingModel`/`experienceToOfferingModel`:

```
export function liveEventToOfferingModel(event: LiveEvent, status: OfferingCardStatus): OfferingListCardModel
```

It maps:
- `id: event.id`
- `title: event.name`
- `status` (passed in — derived by the caller via `deriveCardStatus`)
- `subline:` date · venue — reuse `formatDraftDateLine(event)` + ` · ${event.venueName}` when `venueName` non-empty (mirror `EventListCard` L80–96 derivation; LiveEvent shares the draft date fields).
- `coverMediaUrl: event.coverMediaUrl`, `coverMediaType: event.coverMediaType`, `coverHue: event.coverHue`
- `metricLabel: null`, `capacityPct: null`, `revenueLabel: null` — see B.5 (no per-row orders fetch on this glance surface).

(`OfferingCardStatus` accepts the `EventCardStatus` subset directly — no remap needed.)

#### B.2 — Hook + derived list (in BrandProfileView, TOP-LEVEL per A.7)
```
const { data: brandEvents = [], isLoading: eventsLoading, isError: eventsError } =
  useBusinessEventsForBrand(brand?.id ?? null);

const recentEvents = useMemo(() => brandEvents
  .map(e => ({ event: e, status: deriveCardStatus(e) }))   // published only; trips already excluded by the hook
  .sort((a, b) => /* event.date DESC, nulls last */)
  .slice(0, 5), [brandEvents]);
const totalEventCount = brandEvents.length;
```
- Imports to add: `useBusinessEventsForBrand` (`../../hooks/useBusinessEvents`), `deriveCardStatus` (`../../../app/(tabs)/hub/eventCardStatus` — confirm the exact relative path from `src/components/brand/`), `OfferingListCard` (`../offering/OfferingListCard`), `liveEventToOfferingModel` (`../offering/offeringCardModels`), `LiveEvent` type, `routeForEventRowDefensive` (`../../utils/routeForEventRow`).
- **Published + past included** (hook returns scheduled/live/ended/cancelled; do NOT add a status filter). **Most-recent first.** **≤5 rows.**

#### B.3 — Section header (`sectionHeaderRow`, existing style)
- Left: `<Text style={sectionTitle}>Recent events</Text>` (unchanged).
- Right: "See all" — rendered ONLY when `totalEventCount > 5`. `<Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel="See all events" onPress={onSeeAllEvents}>` → `<Text>` caption `accent.warm` "See all" + `<Icon name="chevR" size={14} color={accent.warm} />`. `onSeeAllEvents` is a new prop (§4.C) routing to the Hub events list.

#### B.4 — The rows (`recentEventsList`, new container)
Plain `<View style={{ gap: spacing.sm, marginTop: spacing.sm }}>` (NOT wrapped in an outer GlassCard — each `OfferingListCard` is its own glass card; double-nesting is banned). For each `{event, status}`:
```
<OfferingListCard
  key={event.id}
  kind="event"
  model={liveEventToOfferingModel(event, status)}
  onOpen={() => onOpenEvent(event.id, event.event_type)}
  // onManageOpen OMITTED → hides the 3-dot manage trigger (glance surface)
/>
```
Past events render the built-in **ENDED** pill + faded treatment via `OfferingListCard`'s existing `deriveCardStatus`-driven logic (cancelled→past→ENDED). Do NOT re-implement pills/fading.

#### B.5 — Metric/revenue decision (binding)
Set `metricLabel`, `capacityPct`, `revenueLabel` = `null` in the mapper. Rationale: the Hub's `EventListCard` derives sold/revenue via a per-row `useEventOrders` hook; replicating that here would mount up to 5 network-fetching hooks on a glanceable summary. The brand-profile Recent-Events row is intentionally a title/date/venue/status glance. `OfferingListCard` renders cleanly with all three null (no progress bar, no metric subtext, no revenue strip — verified L136/L149/L183). If Seth later wants live sold counts here, that is an additive follow-on ORCH, not this scope.

#### B.6 — States (truthful enumeration — Constitution #3 no silent failure)
| State | Condition | Render |
|---|---|---|
| **Loading** | `eventsLoading && brandEvents.length === 0` | 1–2 skeleton rows per DESIGN §3.4 (opaque-Android host shape + shimmer block + 2 grey bars; static under reduce-motion). Acceptable minimal alternative: render nothing until settle (staleTime 30s makes cached loads instant). Pick one; do NOT render the empty card during loading. |
| **Error** | `eventsError` | A non-silent inline error card: `GlassCard variant="base" padding={spacing.lg}` → `<Text>` "Couldn't load your events." + a "Tap to retry" `Pressable` that calls the query's `refetch`. MUST NOT show the "No events yet / Create your first event" copy on error (that would lie). (Constitution #3.) |
| **Populated** | `recentEvents.length > 0` | The header + `recentEventsList` rows (B.3/B.4); "See all" iff `totalEventCount > 5`. |
| **Genuinely empty** | `!eventsLoading && !eventsError && brandEvents.length === 0` | The EXISTING empty card verbatim — now CONDITIONAL: `GlassCard variant="base" padding={spacing.lg}` → `emptyEventsTitle` "No events yet" + `emptyEventsBody` "Events you create will show here." + the LIVE `<Button label="Create your first event" onPress={handleCreateEvent} variant="primary" size="md" leadingIcon="plus" />`. Constitution #1 preserved (CTA routes live to `/event/create`); Constitution #9 fixed (only on a real empty result). |

Keep the empty-card copy and CTA label EXACTLY as-is ("Create your first event").

### 4.C — Route file (`app/brand/[id]/index.tsx`)
Add two new props to `BrandProfileView` (and to `BrandProfileViewProps`), mirroring the existing `onCreateEvent` pattern (route file owns `useRouter`; the view never imports it):
- `onOpenEvent: (eventId: string, eventType?: string) => void` — handler builds the destination via the canonical helper and pushes it:
  `const route = routeForEventRowDefensive({ id: eventId, event_type: eventType, status: ... });` then `router.push(route as never);`. **MUST go through `routeForEventRowDefensive`** (strict-grep `route-by-event-type` bans hardcoded `/event/${id}`). Confirm the helper's required `EventRowForRouting` fields and pass them from the row (the view can pass `event.event_type`; if the helper needs `status`, pass the derived status too — adjust `onOpenEvent`'s signature minimally to satisfy the helper, documented in-file).
- `onSeeAllEvents: () => void` — `router.push("/(tabs)/hub/events" as never)` (the canonical owner events list; confirm the exact route string used elsewhere in the app — `app/(tabs)/hub/events.tsx`).

Make both props **required** on the interface (the route file always supplies them) OR optional with a no-op guard if the implementor prefers test ergonomics — SPEC's allowance: required is cleaner; if optional, the view must no-op safely. Do NOT make them silently swallow a real navigation.

---

## 5. Success criteria (observable, testable; per-surface where parity is manual)

- **SC-1 (hero un-cropped):** On Business iOS AND Android, opening `/brand/{id}` for a brand with a real landscape cover shows the cover at ~16:9 (height clamped 176–240), filling the card top edge-to-edge, NOT a thin ≤140px strip. The 96px ring avatar half-overlaps the cover seam.
  - SC-1-iOS / SC-1-Android verified separately on device/sim.
- **SC-2 (hero composition):** Name (+ verified when present), tagline (when present), location (when `brand.address` present), About-us (eyebrow + paragraph, or the dashed empty-bio CTA when no bio), and centered social chips render in that vertical order; no element renders a placeholder when its data is absent.
- **SC-3 (cover fallback preserved):** With no `coverMediaUrl`, the hue gradient fills the 16:9 region; on media load failure (`onError`), it falls back to the hue fill (`coverMediaFailed` flip intact); a video/GIF cover animates (motion-gated).
- **SC-4 (events populate):** For a brand with ≥1 published event (incl. past), Recent Events lists up to 5 most-recent-first `OfferingListCard` rows — NOT the empty card. Past rows show the **ENDED** pill (faded); cancelled→ENDED; live→LIVE; upcoming→UPCOMING.
- **SC-5 (empty only at zero):** For a brand with zero published events (after the query settles), and ONLY then, the "No events yet / Create your first event" card renders, and its CTA navigates to `/event/create`.
- **SC-6 (loading ≠ empty):** While the events query is loading with no cached data, the empty card does NOT show (skeleton or nothing per B.6).
- **SC-7 (error surfaced):** If the events query errors, an inline "Couldn't load your events / Tap to retry" surface shows — NOT the empty CTA and NOT a silent blank. (Constitution #3.)
- **SC-8 (row tap navigates):** Tapping a row navigates to that offering's detail (`/event/{id}` for events, `/experience/{id}` for experiences) via `routeForEventRowDefensive`. Not a dead tap.
- **SC-9 (See all gating):** The "See all" header link appears only when `totalEventCount > 5` and routes to the Hub events list.
- **SC-10 (3-dot hidden):** No manage 3-dot trigger appears on any Recent-Events row.
- **SC-11 (no regression to B/C/D/F):** Stats strip, Stripe banner, Operations rows (incl. COMMS-0021 "Payments & Bank" + payout-ready banner logic), sticky shelf, and danger zone are byte-unchanged in behavior.
- **SC-12 (Android glass):** Every new/changed glass surface (hero card, OfferingListCard rows, empty card, loading skeleton) uses the opaque Android fill `rgba(20,22,26,0.92)` + `overflow:'hidden'` + no Android shadow under rounded fills.
- **SC-13 (a11y):** Social chips have `hitSlop` → ≥44pt effective; "See all"/"Read more" have `hitSlop`; verified badge labeled "Verified brand"; reading order matches visual order.

---

## 6. Invariants

| Invariant | How preserved | Verifying test |
|---|---|---|
| **ORCH-0710 hook-ordering** | `useWindowDimensions` + `useBusinessEventsForBrand(brand?.id ?? null)` + `useState(aboutExpanded)` declared at top, before the L421/L440 early returns; events query brand-scoped via `?? null`, never conditional. | Component renders without a hooks-order warning across null-brand → resolving → populated transitions (test renders all three). |
| **Constitution #9 (no lying empty-state)** | Empty card gated on `!eventsLoading && !eventsError && brandEvents.length === 0`. | §9 regression test: events-present → list renders, empty card absent. |
| **Constitution #1 (no dead tap)** | "Create your first event" → `handleCreateEvent` → `onCreateEvent` (live); row tap → `onOpenEvent` → `routeForEventRowDefensive` push; "See all" → `onSeeAllEvents` push. | Tests assert each handler is invoked / each prop is called with the right id. |
| **Constitution #3 (no silent failure)** | `eventsError` renders an inline retry surface, never a blank or a lie. | Error-state test (§7). |
| **ANDROID_GLASS_USES_OPAQUE_FALLBACK** | New surfaces reuse `GlassCard`/`OfferingListCard` (already opaque-Android) and the skeleton/cover specify opaque fill + clip + no Android shadow. | Manual Android device check (SC-12); ensure no new translucent Android fill or `elevation`/`shadowColor` on rounded fills. |
| **route-by-event-type (strict-grep)** | Row tap routes through `routeForEventRowDefensive`; no hardcoded `/event/${id}` in `BrandProfileView.tsx` or the route handler beyond the helper. | The existing strict-grep gate must stay green. |
| **COMMS-0021 provider-neutral copy** | SECTIONS C/D untouched; `isBrandPayoutReady`/"Payments & Bank" preserved. | SC-11; pinned-copy gate stays green. |

**Proposed new invariant (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip):**
- `I-PROPOSED-1121-RECENT-EVENTS-LIVE-QUERY` — "The business brand-profile Recent-Events section MUST derive its list and its empty-state from a live `useBusinessEventsForBrand` query result; it must never render a hardcoded/unconditional empty-state. The 'Create your first event' card renders only when the settled query returns zero events." Enforced by the §9 regression test.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 (happy, **fails-on-revert**) | Brand with 3 published events | `useBusinessEventsForBrand` mocked → 3 `LiveEvent`s | 3 `OfferingListCard` rows render; "No events yet" / "Create your first event" NOT in the tree | Component |
| T-2 (empty) | Brand with zero events, query settled | mock → `[]`, `isLoading:false` | Empty card renders; CTA present; tapping fires `onCreateEvent` | Component |
| T-3 (loading ≠ empty) | Query loading, no cache | mock → `isLoading:true, data:[]` | Empty card NOT rendered (skeleton or nothing) | Component |
| T-4 (error) | Query error | mock → `isError:true` | Inline "Couldn't load your events" + retry; empty CTA absent | Component |
| T-5 (slice + sort) | Brand with 8 events | mock → 8 with varied dates | Exactly 5 rows, most-recent-first; "See all" rendered (totalCount 8 > 5) | Component |
| T-6 (no See-all ≤5) | Brand with 4 events | mock → 4 | No "See all" link | Component |
| T-7 (past pill) | One past event | mock → 1 with past date | Row shows ENDED pill (via deriveCardStatus→OfferingListCard); faded | Component/integration |
| T-8 (3-dot hidden) | Any populated | mock → ≥1 | No manage trigger in any row (`onManageOpen` omitted) | Component |
| T-9 (row tap routing) | Tap event row + experience row | event_type 'event' then 'experience' | `onOpenEvent` called with correct id+type; route file builds `/event/{id}` resp. `/experience/{id}` via helper | Component + route |
| T-10 (mapper) | `liveEventToOfferingModel` | a `LiveEvent` + status 'past' | Returns model with id/title/subline/cover*/status='past', metric/capacity/revenue all null | Util (pure) |
| T-11 (hero fallback) | No coverMediaUrl | brand.coverMediaUrl null | Hue fill region renders at 16:9, no crash | Component |
| T-12 (B/C/D unchanged) | Render populated brand | full brand | Stats, Stripe banner, "Payments & Bank" row present and unchanged | Component |

---

## 8. Implementation order

1. **Util** — add `liveEventToOfferingModel(event, status)` to `offeringCardModels.ts` (+ T-10).
2. **Route file** — add `onOpenEvent` + `onSeeAllEvents` handlers in `app/brand/[id]/index.tsx`, wire to `routeForEventRowDefensive` / Hub route, pass to `<BrandProfileView>` (mirror `onCreateEvent`).
3. **Component props** — extend `BrandProfileViewProps` with the two new props; destructure them.
4. **Component hooks** — add top-level `useWindowDimensions`, `useBusinessEventsForBrand(brand?.id ?? null)`, `useState(aboutExpanded)`, and the `recentEvents`/`totalEventCount` `useMemo` (above the early returns — A.7).
5. **SECTION A** — rewrite the hero JSX (cover region via `EventCoverMedia` + scrim, ring avatar, name+verified row, tagline, location, divider, About eyebrow+body+read-more, centered chips) + the corresponding StyleSheet keys; preserve the 3-state fallback + `coverMediaFailed`; clean up stale comments (A.8).
6. **SECTION E** — replace the hardcoded empty card with the loading/error/populated/empty branch logic (B.6); rows via `OfferingListCard` + `liveEventToOfferingModel`; header "See all" gating.
7. **Tests** — author T-1…T-12 (co-located, e.g. `src/components/brand/__tests__/BrandProfileView.orch_1121.test.tsx` + util test).
8. **Gates** — run the business-app jest suite, the 4 desktop-web contract gates if touched (not expected), tsc, eslint, and all strict-grep gates (route-by-event-type + any pinned-copy). Prove T-1 fails on revert.

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** the empty-state is now derived from `useBusinessEventsForBrand`; reverting to the hardcoded empty card re-breaks Constitution #9.

**Named test (the one the implementor MUST write):** `T-1` in `src/components/brand/__tests__/BrandProfileView.orch_1121.test.tsx`:
- Render `BrandProfileView` with a non-null `brand` and `useBusinessEventsForBrand` mocked to return **3 published `LiveEvent`s**.
- **Assert:** exactly 3 `OfferingListCard` rows (or 3 row testIDs) are present, AND the strings "No events yet" / "Create your first event" are NOT in the tree.
- **Fails-on-revert proof:** reverting SECTION E to the hardcoded empty card makes this test FAIL (the empty copy reappears and the rows vanish); restoring makes it PASS. The implementor must demonstrate both directions in the implementation report.

**Protective comment (in SECTION E):** `// ORCH-1121 (Constitution #9 / I-PROPOSED-1121-RECENT-EVENTS-LIVE-QUERY): this empty card is gated on a SETTLED, non-error, zero-length live query. Never make it unconditional again — see BrandProfileView.orch_1121.test.tsx (T-1).`

**Adversarial angle for the tester to attack (flag):**
1. The metric/revenue-null decision (B.5) — verify `OfferingListCard` truly renders cleanly with all three null (no empty progress bar, no stray subtext) on device, not just in jest.
2. The `EventCoverMedia` web path — verify the Business Web preview doesn't crash now that the raw `<Image>` web hotfix is removed (surface 7).
3. Loading→empty timing: confirm a brand that genuinely has events does NOT flash "Create your first event" on a cold load before the query settles (B.6 loading state). Drive on device — the false-empty flash is the exact class of bug this ORCH exists to kill.
4. Past-date edge: confirm `deriveCardStatus` (UTC-midnight per ORCH-0850) buckets a same-day US-Eastern event correctly so it isn't mislabeled past/upcoming.
5. Hook-ordering: confirm no React hooks-order warning across the null→resolving→populated brand transitions.

---

## 10. Open questions

None blocking — all decisions are LOCKED (Seth, 2026-06-12): Direction 1; published + past only (no drafts); `OfferingListCard` as-is with 3-dot hidden; ~5 most-recent; "See all" only when >5; empty card only at genuine zero. Two minor implementor-confirm items (not blocking, resolvable in-file without an amendment):
- (a) Whether `Brand` carries a `verified` boolean — render the badge only if it exists; omit otherwise (do NOT invent the field).
- (b) Exact existing icon name for the location pin and the exact Hub-events route string — confirm against the codebase; omit the pin icon if no asset exists.
If either confirmation reveals a missing field/route that changes scope, **stop-and-amend** (do not widen silently).

---

## 11. Downstream routing

- **Next:** `mingla-implementor` (business side), in this worktree, builds from this SPEC + the DESIGN doc (Direction 1 only) + the investigation. Allowlist + do-not-touch below are binding.
- **Then:** `mingla-tester` — device/sim runtime proof of SC-1…SC-13 on Business iOS AND Android (the false-empty flash + un-cropped cover require live-fire, not source-only). Source-only caps at "suspected".
- **Then:** `mingla-orchestrator` REVIEW → CLOSE (flip `I-PROPOSED-1121-RECENT-EVENTS-LIVE-QUERY` to ACTIVE).
- **Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1121-[brand-profile-redesign]/` on branch `ORCH-1121-brand-profile-redesign`.

### Allowlist (implementor MAY change ONLY these)
- `mingla-business/src/components/brand/BrandProfileView.tsx`
- `mingla-business/src/components/offering/offeringCardModels.ts` (add `liveEventToOfferingModel` only)
- `mingla-business/app/brand/[id]/index.tsx` (add the two nav handlers + pass props only)
- New test file(s) under `mingla-business/src/components/brand/__tests__/` (+ a util test for the mapper)

### DO-NOT-TOUCH
- `packages/brand-rendering/PublicBrandPage.tsx` (Seth-excluded)
- `mingla-business/src/components/offering/OfferingListCard.tsx` (use as-is)
- `mingla-business/src/components/ui/Avatar.tsx` (no fork)
- `app/(tabs)/hub/events.tsx`, `EventListCard.tsx`, `eventCardStatus.ts`, `routeForEventRow.ts` (reuse only, no edits)
- SECTIONS B/C/D/F of `BrandProfileView.tsx` incl. all COMMS-0021 provider-neutral payout copy/logic
- `useBusinessEvents.ts`, `businessEvents.ts` service, any migration/edge/RLS

Anything outside the allowlist requires a SPEC amendment (`SPEC_AMENDMENT_ORCH-1121_*.md` or appended in-file) before the implementor touches it.
