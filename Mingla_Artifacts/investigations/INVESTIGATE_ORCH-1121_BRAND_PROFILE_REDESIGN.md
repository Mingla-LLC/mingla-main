# INVESTIGATION — ORCH-1121 [Business brand-profile redesign: cover/avatar/about hero + wire Recent Events to real data]

- **Severity/type:** S2-medium / design-debt + ux + bug
- **Affected surfaces (IN SCOPE):** Business iOS, Business Android — the owner's OWN brand profile only.
- **Explicitly OUT OF SCOPE (Seth):** shared public `PublicBrandPage` (`/b/{slug}` buyer-web + consumer app). Not investigated, not to be changed; divergence noted in Scope Guards.
- **Single target file:** `mingla-business/src/components/brand/BrandProfileView.tsx`
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1121-[brand-profile-redesign]/` on branch `ORCH-1121-brand-profile-redesign` (rebased on origin/main).
- **Confidence:** Issue A `probable` (source-conclusive static-style crop; sim populated-brand state blocked on login). Issue B `proven` (source-conclusive — hardcoded JSX, zero data wiring; no runtime needed). Mode: source forensics, both defects deterministic in source.

---

## 1. Symptom (expected vs actual)

**Issue A — cover/avatar/about hero (Seth, verbatim):** "Redesign the cover section which has the cover, profile photo, and about us section on the brand page. The cover is cropped and that section looks awkward."
- Expected: the brand cover image reads as a cover (respects its shape/aspect), avatar + name + about read as a coherent hero.
- Actual: the cover is force-cropped into a thin fixed 140px band regardless of aspect ratio, with a hard `overflow:hidden` clip and `cover` image fit; the 84×84 avatar is yanked up 42px to half-overlap that band; the "about us"/bio sits below. The composition looks awkward.

**Issue B — "Recent events" lies (Seth, verbatim):** the section says "Events you create will show here" with a "Create your first event" button EVEN WHEN the brand has real events (including past events).
- Expected: "Recent events" lists this brand's most-recent events, INCLUDING past events.
- Actual: a HARDCODED empty state renders unconditionally. There is no events query, no list, no conditional — the lying empty CTA shows 100% of the time, for every brand, regardless of how many events exist. This is the higher-severity defect (Constitution #9 — no lying empty-state).

---

## 2. Reproduction

- **Issue B (source-deterministic, no runtime needed):** open ANY brand profile in the business app (`/brand/{id}`). The "Recent events" section always renders "No events yet / Events you create will show here / Create your first event". There is no code path that renders events, so a brand with 50 events shows the identical empty CTA. Proven by source (F-2 below) with certainty.
- **Issue A (source-deterministic style):** open any brand profile whose brand has a cover image with a non-140px-band aspect ratio. The cover is cropped to the fixed band. Proven by static style (F-1).
- **Runtime status:** the business app (`com.sethogieva.minglabusiness`) IS installed on the booted iPhone 17 Pro sim (`17091E60-…`), but reaching a populated, authenticated brand state (cover + ≥1 event) requires a brand-account login — a Seth-only blocker per Prime Directive 9. Runtime screenshot of the awkward hero / lying empty-state was NOT captured; Issue A runtime confidence is therefore capped at `probable`. Issue B does not need runtime — the empty CTA is the only branch in source.

---

## 3. Root cause — Issue A (cover/avatar/about hero)

### F-1 — Cover is hard-cropped to a fixed 140px `overflow:hidden` band with `cover` fit (CONFIRMED ROOT CAUSE, `probable`)

1. **Symptom:** cover image appears as a thin cropped strip, not a cover.
2. **Layer:** code (component + StyleSheet).
3. **Probe:** read `BrandProfileView.tsx` L489–616 (hero JSX) + L818–884 (hero styles).
4. **Evidence (verbatim):**
   - The band style (L822–828):
     ```
     heroCoverBand: { height: 140, width: "100%", overflow: "hidden",
       borderTopLeftRadius: radiusTokens.lg, borderTopRightRadius: radiusTokens.lg },
     ```
   - The image fit — Android `ExpoImage` `contentFit="cover"` (L502), iOS/web `RNImage` `resizeMode="cover"` (L516), filling an absolutely-positioned `heroCoverFill` (L829–835: `position:"absolute", top/left/right/bottom:0`).
   - The hue fallback fills the same 140px band when no media (L521–528).
5. **Mechanism:** a fixed `height:140` + `overflow:"hidden"` + `cover` fit forces every cover image (any aspect ratio) into a 140px-tall letterbox crop. Tall/portrait or text-bearing covers lose most of their content to the clip — the "cropped/awkward" symptom.
6. **Severity:** CONFIRMED ROOT CAUSE (the crop mechanism). `probable` (static style is conclusive; runtime visual not captured).

### Hero composition order (deliverable A.2) — `GlassCard padding={0}` edge-to-edge assumption

`<GlassCard variant="elevated" padding={0}>` (L495) wraps the hero so the cover band reaches the card edges (the `padding={0}` is load-bearing for edge-to-edge). Composition, top → bottom:
1. **Cover band** — `heroCoverBand` (L496–529), 3-state media/hue.
2. **Hero body** — `heroBody` padded `spacing.lg` (L530, style L836–838).
3. **Avatar half-overlap** — `heroAvatarRow` centered with `marginTop:-42` pulls half the 84×84 hero `Avatar` up over the band (L531–537; style L839–843). `Avatar` consumes `brand.photo` (L536).
4. **Name** — `heroName`, centered (L538; style L844–851).
5. **Tagline** — `heroTagline`, rendered only when `brand.tagline` non-empty (L539–541).
6. **Bio / "About us"** — `heroBio` when `hasBio` (L469 derives `hasBio`; render L543–544), ELSE the empty-bio dashed CTA `emptyBioCta` → `handleEmptyBio` → `onEdit` (L546–557).
7. **Socials chip row** — IIFE building contact/social chips, hidden when all empty (L559–614).

### Hero data fields + sources (deliverable A.3)

All hero fields live on the `brand: Brand` prop, sourced by the route `app/brand/[id]/index.tsx` via `useBrand(brandId)` → cache key `brandKeys.detail(brandId)` (`hooks/useBrands.ts`). Fields consumed: `coverMediaUrl` (L254–255), `coverMediaType` (carried on `Brand`, not currently branched in the band — see note), `coverHue` (L525, hue fallback), `photo` (L536, Avatar), `displayName` (L536/L538/TopBar L476), `tagline` (L539), `bio` (L469/L544), `address` (on `Brand`; NOT currently rendered in this hero), plus `contact`/`links` for the social chips (L568–597).

### 3-state cover fallback chain + `coverMediaFailed` flip (deliverable A.4)

`coverMediaUrl` is coerced to string-or-null at L254–255. `coverMediaFailed` state (L256) resets whenever the URL changes (L258–260 `useEffect`). The render branch (L497–528):
1. `coverMediaUrl` present + non-empty + `!coverMediaFailed` → image (Android `ExpoImage`, iOS/web `RNImage`), each with `onError={() => setCoverMediaFailed(true)}` (L503/L517).
2. load fails → `coverMediaFailed` flips true → falls to the hue branch.
3. `coverMediaUrl` null → hue gradient `backgroundColor: hsl(${brand.coverHue}, 60%, 45%)` (L521–528).
The comment (L248–253) states this mirrors `PublicBrandPage.tsx:259-304` verbatim. NOTE: `coverMediaType` is NOT branched here (no still-vs-video distinction); a video cover renders as a static first frame via the image element. Worth flagging for SPEC (out of the reported symptom but adjacent).

### Public-page mirror flag (deliverable A.5)

The hero comment (L489–494, L819–821) and the fallback comment (L248–253) claim this layout mirrors `PublicBrandPage.tsx:259-346`. Those line refs are now STALE — the public page delegates cover/event rendering to sub-components (`PublicBrandPage.tsx` maps models at L55–139; the cover band height/fit is not inline there). **A redesign of THIS business hero will visually diverge from the public page.** Seth explicitly accepts this. DO NOT touch `PublicBrandPage.tsx`.

---

## 4. Root cause — Issue B ("Recent events" lying empty-state)

### F-2 — SECTION E is 100% hardcoded; zero data wiring; lying empty CTA renders unconditionally (CONFIRMED ROOT CAUSE, `proven`)

1. **Symptom:** "Recent events / Events you create will show here / Create your first event" shows even when the brand has real (incl. past) events.
2. **Layer:** code (component) — the truth is "no data layer exists at all".
3. **Probe:** read `BrandProfileView.tsx` L698–716; grep the whole file for any events query/hook/list.
4. **Evidence (verbatim, L698–716):**
   ```
   {/* SECTION E — Recent Events */}
   <View style={styles.sectionHeaderRow}>
     <Text style={styles.sectionTitle}>Recent events</Text>
   </View>
   <GlassCard variant="base" padding={spacing.lg}>
     <Text style={styles.emptyEventsTitle}>No events yet</Text>
     <Text style={styles.emptyEventsBody}>
       Events you create will show here.
     </Text>
     <View style={styles.emptyEventsBtnRow}>
       <Button label="Create your first event" onPress={handleCreateEvent}
         variant="primary" size="md" leadingIcon="plus" />
     </View>
   </GlassCard>
   ```
   The component imports NO events hook — `import { eventOrdersKeys } from "../../hooks/useEventOrders"` is the only event-adjacent import (used only by pull-to-refresh L241), and there is NO `useBusinessEventsForBrand`, no `useQuery`, no `.map`, no conditional anywhere in SECTION E. The empty `<GlassCard>` is the ONLY branch.
5. **Mechanism:** the section was shipped as a static placeholder ("Cycle 3 wedge" — see the prop comment at L186–191 noting `onCreateEvent` "routes to /event/create (the Cycle 3 wedge)"). The real data wiring was never added, so the empty state is structurally unconditional — it cannot reflect reality. Violates Constitution #9 (no lying empty-state).
6. **Severity:** CONFIRMED ROOT CAUSE. `proven` (deterministic in source; no runtime ambiguity possible).

> Note: the `handleCreateEvent`/`onCreateEvent` CTA itself is NOT a dead tap — it routes to `/event/create` (route handler in `app/brand/[id]/index.tsx`; prop doc L186–191). Constitution #1 (no dead tap) is satisfied; the defect is the lying empty CONTEXT, not the button target.

### The CORRECT owner-side events data source (deliverable B.2) — NAMED

**Hook:** `useBusinessEventsForBrand(brandId: string | null)` — `mingla-business/src/hooks/useBusinessEvents.ts` L112–130.
**Service:** `fetchBusinessEventsForBrand(brandId)` — `mingla-business/src/services/businessEvents.ts` L491–546.

Proven properties (verbatim service, L495–499):
```
const { data, error } = await supabase
  .from("business_management_events_view")
  .select(BUSINESS_EVENT_SELECT)
  .eq("brand_id", brandId)
  .order("published_at", { ascending: false, nullsFirst: false });
