# SPEC — ORCH-1138 Leg 1C: Consumer Trip Surface → Direction-A Parity

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on `ORCH-1138-trip-page-redesign` (HEAD `d625301fc`). Lands on the SAME branch/PR as Leg 1 so the trip page merges "done on ALL surfaces" (web + business iOS/Android + consumer app).
**Predecessor:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1138_LEG1C_CONSUMER_TRIP_PARITY.md` (read it first — every F-# and Q-# is referenced here).
**Contract, not code.** Snippets ≤3 lines, illustrative only.

---

## 1. Executive summary

The consumer app's trip detail (`ConsumerTripDetailScreen`) renders a bespoke, un-themed body in a gorhom bottom sheet, with a Reserve bar that scrolls off the end of the content. The business/web public trip page already renders the approved Direction-A look via the shared `@mingla/offering-rendering` foundation. This leg brings the consumer surface to **full Direction-A parity** by (a) wiring `@mingla/offering-rendering` into app-mobile, (b) building a data-adapter that maps the consumer trip data + resolved brand theme onto the foundation primitives, (c) re-rendering the consumer trip body via `ParallaxCoverShell` + the shared primitives, and (d) making the "Reserve my spot" CTA **FLOAT/stick to the bottom** of the sheet (Seth's explicit ask) wired to the existing native checkout. No schema or edge change. The look converges by REUSING the shared primitives — `TripPreview` itself is NOT importable across the app boundary (F-6), so the consumer composes the layer below it.

## 2. Scope & non-goals

**In scope:**
1. Add `@mingla/offering-rendering` to app-mobile `metro.config.js` (`extraNodeModules`) + `tsconfig.json` (`paths`) — mirror the `event-rendering` alias exactly (F-1).
2. A consumer **data-adapter** that maps `ConsumerTripDetail` (+ a `ResolvedTheme` from the existing `useEventTheme`, F-3) → the props the foundation primitives expect — honoring COMMS-0009 (never `.from('brands')`).
3. Re-render the populated consumer trip body via `ParallaxCoverShell` + `ChipGroup` + `CountAwareGallery` + `useResponsiveLayout` (native → always single-column immersive) + `offeringSurfaceStyles(palette)`.
4. The **floating reserve bar**: a sticky, brand-accent CTA pinned to the sheet bottom, wired to the existing `runNativeCheckout`/`ExpandedBusinessEventSheet` path (preserve checkout + installment consent verbatim).
5. Every state (loading / error / not-found / sold-out / bookings-closed / no-cover / theme-absent) on the consumer surface.
6. Pre-stage the all-surface-parity invariant as DRAFT.

**Non-goals (explicit):**
- **Do NOT edit the business/web trip page** (`TripPreview.tsx`, `app/t/[…].tsx`, `usePublicTripBySlug.ts`, `TripReserveBar.tsx`, `mapboxStaticImage.ts`). Parity is by CONVERGENCE on the shared primitives, not by editing the business render.
- **Do NOT change the consumer checkout** (`runNativeCheckout`, `ExpandedBusinessEventSheet`, `tripToBusinessEventCard`, `nativeCheckoutFlow.ts`) beyond re-wiring the new floating CTA's `onPress` to the SAME `setReserveSheetVisible(true)` it calls today.
- **Do NOT modify `packages/offering-rendering/*` or `packages/event-rendering/*`** — they already render on native (ParallaxCoverShell native branch). Consume only. (If a primitive genuinely needs a native fix, STOP and amend — see §10 OQ-3.)
- **Do NOT touch the consumer deck card** or `useConsumerTripDetail`'s checkout/bookable logic.
- **NO schema, NO migration, NO edge-function change** — unless the map decision (OQ-1) forces a geo data add; if so, STOP and amend (§10).
- **NO Stripe live charges, NO deploy, NO OTA** (those are CLOSE-phase, owner-gated).

**Assumptions:** `react-native-svg@15.12.1` is present (offering-rendering peer dep satisfied — F-1). The consumer keeps rendering inside `BaseBottomSheet` (the canonical consumer detail container) — this leg does NOT convert it to a full-screen route.

## 3. Cross-Surface Impact Declaration (per-surface)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile` iOS) | ✅ | Trip detail renders Direction-A (parallax cover, brand palette, meta chips, day galleries, route block, refund ladder); Reserve FLOATS at the bottom; tap → existing native checkout | `ConsumerTripDetailScreen.tsx`, new `useConsumerTripFoundation` adapter, new `ConsumerTripReserveBar`, `metro.config.js`, `tsconfig.json` | Manual (consumer composes shared primitives) |
| 2 | Consumer Android (`app-mobile` Android) | ✅ | Same as iOS; opaque Android fills preserved (ANDROID_GLASS_USES_OPAQUE_FALLBACK); floating reserve does NOT freeze scroll | same as #1 | Manual + Android-delta |
| 3 | Buyer/anon Web (`mingla-business` `/t/…`) | ⛔ not-covered | Already Direction-A (Leg 1, shipped) | none | Reason: already done; do not regress |
| 4 | Business iOS | ⛔ not-covered | Already Direction-A (Leg 1) | none | Reason: already done |
| 5 | Business Android | ⛔ not-covered | Already Direction-A (Leg 1) | none | Reason: already done |
| 6 | Admin Web | ⛔ not-covered | No trip surface | none | Reason: N/A |
| 7 | Business Web preview | ⛔ not-covered | Wizard Step-5 LEGACY mode (intentional) | none | Reason: out of scope |

## 4. Layered specification

### 4.1 Build config (F-1)

**`app-mobile/metro.config.js`** — add to `config.resolver.extraNodeModules`, mirroring the `event-rendering` entry verbatim:
```js
"@mingla/offering-rendering": path.join(WORKSPACE_ROOT, "packages", "offering-rendering"),
```
**`app-mobile/tsconfig.json`** — add to `compilerOptions.paths`, mirroring event-rendering:
```json
"@mingla/offering-rendering": ["../packages/offering-rendering"],
"@mingla/offering-rendering/*": ["../packages/offering-rendering/*"],
```
No other build change. Do NOT add a `node_modules/offering-rendering` (packages resolve from `WORKSPACE_ROOT/packages`).

### 4.2 Theme resolution (reuse, F-3 — no new fetch, no schema change)

The consumer trip body must resolve the SAME palette/theme as the business page **via the EXISTING `useEventTheme(card)`** (`app-mobile/src/hooks/useEventTheme.ts`), which reads `business_public_events_view` (anon-granted, COMMS-0009-safe). The screen already builds a `BusinessEventCard` (`tripToBusinessEventCard(detail)`, `ConsumerTripDetailScreen.tsx:328-331`) — feed THAT `card` to `useEventTheme`:
- `const themeQuery = useEventTheme(card);` → `const theme = themeQuery.data ?? resolveTheme(null, null);`
- `const palette = useMemo(() => createThemePalette(theme), [theme]);`
- `const surface = useMemo(() => offeringSurfaceStyles(palette), [palette]);`
- `const boldFamily = boldFontFamily(theme);` (from `@mingla/event-rendering`).
- **Font loading:** app-mobile has NO `useThemeFont` (F: business-only). The IMPLEMENTOR must use the consumer-app's existing themed-font loading path used by the consumer event detail / brand page (find the consumer equivalent of `useThemeFont`; e.g. how `EventCoverMedia`-themed consumer surfaces load `theme.fontFamilyValue` + `boldFontFamily(theme)`). If NO consumer font-loader exists, add a minimal `expo-font` load of `[theme.fontFamilyValue, boldFontFamily(theme)]` local to the screen (the same families business loads). **STOP-and-amend if the bold family will not register** (native bold needs the weighted family loaded — F in Leg 1 R2 fix #1/#2). Theme-absent → `resolveTheme(null,null)` yields the MINGLA default palette (never a crash).

### 4.3 Data-adapter — NEW hook `useConsumerTripFoundation` (or inline `useMemo` in the screen)

Pure mapping `ConsumerTripDetail` + `palette`/`theme` → the foundation render inputs. **Render only real fields (rule 9).** Mapping (authoritative — from the INVESTIGATION Q2 table):

| Foundation input | Source (`ConsumerTripDetail`) | Rule-9 guard |
|---|---|---|
| `coverMediaUrl` / `coverMediaType` | `detail.coverMediaUrl` / `detail.coverMediaType` (`"image"\|"video"\|"gif"\|null`) | null → cover shows the `hueFromId` gradient (EventCoverMedia handles) |
| hero eyebrow (`duration · destination`) | derive duration from `detail.startAt`/`endAt` (port `deriveDuration`, TripPreview.tsx:150-160); `detail.destinationText` | duration null → omit; destination null → omit the `· …` |
| hero title | `detail.title` | always present |
| date meta chip | `formatTripDateRange(detail.startAt, detail.endAt)` (from `@mingla/event-rendering`) | empty → omit chip |
| duration meta chip | derived duration | null → omit |
| seats meta chip | `detail.totalCapacity` + `detail.spotsLeft` (NOTE: consumer has `spotsLeft`, NOT per-tier `ticketsRemaining`) | capacity null → omit; sold-out = `spotsLeft !== null && spotsLeft <= 0` → "Sold out · N of N booked"; else `spotsLeft` present → "N seats left · M max"; else "M max" |
| destination meta chip | `detail.destinationText` | null → omit |
| brand chip | `detail.brandName` (+ `detail.brandVerified`) | brand cover img NOT available on consumer → tile degrades to `palette.accentWash` (rule 9) |
| route block | `detail.departureText` (Leaving from) → `detail.destinationText` (Destination) | render each leg only if its text is non-null; arrow only if BOTH present |
| about | `detail.description` | empty/whitespace → omit section |
| day-by-day | `detail.days[]` → `CountAwareGalleryItem[]` via `day.media.map(m => ({ url: m.url, type: m.type }))` | empty days → omit; a day with 0 media → 0 gallery nodes (CountAwareGallery already does this) |
| what's included / not included | `detail.inclusions.filter(kind)` → `Chip[]` (`{label:item, variant:"yes"\|"no"}`) | empty → omit each section |
| destination map | **DEFER** (see OQ-1) — consumer data has NO lat/lng (F-4) | section omitted by default (rule 9) |
| refund ladder + deadline | `detail.refundPolicy` + `detail.bookingDeadline` / `detail.bookingsClosed` | null → omit; reuse the consumer's existing `RefundPolicyDisplay` OR port the palette-themed `RefundLadder` (OQ-2) |
| pricing / installments | `detail.tiers[]` + `detail.hasPlan` + the existing `planSchedule`/`planTier` projection (already in the screen) | unchanged from today |
| `bookable` | `detail.bookable` | false → reserve renders the non-tappable "Booking unavailable" strip |

**Bold-on-native rule (port from Leg 1 R2 fix #2):** every element the mockup shows bold (title, section headings, brand name, day titles, meta-chip VALUES, route place values) sets `fontFamily: boldFamily` — native ignores `fontWeight` on a loaded custom font.

### 4.4 Component — re-render the populated body via `ParallaxCoverShell`

Replace the populated `detailBody` (`ConsumerTripDetailScreen.tsx:454-838`) with a foundation composition. The screen STILL renders inside `BaseBottomSheet`; the foundation must compose so the gorhom direct-child scroll contract holds (§4.5). Structure (mirror `FoundationTripPreview`, TripPreview.tsx:239-641, but with consumer data + native-only path since `useResponsiveLayout` returns `isDesktop=false` on native — F):

- Mount `ParallaxCoverShell` with: `palette`, `theme`, `coverMediaUrl`/`coverMediaType`, `coverHue={hueFromId(detail.tripId)}`, `entranceAnimationKey={`trip:${detail.tripId}`}`, `muted`/`onToggleMute` (add a `muted` state — default `true`, only show the Mute chip when `coverMediaType==="video"`), `showMute`, `onClose={onBack}`, `onShare={handleShare}` (keep the existing share), `heroEyebrow`, `heroTitle`, `stateBanner`, `safeAreaTop={insets.top}`, `contentBottomInset` (clearance for the floating bar), and the body as `children`.
- **`ScrollComponent`:** ParallaxCoverShell's native branch defaults to RN `ScrollView`. Inside a gorhom sheet that fights the sheet pan (a raw RN ScrollView nested in gorhom is the exact ORCH-1016 trap). The IMPLEMENTOR MUST pass `ScrollComponent={BottomSheetScrollView}` (the gorhom scroll host re-exported from `BaseBottomSheet`) so gorhom owns the single registered scrollable. **This is load-bearing — see §4.5 + OQ-3.**
- Body children = the mapped sections (meta chips → brand chip → route → about → day-by-day → included/excluded → refund/deadline → the existing "HOW YOU PAY" module).
- The chrome (close/share/mute) comes from `OfferingChrome` inside ParallaxCoverShell — **delete the screen's hand-rolled `chrome` close/share Pressables** (lines 352-371) to avoid double chrome.

### 4.5 THE FLOATING RESERVE BAR (Seth's explicit ask, F-7)

The CTA must STICK to the bottom of the sheet (not scroll off). Two candidate mechanisms; the SPEC mandates the **gorhom `stickyFooter` path** (proven by `TicketCartSheet.tsx:731` in the CURRENT BaseBottomSheet — F-7):

- The populated sheet switches from the BARE `{detailBody}{reserveFooter}` two-children pattern to: `BaseBottomSheet scrollMode="scroll"` with `stickyFooter={<ConsumerTripReserveBar … />}` and the foundation body as `children`. BaseBottomSheet then renders `{header?}{flex:1 BottomSheetScrollView body}{footerNode pinned bottom}` as DIRECT children of `<BottomSheet>` (`BaseBottomSheet.tsx:514-573`) — the footer is pinned, the body scrolls, no freeze.
- **CONFLICT WITH PARALLAXCOVERSHELL:** ParallaxCoverShell's native branch wraps cover + Scroll + chrome inside one `nativeHost` View. If passed as `children` to a `stickyFooter` BaseBottomSheet, that `nativeHost` View becomes the single `stickyBody` child — gorhom's `BottomSheetScrollView` would then be NESTED inside ParallaxCoverShell's own ScrollComponent, re-triggering the viewport==content freeze. **RESOLUTION (mandated):** ParallaxCoverShell is given `ScrollComponent={BottomSheetScrollView}` AND the `stickyFooter` is NOT used; instead the floating bar is rendered as a **`position:"absolute"` overlay sibling INSIDE the ParallaxCoverShell body host** (exactly like `TripReserveBar`'s `styles.wrapper { position:"absolute", left:0,right:0,bottom:0 }` — TripReserveBar.tsx:160-166), layered above the scroll via zIndex, with `contentBottomInset` reserving scroll clearance so the last content row clears the bar. This keeps the gorhom scroll as ParallaxCoverShell's single registered scrollable (no nesting, no freeze) AND floats the bar. **The IMPLEMENTOR MUST device-verify scroll is not frozen and the bar floats on BOTH the in-app overlay path and the cold deep-link route (OQ-3).** If the absolute-overlay approach fails device verification, the fallback is the `stickyFooter` path with ParallaxCoverShell's body restructured — STOP and amend.
- **New component `ConsumerTripReserveBar`** (app-mobile, in `src/screens/Trip/` or `src/components/offering/`): props `{ tappable, label, priceLabel, kicker, palette, onPress, unavailable? }`. Visual contract = mirror `TripReserveBar` (brand-accent fill, kicker + price left, "Reserve my spot →" right, safe-area-inset bottom, Android opaque/no-shadow per ANDROID_GLASS_USES_OPAQUE_FALLBACK, non-tappable info strip for unavailable). It is a consumer-local component (TripReserveBar is business-local, F-6 — cannot import). Reuse `CtaState` typing from `@mingla/event-rendering` if convenient, else a small local prop set.
- **Wiring (preserve checkout verbatim):** `onPress` → the SAME `setReserveSheetVisible(true)` the screen calls today (line 899). Disabled/closed → `reserveDisabled = closed` (existing). `detail.bookable === false` → render the "Booking unavailable" strip (existing copy). The price label + the "{deposit} today" plan-aware label + the `paymentPlanChoice`/`dueTodayCents` threading into `ExpandedBusinessEventSheet` (lines 875-963) are UNCHANGED — the new bar consumes the same computed labels. The DISC-1130-A consumer installment-consent path stays exactly as today (`paymentPlanChoice={detail.hasPlan ? paymentPlanChoice : undefined}`).

### 4.6 States (every one — §5 maps to these)

| State | Trigger | Render |
|---|---|---|
| Loading (cold) | `isLoading && detail===null` | keep the existing `scrollMode="view"` short state body (NOT the foundation) — unchanged |
| Error | `isError && detail===null` | existing error state body — unchanged |
| Not found | `detail===null` | existing not-found body — unchanged |
| Populated | `detail!==null` | foundation render (§4.4) + floating bar (§4.5) |
| Theme absent | `useEventTheme` returns default / errors | `resolveTheme(null,null)` → MINGLA default palette; page still renders fully |
| No cover | `coverMediaUrl===null` | EventCoverMedia renders the `hueFromId` gradient; parallax still works |
| Sold out | `spotsLeft!==null && spotsLeft<=0` | seats chip "Sold out · N of N booked"; floating bar → unavailable/closed per existing gating |
| Bookings closed | `detail.bookingsClosed \|\| past deadline` | closed band (existing copy) + bar shows "Bookings closed" disabled |
| Booking unavailable (paid, can't charge) | `detail.bookable===false` | bar → non-tappable "Booking unavailable" strip (existing copy) |

## 5. Success criteria (observable, testable; per-surface where manual)

- **SC-1** — `@mingla/offering-rendering` resolves in app-mobile: a test imports `ParallaxCoverShell` from `@mingla/offering-rendering` and it is defined; `metro.config.js` + `tsconfig.json` both contain the alias.
- **SC-2-iOS / SC-2-Android** — opening a brand trip from the deck shows: an immersive parallax cover, brand-palette body (NOT hardcoded `#FF6B35`), meta chips reading real columns, leaving-from→destination route block, day galleries, refund ladder. No raw `#FF6B35`/`#eb7825` literals remain in the populated foundation body.
- **SC-3** — the trip palette equals the business page's palette for the same trip (both resolve via the brand theme columns; visual + the same `createThemePalette(theme)`).
- **SC-4-iOS / SC-4-Android** — the "Reserve my spot" CTA is PINNED to the sheet bottom (floats; does NOT scroll off) AND the body still scrolls freely to the last row; pan-down still dismisses the sheet. (Device-verified — OQ-3.)
- **SC-5** — tapping the floating Reserve opens `ExpandedBusinessEventSheet` and a test booking reaches `runNativeCheckout` with the correct `lines`; a plan trip forwards `paymentPlanChoice`; behavior is byte-identical to today's checkout.
- **SC-6** — every state in §4.6 renders without crash; sold-out/closed/unavailable show the correct disabled bar; theme-absent falls back to the MINGLA default palette.
- **SC-7** — bold text (title, headings, brand name, day titles, chip values, route values) renders bold on native (the weighted `boldFamily` is loaded + applied).
- **SC-8** — rule 9: a trip with no description / no days / no inclusions / no refund policy / no cover renders ZERO nodes for those sections (no empty frames), and the map section is absent (no fabricated tile).

## 6. Invariants

- **I-ANON-BRANDS-VIA-DEFINER-VIEW / COMMS-0009** — preserved: theme/brand resolve via `useEventTheme` → `business_public_events_view`; NO `.from('brands')` added. Test: grep the new adapter for `.from("brands")` → must be absent.
- **I-MOR-0827-PACKAGE-ISOLATION** — preserved: no `mingla-business/src/*` import in app-mobile; reuse only `@mingla/offering-rendering` + `@mingla/event-rendering`. Test: grep new files for `mingla-business`.
- **ORCH-1016 / ORCH-1043 sheet-scroll invariants** — preserved: the gorhom scroll stays the single registered scrollable (ParallaxCoverShell uses `BottomSheetScrollView`); no nested raw ScrollView; scroll not frozen. The obsolete `R1f-3` guard (no-stickyFooter) is RETARGETED (§9).
- **ANDROID_GLASS_USES_OPAQUE_FALLBACK** — preserved: `ConsumerTripReserveBar` + foundation surfaces use opaque Android fills, no shadow under rounded fills.
- **Constitution rule 9** — preserved (SC-8).
- **I-PROPOSED-TRIP-PAGE-SHARED-FOUNDATION-ALL-SURFACES (DRAFT)** — NEW: the public trip page renders via `@mingla/offering-rendering`'s `ParallaxCoverShell` on web (`mingla-business` `/t/`), business native, AND consumer native (`ConsumerTripDetailScreen`). Flips ACTIVE on CLOSE (orchestrator owns the flip). Test: each of the three call sites imports `ParallaxCoverShell` from `@mingla/offering-rendering`.

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T1 happy | alias resolves | import `ParallaxCoverShell` from `@mingla/offering-rendering` in a jest test | defined; config files contain alias | build/static |
| T2 happy | populated render | a themed paid trip | parallax cover + palette body + chips + route + galleries + refund | component |
| T3 happy | floating reserve | populated trip, scroll to bottom | CTA stays pinned; last row reachable; pan-down dismisses | runtime (device) |
| T4 happy | checkout | tap Reserve | `ExpandedBusinessEventSheet` opens → `runNativeCheckout` lines correct | integration |
| T5 edge | plan trip | `hasPlan`, choice=installments | bar shows "{deposit} today"; `paymentPlanChoice` forwarded | component+integration |
| T6 edge | theme absent | trip whose brand set no theme | MINGLA default palette; no crash | component |
| T7 edge | no cover / no days / no refund | sparse trip | gradient cover; sections omitted; map absent | component (rule 9) |
| T8 error | sold out / closed / unavailable | `spotsLeft<=0` / `bookingsClosed` / `bookable=false` | correct disabled bar copy; no dead tap | component |
| T9 error | scroll-freeze regression | tall trip body | `maxScroll>0` (body scrolls); footer pinned | runtime (device) |
| T10 invariant | anon-brands | grep adapter | no `.from("brands")`; no `mingla-business` import | static |

## 8. Implementation order

1. **Build config** — add the offering-rendering alias to `metro.config.js` + `tsconfig.json` (§4.1). Restart Metro; confirm a trivial import resolves.
2. **Theme + adapter** — wire `useEventTheme(card)` + `createThemePalette` + `offeringSurfaceStyles` + `boldFamily` + the consumer font load (§4.2); build the data-adapter mapping (§4.3).
3. **Foundation body** — replace the populated `detailBody` with the `ParallaxCoverShell` composition (§4.4); pass `ScrollComponent={BottomSheetScrollView}`; remove the hand-rolled chrome.
4. **Floating reserve** — build `ConsumerTripReserveBar`; render it as the absolute overlay inside the shell body; wire `onPress`→existing `setReserveSheetVisible(true)`; reserve `contentBottomInset` clearance (§4.5).
5. **States** — keep loading/error/not-found as-is; verify every populated state (§4.6).
6. **Device-verify** the floating bar + scroll (OQ-3) on iOS sim + (if reachable) Android; then physical-device proof is a TEST-phase deliverable.
7. **Tests + retargets** — add T1-T10; retarget the `R1f-3` guard (§9).

## 9. Regression prevention (fails-on-revert)

- **Structural safeguard:** a jest test `orch_1138_consumer_trip_foundation.test.ts` asserting (a) `ConsumerTripDetailScreen.tsx` imports `ParallaxCoverShell` from `@mingla/offering-rendering`, (b) the populated body has NO literal `#FF6B35` accent, (c) the adapter has no `.from("brands")` and no `mingla-business` import, (d) the floating reserve renders with `position:"absolute"` (or via `stickyFooter` if OQ-3 forces it). This test FAILS when the foundation change is reverted (the import + the absolute-bar disappear) and PASSES when restored.
- **Scroll safeguard:** retarget `orch_1016_consumer_trip_detail.rework_sheet.test.tsx` R1f-3 — it currently asserts NO `stickyFooter`. Replace with an assertion of the NEW proven shape (ParallaxCoverShell + `ScrollComponent={BottomSheetScrollView}` + absolute floating bar), so the scroll-freeze contract is still guarded under the new structure. Add a protective comment citing this SPEC + the ORCH-1016/1043 freeze history.
- The existing `i-bottomsheet-inline-scroll-binding.mjs` + `orch-1043-sheet-scroll-viewport-check.mjs` strict-greps remain authoritative; the new structure must satisfy them (gorhom scrollable is the single registered scrollable as a direct/proper child).

## 10. Open questions (need Seth / a decision before or during IMPLEMENT)

- **OQ-1 (map on consumer) — DECISION NEEDED.** The consumer trip data carries NO destination lat/lng (F-4) AND app-mobile does not wire the Mapbox token into `expoConfig.extra` (F-5 — the dispatch's "already exposes" is inaccurate). Options: **(A) DEFER** the "Where you'll be" map on consumer this leg (fail-safe to no section, rule 9) — RECOMMENDED, keeps the leg schema-free; **(B) full parity now** = add geo columns to the consumer hook's `events` select (the geo lives in `events.theme.business_trip` JSON, anon-readable since the consumer already reads `events` directly — so likely NO migration, just widen the select + map it) PLUS share `mapboxStaticImage` to a package (or duplicate the pure util into app-mobile) PLUS wire `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` into `app-mobile/app.config.ts` `extra` + the EAS build env. If Seth wants the map, this is a small but real add — flag at amend time.
- **OQ-2 (refund ladder styling).** The business FOUNDATION renders a bespoke palette-themed `RefundLadder`; the consumer today uses the shared `RefundPolicyDisplay` (hardcoded warm-orange). For full visual parity the consumer should render a palette-themed ladder. Decision: port a palette-themed ladder into the consumer (more parity, more code) vs keep `RefundPolicyDisplay` (less parity). RECOMMEND porting a small palette-themed ladder for parity; confirm.
- **OQ-3 (floating-bar mechanism — device-decided).** §4.5 mandates the absolute-overlay-inside-shell approach (no scroll nesting). This MUST be device-verified for no scroll-freeze on BOTH the in-app overlay and the cold deep-link route. If it freezes, fall back to the `stickyFooter` path with ParallaxCoverShell's body restructured — that is a SPEC amendment (the implementor STOPS and amends, does not silently widen). This is the one runtime unknown (the only `probable`, not `proven`, item).
- **OQ-4 (foundation native fix).** If ParallaxCoverShell's native branch needs ANY change to host the gorhom scroll / absolute bar cleanly, that edits a SHARED package consumed by the business page → STOP and amend (it could regress business native). Prefer composing around the primitive.

## 11. Downstream routing

NEXT = **mingla-implementor (app-mobile / consumer side)**. Inputs: this SPEC + `INVESTIGATION_ORCH-1138_LEG1C_CONSUMER_TRIP_PARITY.md`; worktree `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on `ORCH-1138-trip-page-redesign`. Hard constraints: reuse the shared primitives (NOT TripPreview); do NOT edit the business/web trip page or the consumer checkout; no schema/edge change unless OQ-1(B) is chosen (then amend); honor COMMS-0009 + I-MOR-0827 + the ORCH-1016/1043 scroll invariants + ANDROID_GLASS_USES_OPAQUE_FALLBACK + rule 9; device-verify the floating bar (OQ-3). Output: implementation report `IMPLEMENTATION_ORCH-1138_LEG1C_CONSUMER_TRIP_PARITY.md`. THEN → **mingla-tester** (device proof of SC-2/3/4/5 on iOS + Android, esp. the floating-bar scroll-freeze) → **mingla-orchestrator** CLOSE (flip the DRAFT all-surface invariant; this merges on the SAME Leg-1 PR).

### Scoped allowlist (implementor may modify ONLY these)
- `app-mobile/metro.config.js`
- `app-mobile/tsconfig.json`
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`
- a NEW consumer adapter (e.g. `app-mobile/src/hooks/useConsumerTripFoundation.ts`) — or an inline `useMemo` in the screen
- a NEW `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` (or under `src/screens/Trip/`)
- a NEW palette-themed refund ladder for consumer IF OQ-2 = port (small, app-local)
- `app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx` (retarget R1f-3 only)
- NEW test `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts`
- IF OQ-1(B): `app-mobile/src/hooks/useConsumerTripDetail.ts` (widen the events select + map geo), `app-mobile/app.config.ts` (mapbox token into `extra`), and a shared/duplicated `mapboxStaticImage` — ONLY after Seth approves OQ-1(B) via amend.

### DO-NOT-TOUCH
- `mingla-business/src/components/trip/TripPreview.tsx`, `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`, `mingla-business/src/hooks/usePublicTripBySlug.ts`, `mingla-business/src/components/trip/TripReserveBar.tsx`, `mingla-business/src/utils/mapboxStaticImage.ts` (the entire business/web trip page).
- `packages/offering-rendering/*` and `packages/event-rendering/*` (consume only; native edits → amend per OQ-4).
- `app-mobile/src/payments/nativeCheckoutFlow.ts`, `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`, `tripToBusinessEventCard` logic, the consumer deck card, `useConsumerTripDetail`'s bookable/checkout logic (unless OQ-1(B) widens the select only).
- Any migration / edge function (unless OQ-1(B), via amend).