```
- **(a) Brand-scoped:** `.eq("brand_id", brandId)` (L498). RLS-scoped `business_management_events_view` (`security_invoker=true`, per hook comment L115–117). Hook gates on `isAuthReady && brandId !== null` (L118–119) — anon firing returns `[]`, so auth-readiness is required.
- **(b) Returns PAST events:** NO status filter in the query. The ONLY exclusion is `event_type === 'trip'` (a second probe against `events`, L516–534) — events AND experiences are included; trips are not. Status is surfaced on each `LiveEvent` via `viewStatusToLiveStatus` → `'scheduled' | 'live' | 'cancelled' | 'ended'` (service L273–281). Past = `status==='ended'` and/or the event's date is in the past. The canonical past/upcoming/live derivation already exists: `deriveCardStatus` in `app/(tabs)/hub/eventCardStatus.ts` (routes through `utils/eventLifecycle.ts`, treating `YYYY-MM-DD` as UTC midnight per ORCH-0850; collapses `cancelled → past`). REUSE it — do not re-derive.
- **(c) Fields a compact "recent event" row needs:** all present on `LiveEvent` (`store/liveEventStore.ts`): `id`, `name` (title, L177-ish), `date` (L201), `status` (L160), `coverMediaUrl`/`coverMediaType`/`coverHue` (L225–227), `eventType`. A ready-made compact row component already consumes these: **`OfferingListCard`** (`src/components/offering/OfferingListCard.tsx`) — 76×92 cover thumb, status pill (handles `past`→ENDED + `cancelled` + `draft`), title, date·venue subline, per-kind headcount metric. Its model builder is `offeringListCardModel.ts`.
- **(d) React Query key + invalidation:** key factory `businessEventKeys.list(brandId)` = `["business-events", "list", brandId]` (`useBusinessEvents.ts` L100–110). Invalidated by every event mutation via `writePublishedEventCaches` (L55–98) and pull-to-refresh patterns; `staleTime` 30s (L31).

**Canonical reuse exemplar:** `app/(tabs)/hub/events.tsx` is the existing owner-side events list — `useBusinessEventsForBrand(currentBrand?.id)` (L144) → `deriveCardStatus` buckets (live/upcoming/past/draft, L204–227) → `OfferingListCard`. SECTION E should mirror this exact hook→status→card pattern, parameterized by `brand.id`, sliced to the N most-recent (e.g. 3–5).

### How the screen knows its brand (deliverable B.3)

The component receives `brand: Brand` as a prop (L107/L207). `brand.id` is in scope throughout the populated branch (used by `handleRefresh` L239, `handleEdit` L264, ops rows, etc.). Upstream, the route `app/brand/[id]/index.tsx` reads `useLocalSearchParams<{id}>` → `brandId` (L37–39) → `useBrand(brandId)` → passes the resolved `brand`. So SECTION E can call `useBusinessEventsForBrand(brand.id)` directly (or the route can pass events down — a SPEC choice). Hook ordering: `useBusinessEventsForBrand` must be called unconditionally at the top of the component (alongside `useCurrentBrandRole` L309) with `brand?.id ?? null`, never inside the populated branch, to preserve the ORCH-0710 hook-ordering invariant (the component already has early returns at L421/L440).

### Drafts vs published (deliverable B.4) — RECOMMENDATION (final call deferred to SPEC/Seth)

- `useBusinessEventsForBrand` returns PUBLISHED rows only (scheduled/live/ended/cancelled). DRAFTS come from a SEPARATE source — `useDraftsForBrand` (`hooks/useServerDraftEvents.ts`) + the local `draftEventStore`, exactly as `hub/events.tsx` does (L145, L65).
- **Recommendation:** for "Recent events INCLUDING past", wire SECTION E to PUBLISHED events only (`useBusinessEventsForBrand`), sorted most-recent-first, showing live + upcoming + past. Reasoning: (1) it directly fixes Seth's stated complaint ("there ARE events… including past events"); (2) drafts are not "events that happened" — they are unpublished WIP and already have a home in the Hub; (3) keeps the section single-source and avoids the merge complexity. If Seth wants drafts surfaced here too, that is an additive choice (merge `useDraftsForBrand`), but it widens scope — leave for SPEC/Seth.
- **Genuine empty state:** when `useBusinessEventsForBrand` resolves to `[]` (and, if chosen, no drafts), THEN — and only then — render the existing "No events yet / Create your first event" card. The fix makes the empty CTA conditional on a real empty query, not unconditional.

---

## 5. Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction |
|-------|---------|---------------|
| Docs | File header (L1–18) describes SECTION E as a Cycle-3 wedge with a TRANSITIONAL empty CTA; prop doc L186–191 confirms `onCreateEvent` was meant to retire when Cycle 3 shipped. | Doc admits the placeholder; the data wiring was simply never added. |
| Schema | `business_management_events_view` (RLS, security_invoker) returns all-status brand events incl. ended; `events.event_type` distinguishes trip/experience/event. | No schema gap — the data EXISTS and is queryable; the component just never queries it. THIS GAP (data exists, code ignores it) IS Issue B. |
| Code | SECTION E hardcoded empty (F-2); hero cover hard-cropped at 140px (F-1). | — |
| Runtime | Not captured (populated authed brand state blocked on login). Issue B needs none (single branch). | — |
| Data | `useBusinessEventsForBrand` proven brand-scoped + past-inclusive against the view. | The contradiction Code-vs-Data IS the bug: real rows are reachable; the screen shows "none". |

---

## 6. Blast radius / cross-surface map (Scope Guards — deliverable C)

- **C.1 — empty-events copy elsewhere:** grep `"Events you create will show here" / "No events yet" / "Create your first event"` across `src/` + `app/`:
  - `BrandProfileView.tsx:703–709` — the defect (unconditional). IN SCOPE.
  - `app/(tabs)/hub/events.tsx:612` — LEGITIMATE data-driven empty state (shows only when the filtered list is genuinely empty). NOT a defect. NOT in scope.
  - `app/__styleguide.tsx:554` — styleguide sample. NOT in scope.
  - **Conclusion:** the lying-empty-events defect is UNIQUE to `BrandProfileView.tsx`. No other business-app surface shares it.
- **C.1 — `heroCoverBand` cover-crop layout:** grep `heroCoverBand` → ONLY `BrandProfileView.tsx`. The fixed-140px-band crop layout is UNIQUE to this file. No other surface shares it.
- **C.2 — public page out of scope:** `PublicBrandPage.tsx` is NOT touched by this ORCH (Seth-excluded). Divergence consequence: after the business hero is redesigned, the owner's in-app brand hero will visually differ from the buyer-facing public page (which still uses its own cover/avatar treatment). Seth accepts this divergence. The stale "mirrors PublicBrandPage" comments in `BrandProfileView.tsx` (L248–253, L489–494, L819–821) should be updated/removed by the implementor so future readers don't re-couple them.

---

## 7. Invariant impact (flagged, NOT pre-decided)

- **ORCH-0710 hook-ordering** — any new `useBusinessEventsForBrand` call MUST sit with the other top-level hooks (before the L421/L440 early returns), passing `brand?.id ?? null`. Flagged for SPEC.
- **Constitution #9 (no lying empty-state)** — Issue B is a direct violation; the fix must gate the empty CTA on a real empty query result.
- **Constitution #1 (no dead tap)** — the `Create your first event` CTA already routes live (`onCreateEvent` → `/event/create`); preserve this.
- **Android glass opaque-fallback policy** — any new `GlassCard`/thumbnails in the redesigned hero/events row must honor the opaque-≥0.92 Android fill + `overflow:'hidden'` policy (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`). Flagged for the designer/SPEC.

## 8. Discoveries for Orchestrator

- D-1: `coverMediaType` is on `Brand` but the hero cover band does NOT branch still-vs-video — a video cover renders as a static frame in the business hero. Adjacent to Issue A; the redesign should decide whether to animate (mirror the consumer/event `EventCoverMedia` pattern). Not the reported symptom; flag for SPEC.
- D-2: `brand.address` is carried on `Brand` but NOT rendered anywhere in this hero. The redesign may want to surface it (location line). Flag for designer.
- D-3: stale "mirrors PublicBrandPage.tsx:259-346" comments (line refs no longer valid) — clean up during implement.

---

## 9. Recommended next phase + scope (direction only — NOT a fix)

**Next phase:** SPEC (with an inline `mingla-designer` pass for the hero redesign — this is a UI/UX redesign, so the designer must produce the pixel-precise hero contract).

**Recommended scope direction (for SPEC to formalize, not a design):**
- **Issue A:** redesign the cover/avatar/about hero so the cover no longer hard-crops to a thin fixed band — directions to evaluate (designer's call): aspect-ratio-driven cover height (e.g. 16:9 / fixed ratio rather than fixed px), and a recomposed avatar/name/about block. Keep the 3-state media/hue fallback + `coverMediaFailed` flip. Honor Android glass policy. Business-only; public page untouched.
- **Issue B:** wire SECTION E to `useBusinessEventsForBrand(brand.id)`, reuse `deriveCardStatus` + `OfferingListCard` (mirror `hub/events.tsx`), show the N most-recent including past, and render the existing empty card ONLY when the query genuinely returns empty. Published-only recommended; drafts = open question for Seth.

---

## 10. Open questions for SPEC/Seth

1. **Drafts in "Recent events"?** Recommended: published-only (`useBusinessEventsForBrand`). Confirm, or include drafts (`useDraftsForBrand` merge — widens scope).
2. **How many rows + tap target?** Recommend 3–5 most-recent; each row taps to `/event/{id}` (the Hub's existing event-detail route) or `/trip|/experience` per `eventType`. Confirm count + whether a "See all → Hub" footer link is wanted.
3. **Cover redesign shape:** fixed aspect ratio (e.g. 16:9) vs taller band vs full-bleed? Designer's call within the SPEC; Seth to approve the direction.
4. **Video covers (D-1):** animate the business hero cover (mirror `EventCoverMedia`) or keep static frame? Scope decision.
5. **Surface `brand.address` in the hero (D-2)?** Designer/Seth call.

---

## World Map summary (paste-ready)

ORCH-1121 [Business brand-profile redesign] investigation COMPLETE. Two confirmed defects in the single owner-side file `mingla-business/src/components/brand/BrandProfileView.tsx`, business iOS/Android only (public `PublicBrandPage` Seth-excluded). **(A) Cover hero:** the cover is hard-cropped because `heroCoverBand` is a fixed `height:140` + `overflow:'hidden'` band with `cover` image fit (L822–828, L500/L516); the 84×84 avatar is yanked `marginTop:-42` to half-overlap it — needs a designer-led hero recompose (probable; static-style conclusive, runtime not captured). **(B) Lying "Recent events" — higher severity, PROVEN:** SECTION E (L698–716) is a 100% hardcoded empty-state with ZERO data wiring (no query, no list, no conditional), so "Create your first event" shows even for brands with real/past events — Constitution #9 violation. The correct owner-side source is the existing `useBusinessEventsForBrand(brandId)` hook (service `fetchBusinessEventsForBrand`, key `businessEventKeys.list(brandId)`): brand-scoped via `.eq("brand_id", brandId)`, returns ALL statuses INCLUDING past (`ended`), excludes only trips; reuse `deriveCardStatus` + `OfferingListCard` exactly as `app/(tabs)/hub/events.tsx` does. Both defects are unique to this one file (grep-confirmed). Next: SPEC + inline designer pass. Open: drafts-or-published-only, row count/tap target, cover aspect-ratio shape.
