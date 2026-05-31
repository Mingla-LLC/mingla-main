# INVESTIGATION — ORCH-1016 [Consumer Discover Trips tab — rename Discover + Likes-style Events/Trips tabs + surface real published trips end-to-end]

> **Mode:** INVESTIGATE only (no solution, no product code).
> **Worktree:** `~/Desktop/mingla-orchs/ORCH-1016-[consumer-discover-trips-tab]/` on branch `ORCH-1016-consumer-discover-trips-tab`.
> **Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`) only.
> **Milestone:** C1 (`Mingla_Artifacts/milestones/C1_CONSUMER_DISCOVER_TRIPS_TAB.md`).
> **Date:** 2026-05-30. **Investigator:** mingla-forensics+claude.
> **Confidence:** HIGH (source read in full + live-DB verified via Supabase MCP on project `gqnoajqerqhnvulmnyvv`). No sim live-fire performed — this is a code+schema+data audit of a not-yet-built feature, not a reproducer-bound runtime bug, so the Prime-Directive-7 sim mandate does not bind. Where a claim is source-only it is labelled `suspected`.

---

## 0. Comms Ledger (read on entry)

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. Relevant rows:

- **COMMS-0014** (WARN → `meta-orch-0980`, re ORCH-1006): the all-in pricing engine is the canonical money path; experience/trip checkout MUST route through `ticket-checkout-create` (same `eventId` contract), NOT a parallel fn. **Directly governs this ORCH's buyer flow.** Factored into Q-E/Q-G findings.
- **COMMS-0013** (WARN, re ORCH-1006): web hosted-Checkout vs native diverge on TAX basis (FEE unified). The consumer app is the NATIVE surface → inherits the venue-based inclusive-tax behavior, not the web divergence. Factored.
- **COMMS-0003** (WARN, ALL): external-API enums/payloads must cite provider docs at SPEC time; Stripe-touching phases invoke `stripe-best-practices`. This INVESTIGATE introduces no new Stripe payloads (reuses existing `ticket-checkout-create` native contract verbatim), so no new doc-citations are owed here — but the SPEC phase must cite if it adds any trip-specific Stripe field.
- **COMMS-0002** (WARN, ALL): the ORCH-0863 strict-grep gate blocks new `supabase/functions/**` + migration files unless allow-listed in the same commit. **If this ORCH adds a new global-trips RPC migration (it almost certainly must — see Q-C), the SPEC + implementor must add the `ORCH_1016_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the same commit.**

Ack: this investigation acked COMMS-0014, COMMS-0013, COMMS-0003 (N/A — no new external-API payload), COMMS-0002 (factored for the SPEC). No new cross-ORCH discovery requiring a new COMMS-NNNN row was found (the `usePublicTripBySlug` anon-brands bug in Q-E is INTERNAL to this ORCH's reuse decision, not a regression in another in-flight ORCH).

---

## 1. Symptom / Goal Summary

This is a **build** dispatch, not a bug. The "expected vs actual" is framed as desired-state vs current-state:

| | Desired (C1) | Current |
|---|---|---|
| Discover title | "Discover" | "Events" (`discover:title` i18n key = "Events") |
| Discover shape | Tabbed: **Events** + **Trips** (Likes-style spotlight pill) | Single surface: 2-col grid of Ticketmaster + business event cards |
| Trips in consumer app | Browsable global feed, filterable, tappable, bookable in-app | NOT surfaced anywhere in a global feed. A brand's trips appear on the consumer brand page, but tapping one **ejects to the web browser** (`WebBrowser.openBrowserAsync('https://business.usemingla.com/t/...')`) |
| Trip detail in consumer app | Native `app-mobile/` page | Does NOT exist (only `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`) |
| Trip checkout in consumer app | In-app native | The native paid-checkout engine EXISTS (`nativeCheckoutFlow.ts` → `ticket-checkout-create`), but no trip surface wires into it |

---

## 2. Investigation Manifest (files read, in trace order)

**Discover render path (Q-A):**
1. `app-mobile/src/components/DiscoverScreen.tsx` (2802 lines — title at L1894, grid at L2071–2098, render switch L2014–2100) — the whole Discover surface
2. `app-mobile/src/i18n/locales/en/discover.json` (L2 `"title":"Events"`) — proves the title string
3. `app-mobile/src/components/discover/BusinessEventCard.tsx` (referenced; card primitive)
4. `app-mobile/src/types/mergedDiscover.ts`, `discoverFilters.ts`, `utils/discoverEventsCache.ts` (data shape + cache contract)

**Likes tab pattern (Q-B):**
5. `app-mobile/src/components/LikesPage.tsx` (454 lines, read in full — the EXACT tab pattern)

**Navigation host (Q-H):**
6. `app-mobile/app/index.tsx` (2771 lines — render switch L2075–2233, overlay pattern L2070/2324, deepLink wiring)
7. `app-mobile/app/_layout.tsx`, `app/b/[slug].tsx`, `app/brand/[slug].tsx` (Expo Router thin re-export pattern)
8. `app-mobile/src/components/GlassBottomNav.tsx` (`BottomNavPage` union L42–46, `TAB_ORDER` L69)

**Consumer trip-surfacing + anon read (Q-C/D):**
9. `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx` (115 lines — the existing brand→trip surface that ejects to web)
10. `app-mobile/src/hooks/useBrandBySlug.ts` (374 lines — anon brand+trip read via `business_public_brands_view` + `pg_public_trips_by_brand` RPC)
11. `supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql` (the canonical anon trips RPC — read in full)
12. `packages/brand-rendering/{types,PublicBrandPage,index}.ts` (shared `PublicBrandTrip` type)

**Business trip detail + buyer flow (Q-E):**
13. `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (326 lines, read in full)
14. `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (buyer-flow entry → `/checkout-trip/{tripEventId}`)
15. `mingla-business/src/hooks/usePublicTripBySlug.ts` (single-trip anon read — **reads `brands` directly; see Q-E finding F-E1**)

**Consumer checkout (Q-G) + signal scoring (Q-F):**
16. `app-mobile/src/payments/nativeCheckoutFlow.ts` (275 lines, read in full — native Stripe → `ticket-checkout-create`)
17. `supabase/functions/_shared/scoringService.ts` (server-side 5-factor place scorer)
18. `supabase/functions/discover-cards/index.ts`, `_shared/signalRankFetch.ts`, `_shared/deckInterleave.ts` (the real "signal scoring" path — server-side, place-pool only)
19. `app-mobile/src/contexts/RecommendationsContext.tsx` (consumer deck feed)

**Live DB (Supabase MCP, project `gqnoajqerqhnvulmnyvv`):** events trip counts, RLS policies + grants on `events`/`event_dates`/`ticket_types`/`trip_*`/`brands`/`tickets`, the 3 published trips' full data, intent-field emptiness.

---

## 3. Findings (per question, classified + evidenced)

### Q-A — Existing Discover surface

**🔵 F-A1 (Observation, HIGH confidence).** The Discover screen is `app-mobile/src/components/DiscoverScreen.tsx` — **NOT** `app-mobile/src/screens/Discover/DiscoverScreen.tsx`. The brief's "Files Touched" hints (`src/screens/Discover/TripsTab.tsx`, `DiscoverScreen.tsx`, `src/components/discover/TripCard.tsx`) describe a directory layout that **does not exist** in this repo. There is one `src/screens/` dir and it contains only `ConsumerBrandProfileScreen.tsx`. The SPEC must correct the file map: the Discover surface lives at `src/components/DiscoverScreen.tsx`, the screen is mounted by a `case "discover":` arm in `app/index.tsx` (L2108–2128), and the tab pattern source is `src/components/LikesPage.tsx`.

**🔴 F-A2 (Root-fact for build, HIGH).** The title rename target. `DiscoverScreen.tsx:1888-1895` renders `<Text style={styles.titleText}>{t("discover:title")}</Text>`. `i18n/locales/en/discover.json:2` resolves `discover:title` → **"Events"**. So the visible title IS "Events" today (the file's header comment saying "Discover" is stale/misleading — F-A3). Renaming to "Discover" is a one-key i18n change PLUS the ~40 locale files each carry `"title"` at line 42 (e.g. `pl/discover.json:42 "Wydarzenia"`). The SPEC must decide: change the EN string only (other locales stay "Events"-equivalent until translated) or all locales.
- File+line: `DiscoverScreen.tsx:1894` + `en/discover.json:2`
- Current: title text = "Events"
- Correct: title text = "Discover"
- Causal chain: i18n key → `<Text>` → header band
- Verification: `grep '"title"' src/i18n/locales/en/discover.json` → `"Events"`

**🔵 F-A3 (Observation).** The brief calls the existing deck a "swipeable card deck." **It is not.** The Discover surface is a **2-column non-swipeable grid** (`styles.gridWrap`, `DiscoverScreen.tsx:2071-2098`) of `<BusinessEventCard>` (Mingla-native events, rendered first) + `<EventGridCard>` (Ticketmaster events). The swipeable deck (`SwipeableCards.tsx`) lives on the **Home** tab (`case "home"` → `<HomePage>`), fed by `RecommendationsContext` + the `discover-cards` edge fn (place-pool cards). The SPEC must say "the existing Discover **grid**" not "swipeable deck," and the regression guard is on the grid + its fetch pipeline, not on `SwipeableCards`.

**What must NOT change (regression surface, Q-A):** The entire Discover fetch/render pipeline must be preserved byte-for-byte under the new **Events** tab:
- The merged-endpoint fetch (`fetchNightOutEvents`, L1321+) + its full-signature in-memory cache (`discoverEventsCache.ts`, ORCH-0996) — the cache key includes city + GPS + date/segment/genre/partyTypes/vibeTags/musicGenres facets; adding a tab MUST NOT perturb this signature.
- City picker (`CityPickerSheet`), filter chips (city/date), the More-filter `BaseBottomSheet`, `ExpandedCardModal` + `ExpandedBusinessEventSheet` tap targets, the RNGH tap-vs-scroll gesture coordination (META-ORCH-0991 Bug 3a), the scroll registry (`useTabScrollRegistry('discover_main')`), the Android opaque-glass fallback (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`).
- `DiscoverScreenProps` is consumed in `app/index.tsx:2110-2127` (deepLinkParams, onOpenChatWithUser, onViewFriendProfile, accountPreferences). Any prop change ripples to the host.

### Q-B — Likes tab pattern (the EXACT pattern to reuse)

**🔵 F-B1 (Observation, HIGH — full interface documented).** `LikesPage.tsx` is the canonical spotlight-pill tab pattern. It is **inline, not a shared component** — there is no `<TabSwitcher>` to import; the pattern must be re-implemented in Discover from this template (or extracted to a shared component as a SPEC decision). Exact contract:

- **Tab model** (L164-167): `TABS: Array<{ id: LikesTab; label: string; icon: IconName }>` — Saved (`bookmark-outline`) + Calendar (`calendar-outline`). For Discover: Events + Trips.
- **State** (L92-97): `activeTab` `useState`, snapshotted from + synced to a Zustand registry (`useAppStore` `likesActiveTab` / `setLikesActiveTab`) so the selection survives tab unmount/remount (ORCH-0679 Wave 2.8.1). Discover would need an analogous `discoverActiveTab` registry slot.
- **Pill geometry** (L154-161): `g = glass.discover`, `c = glass.chrome`; `TITLE_TOP = insets.top + c.row.topInset`; `TITLE_BAND_HEIGHT=36`; `PILL_BAR_HEIGHT=52`; `PILL_BAR_TOP = TITLE_TOP + TITLE_BAND_HEIGHT`; `HEADER_PANEL_HEIGHT = PILL_BAR_TOP + PILL_BAR_HEIGHT + 4`; `HEADER_PANEL_RADIUS=28`.
- **Spotlight animation** (L169-211): `tabLayoutsRef` captures each tab's `{x,width}` via `onLayout`; `spotlightX` + `spotlightWidth` are `Animated.Value`s; on `activeTab`/`layoutTick` change a parallel `Animated.spring` (`useNativeDriver:false` — animating layout props) moves the orange spotlight; `reduceMotion` → instant `setValue`. Damping/stiffness/mass from `glass.chrome.motion.*`; inset from `c.nav.spotlightInset`.
- **Glass header** (L216-310): `<BlurView intensity={g.stickyHeader.blurIntensity} tint="dark" experimentalBlurMethod={android?'dimezisBlurView':undefined}>` + tint fill + hairline; `useGlass = !reduceTransparency && !isAndroidPreBlur`; opaque fallback on Android/reduce-transparency.
- **Pill styles** (L405-450): `pillBarCapsule` (height 44, radius 24, border `rgba(255,255,255,0.12)`, bg `rgba(255,255,255,0.06)`, `overflow:'hidden'`); `spotlight` (top/bottom 4, radius 20, bg `glass.chrome.active.tint`, glow shadow); `tabLabelActive` (`glass.chrome.active.labelColor`, weight 600) vs `tabLabelInactive` (`glass.chrome.inactive.labelColor`).
- **Haptics + analytics** (L144-151): `handleTabChange` fires `Haptics.impactAsync(Medium)` on iOS + `mixpanelService.trackTabViewed({screen, tab})`; no-ops if same tab.
- **A11y** (L285-287): each tab `accessibilityRole="tab"`, `accessibilityLabel`, `accessibilityState={{selected}}`.
- **Content swap** (L322-348): `{activeTab === "saved" && <SavedTab/>}` / `{activeTab === "calendar" && <CalendarTab/>}` — simple conditional mount, both children memoized; `React.memo(LikesPage)` at L454 (I-TAB-SCREENS-MEMOIZED).

**Designer note for SPEC:** Discover's CURRENT header is a different geometry (large static title at `TITLE_TOP`/`TITLE_BAND_HEIGHT` + a horizontal filter-chip bar with city chip + date chips + pinned Filters button, `DiscoverScreen.tsx:1880-1991`). Mounting the Likes pill REPLACES/augments that header. The IA tension — pill switcher AND the existing filter-chip row both want the header band — is the single biggest **design** question (handed to mingla-designer): does the Events tab keep its filter-chip row below the pill, and does the Trips tab get its own filter row? This is `🎨 OPEN` for the designer; the pill pattern itself is `🔒 LOCKED` to the LikesPage interface above.

### Q-C — Anon RLS for published trips (live-DB verified)

**🔴 F-C1 (Root-fact, HIGH — live-DB proven).** A global published-trips discovery feed **needs a new SECURITY DEFINER RPC** (mirroring `pg_public_trips_by_brand` but global + filterable, not brand-scoped). It does NOT "just work" off the raw tables. Evidence (live DB, project `gqnoajqerqhnvulmnyvv`):

Anon table grants (`information_schema.role_table_grants` + `has_table_privilege('anon', …)`):
| Table | RLS on | anon SELECT grant | Anon public-row policy present |
|---|---|---|---|
| `events` | yes | **YES** | yes (`visibility='public' AND status IN scheduled/live/ended/cancelled`) |
| `event_dates` | yes | **YES** | yes (joined to published event) |
| `ticket_types` | yes | **YES** | yes (`is_hidden IS NOT TRUE` + published event) |
| `trip_pricing_tiers` | yes | **YES** | yes (`status IN scheduled/live` OR member) |
| `trip_days` | yes | **YES** | yes (same) |
| `trip_inclusions` | yes | **YES** | yes (same) |
| `brands` | yes | **NO grant (empty)** | policies exist but **unreachable** (no table grant) |
| `tickets` | yes | **NO grant** | n/a |

So anon CAN read trip core rows (events + tiers + dates + days + inclusions) directly, but CANNOT read:
1. `brands` → **planner display name + verified badge are NOT anon-readable from the table.** Must come from `business_public_brands_view` (SECURITY DEFINER; `has_table_privilege('anon',…)` = TRUE — verified) or be returned by a definer RPC that JOINs brands internally.
2. `tickets` → **capacity/sold/`spots_left` cannot be derived by anon** (the sold-count join needs `tickets`). Must be computed inside a SECURITY DEFINER RPC.

This is the COMMS-0009 hardening: anon access to `brands` was revoked; the security-definer views/RPCs are the only anon path. The existing per-brand RPC `pg_public_trips_by_brand` (migration `20260728000000`, read in full) already does exactly this — JOINs brands as definer, computes `spots_left` + `min_price_cents` from `tickets`/`ticket_types`, returns brand_slug — but is **scoped to one brand slug** (`p_brand_slug`, brand-kind-guarded to `trip_planner`). A global feed needs the same shape WITHOUT the brand filter, WITH filter/sort/pagination params (city, date window, price range, group size). **Definitive verdict: NEEDS a new `published_trips_public` SECURITY DEFINER RPC (or matview+view).** Raw-table anon read alone is insufficient because it cannot supply planner name, verified badge, or spots_left.

**🔴 F-C2 (Root-fact, HIGH — live-DB proven). Real published trips barely exist.** Live counts:
- `events` total trips: 36. With `visibility='public'`: **3**. With `status IN ('scheduled','live')`: **3**.
- The 3 published trips: **"The DC Adventure"** (`travelbrand`, 3 days, 1 tier $500, booking_deadline 2026-06-01), **"The Sone"** (`travelbrand`, 4 days, 1 tier $500, no deadline), **"Untitled trip"** (`testtttt`, 4 days, 1 tier $20,000, no deadline).
- ALL 3 from only 2 brands; ALL `kind='trip_planner'`; **NONE verified** (`brands.verified_at` = null for both) → the verified-badge acceptance criterion (#2) has **zero data to ever display today**.
- ALL 3 have `show_on_discover = false` (see F-D3) and exactly 1 published pricing tier each (pass the "≥1 tier" hard guard).

This is the dependency on Tr2 ("real published trips exist"). Tr2 has shipped the *mechanism* but only test-grade trips exist. **This is the single biggest scope risk** (see §8).

### Q-D — Trip data model (where each card field lives)

**🔵 F-D1 (Observation, HIGH).** Trip-card field provenance (verified against `information_schema.columns` + the `pg_public_trips_by_brand` RPC):

| Card field | Source | Notes |
|---|---|---|
| cover image | `events.cover_media_url` (+ `cover_media_type` image/video/gif) | anon-readable |
| title | `events.title` | |
| dates (start/end) | **`event_dates` where `is_master=true`** (`start_at`,`end_at`) — NOT an events column | the brief's `master_start_at` guess is wrong; no such column |
| per-day itinerary | `trip_days` (`ordinal`,`title`,`narrative`,`date`,`stops jsonb`) | for detail page |
| destination/city | `events.destination_text` (primary) + `events.location_text` + `events.city` + `events.location_geo (point)` | trip uses `destination_text`; events use `location_text` |
| planner name | `brands.name` → **only via `business_public_brands_view` / definer RPC** (anon-blocked on table) | F-C1 |
| verified badge | `brands.verified_at IS NOT NULL` (also `claim_status`) → definer only | no verified trip-planner exists today |
| price-from | `MIN(ticket_types.price_cents) FILTER (WHERE NOT is_free)` joined via `trip_pricing_tiers.ticket_type_id` | **`trip_pricing_tiers` has NO price column** — price lives in `ticket_types` |
| capacity / group-size | `SUM(ticket_types.quantity_total)` (NULL if any `is_unlimited`); `spots_left = capacity − sold`, sold from `tickets` (definer only) | group-size FILTER needs this aggregate |
| booking_deadline | `events.booking_deadline` (+ `bookings_closed`, `bookings_closed_at`) | NULL on 2 of 3 trips |
| currency | `ticket_types.currency` (min-price tier) | |
| refund policy | `events.theme.business_trip.*` (read by `usePublicTripBySlug`) | Tr4/ORCH-0875 |

**🟠 F-D2 (Contributing flaw for AC #3, HIGH — live-DB proven). The "intent" chip has NO backing data.** Acceptance criterion #3 demands an intent filter chip ("yoga retreat", "food tour"). There is **no trip-intent column**. The nearest fields — `events.vibe_tags` and `events.party_types` (used by the existing Discover business-event facets) — are **empty arrays on all 3 trips**, and `events.theme.business_trip` is `{}` on all 3. There is no planner-authoring step that sets a trip intent. The SPEC must either (a) DROP the intent chip from C1 scope (recommended — it's listed under "Open Polish" in the brief §9 as deferrable), or (b) register a follow-up ORCH to add a trip-intent field + business authoring UI (out of this consumer-read scope). **Intent matching cannot be built on data that does not exist.**

**🟡 F-D3 (Hidden flaw, HIGH — live-DB proven). `events.show_on_discover` exists and is `false` on all 3 trips.** There IS a column literally named `show_on_discover` (boolean) on `events`. If the new feed honors it as a publish-to-discover gate, **zero trips surface today**. The SPEC must decide explicitly: (a) ignore `show_on_discover` for trips (surface all published trips), or (b) honor it (then the operator/planners must flip it, and the feed is empty until they do). This flag's current semantics for trips are undocumented — the SPEC must pin it. Forbidden to silently assume either way.

### Q-E — mingla-business trip detail + buyer flow (the mirror source)

**🔵 F-E1 (Observation, HIGH).** Public trip page = `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (read in full). Structure to mirror in `app-mobile/`:
- Full-bleed cover hero (`TripPreview` with `showCta={false}`) + absolute X-close + share `IconChrome` overlays (ORCH-0874).
- Booking-deadline state (ORCH-0875): closed banner / countdown pill / refund-policy ladder (`RefundPolicyDisplay`), computed from `trip.bookingsClosed` + `trip.bookingDeadline`.
- `TripCheckoutFlow` (Reserve CTA + tier picker + installment disclosure).
- Anon-tolerant (no `useAuth`, no sign-in redirect) per `feedback_anon_buyer_routes.md`.

**🟠 F-E2 (Contributing flaw — do NOT copy this hook, HIGH — live-DB proven).** `mingla-business/src/hooks/usePublicTripBySlug.ts` reads `.from("brands").select(...)` **directly** (L63-68), with a comment claiming "anon-readable via brands public policy." **This is false for a true anon caller** — F-C1 proves `brands` has no anon table grant (empty `role_table_grants`), so the policy is unreachable and the query returns `permission denied`/null for anon. (It "works" on the business web app only when the buyer happens to have a session, or it is silently broken for anon — `suspected`: not live-fired against anon, but the grant evidence is conclusive.) **The consumer-app trip detail hook MUST NOT copy this; it must use `business_public_brands_view` (like `useBrandBySlug` correctly does) or a new definer RPC.** This is the exact COMMS-0009 trap.

**🔴 F-E3 (Root-fact for buyer flow, HIGH).** The buyer flow on business routes `TripCheckoutFlow` → `router.push('/checkout-trip/{tripEventId}')` — a **web/business multi-step checkout chain** (buyer-info → payment → confirmation), NOT the consumer native path. BUT the underlying money RPC is **shared**: `biz_ticket_checkout_create_session` branches on `event_type='trip'` (per Tr3/ORCH-0869). Crucially, the **consumer app already has the native equivalent**: `app-mobile/src/payments/nativeCheckoutFlow.ts` invokes `ticket-checkout-create` (surface:"native"), which is the exact unified all-in pricing edge fn COMMS-0014 mandates. So the consumer trip checkout should reuse `nativeCheckoutFlow` with `eventId = tripEventId` and `lines = [{ticketTypeId: <tier's ticket_type_id>, quantity}]`. **Trip-specific additions the consumer checkout must add vs the existing event checkout:**
1. **Tier selection → ticketTypeId resolution.** A trip's "pricing tier" is a `trip_pricing_tiers` row whose `ticket_type_id` is the real ticket. The consumer event checkout already takes `ticketTypeId` lines, so this is a mapping, not new plumbing.
2. **Trip intake form.** `trip_intake_schemas` (jsonb `schema`, per-ticket-type) defines required traveler-intake fields (Tr5). The event checkout collects buyer name/email/phone/address only. The trip checkout must render the intake schema and submit answers. **Open question for SPEC:** where does the intake answer payload go — `ticket-checkout-create` body extension, or a separate post-purchase write? (`suspected`: not yet traced to the persistence sink — the SPEC must trace `biz_ticket_checkout_create_session` trip branch + the business `/checkout-trip` intake submit to find the exact column/table. This is the one buyer-flow seam not fully traced here.)
3. **Booking-deadline + bookings_closed enforcement** at the CTA (hard guard).
4. **Refund-policy + installment disclosure** display (Tr4/Tr3) — display-only, reuses `RefundPolicyDisplay` logic.

**Confidence on the persistence sink for the intake form = `suspected`** (source-only; the `biz_ticket_checkout_create_session` trip branch + `/checkout-trip` step were not opened to the intake-write line). Everything else in Q-E is HIGH.

### Q-F — Signal scoring

**🔵 F-F1 (Observation, HIGH).** There is **no `app-mobile/src/services/signalScoringService.ts`** (the brief's filename is fictional). The real signal scoring is **server-side**: `supabase/functions/_shared/scoringService.ts` (5-factor: categoryMatch/tagOverlap/popularity/quality/textRelevance), driven by `discover-cards` + `_shared/signalRankFetch.ts` + `_shared/deckInterleave.ts`, feeding the **Home swipeable place-pool deck** via `RecommendationsContext`. The scorer operates on `card: any` shaped as a **Google-Places place-pool card** (rating, reviewCount, placeType, address). **Trips have none of those inputs** (no rating, no placeType, no review count). So acceptance criterion #12 ("signal scoring extended to score trips alongside today's cards for intent matching") is a **non-trivial new build**, not an extension of an existing typed enum — the scorer would need a new content-type branch with trip-specific factors, and trips would need scoreable signals (intent tags — which don't exist, per F-D2). **Recommendation flag:** AC #12 is effectively blocked by the same missing intent data as AC #3, and is also listed under brief §9 "Open Polish" ("whether to mix trips into the main feed … defer to C2"). The SPEC should DEFER AC #12 to C2 (multi-stop composer) and scope C1 to the standalone Trips tab feed (relevance = newest / location-proximity, which needs no scorer).

### Q-G — Consumer checkout today

**🔵 F-G1 (Observation, HIGH — reuse base confirmed). The consumer app ALREADY does native paid checkout.** `nativeCheckoutFlow.ts` (read in full) is a complete native Stripe PaymentSheet flow: invokes `ticket-checkout-create` (surface:"native"), branches `free_completed` / `requires_payment` / `requires_web_redirect`, handles Connect direct-charge (`initStripe` with `stripeAccountId` per PI, ORCH-0844), Apple Pay + Google Pay, Customer+ephemeralKey, idempotencyKey, taxCalculationId. Consumed via `useTicketCart`, `usePublicEventTickets`, `TicketCartSheet`, `ExpandedBusinessEventSheet`. **This is NOT a "consumer app has never done paid checkout" risk — it is a proven reuse base.** The trip checkout is a thin variant (different entry copy, tier→ticketTypeId mapping, intake form) over the same engine. This significantly DE-risks the buyer-flow half of C1.

### Q-H — Navigation

**🔵 F-H1 (Observation, HIGH).** `app-mobile/` uses a **custom state-machine nav, not React Navigation**. `app/index.tsx` renders a `case`-based switch on `currentPage: BottomNavPage` (`'home'|'discover'|'connections'|'likes'|'profile'`, `GlassBottomNav.tsx:42-46`, `TAB_ORDER` L69). Tab switches = `setCurrentPage(...)`. **Detail screens mount as full-screen overlays gated by state**, e.g. `viewingFriendProfileId` → renders `<FriendProfileScreen>` over everything (`app/index.tsx:2070,2324-2329`); `showPreferences`, `showPaywall` follow the same pattern. So a consumer trip detail opens via a new state slot (e.g. `viewingTripId` / `viewingTrip{brandSlug,tripSlug}`) → full-screen `<TripDetail>` overlay with `onBack`. **No new router route is needed for in-app card taps** — that's the in-app, no-WebBrowser path the brief demands.

**🔵 F-H2 (Observation, HIGH).** Deep links from OUTSIDE the app use Expo Router thin re-exports: `app/b/[slug].tsx` = `export default ConsumerBrandProfileScreen` (3 lines). The brief's `app/t/[brandSlug]/[tripSlug].tsx` would be the analogous deep-link route (re-exports a `<TripDetail>`/`<ConsumerTripScreen>`). So `app/t/[brandSlug]/[tripSlug].tsx` works in the consumer router as a thin re-export, and the SAME screen component is also mountable as the in-app overlay. **Today, the only consumer path to a trip is `ConsumerBrandProfileScreen`'s `onOpenTrip` → `WebBrowser.openBrowserAsync('https://business.usemingla.com/t/...')` (`ConsumerBrandProfileScreen.tsx:67-72`) — the exact "leaves the app" behavior C1 must replace.** The SPEC should also repoint that callback to the new in-app trip detail (otherwise the brand page still ejects to web — a journey inconsistency).

---

## 4. Five-Layer Cross-Check

| Layer | Truth | Contradiction? |
|---|---|---|
| **Docs** (C1 brief + WORLD_MAP) | Title "Events"→"Discover"; Likes-style tabs; global trips feed; intent chip; signal scoring for trips; `published_trips_public_view` "if needed"; reuse event checkout. | Brief's file map (`src/screens/Discover/…`, `signalScoringService.ts`) is WRONG (F-A1, F-F1). Brief says "swipeable deck" — it's a grid (F-A3). |
| **Schema** (migrations + information_schema) | Trip dates in `event_dates(is_master)`; price in `ticket_types` via `trip_pricing_tiers.ticket_type_id`; capacity = `ticket_types.quantity_total`; `show_on_discover` column exists; no intent column. | Brief's `master_start_at` column does not exist (F-D1). Intent has no column (F-D2). |
| **Code** (hooks/services/screens) | Consumer reads trips anon ONLY via `business_public_brands_view` + `pg_public_trips_by_brand` RPC (per-brand). Native checkout via `ticket-checkout-create` exists. Business `usePublicTripBySlug` reads `brands` directly. | Business hook's direct `brands` read contradicts the anon grant reality (F-E2) — would fail for true anon. |
| **Runtime** (live DB) | Anon blocked on `brands` + `tickets`; allowed on `events`/`event_dates`/`ticket_types`/`trip_*`. | The "anon-readable via brands public policy" comment in the business hook is contradicted by the empty anon grant. |
| **Data** (live rows) | 3 published trips, 2 brands, 0 verified, all `show_on_discover=false`, intent tags empty, 2/3 no booking_deadline. | "Real published trips exist" (Tr2) is technically true but the data is test-grade/near-empty — the feed will look empty/fake (F-C2). |

**Where layers disagree = where the build is risky:** the brief's file map + data assumptions (docs) vs the actual repo + DB (code/schema/data). The SPEC must reconcile to the code/schema/data truth.

---

## 5. Outcome & Journey Step-Back (Phase 5.5)

**User's actual job-to-be-done:** "I'm a consumer who wants to find and book a real group trip/experience (a yoga retreat, a DC weekend) without knowing a specific planner — and pay for it without being kicked out to a website."

**Complete desired journey:** Open app → Discover → tap **Trips** → see real trips → filter (city/dates/price/group size) → tap a trip → read full itinerary/inclusions/price/refund policy IN THE APP → Reserve → pick tier → fill traveler intake → native PaymentSheet → confirmation → (planner sees the booking in their dashboard).

**Divergence points today:**
1. There is no Trips tab (must build the shell — Q-A/Q-B).
2. There is no global trips feed (must build the RPC + service + hook — Q-C/Q-D).
3. Tapping any trip (from the brand page) **ejects to the mobile web browser** (`ConsumerBrandProfileScreen.tsx:67`) — the single most visible "leaves the app" failure C1 exists to kill (Q-H).
4. There is no consumer trip detail screen (must build — mirror `mingla-business/app/t/...` — Q-E).
5. Checkout: the engine EXISTS (good — Q-G), but no trip surface wires into it; the intake-form persistence sink is untraced (Q-E, `suspected`).
6. **Data divergence:** even with all UI built, the feed surfaces 1-2 test trips, none verified, none flagged for discover. **Fixing the reported "node" (build the tab) does NOT deliver the outcome (a useful trips feed) unless real trips exist and `show_on_discover` semantics are decided.** This is why F-C2 is the headline risk, not a footnote.

**Does building the tab deliver the outcome?** Only partially. The end-to-end mechanism will work, but the *experience* is empty/test-grade until (a) real verified trips are published and (b) `show_on_discover` policy is decided. The SPEC must surface this to the operator as a product gate, not silently ship an empty tab.

---

## 6. Blast Radius

- **`app/index.tsx`** (host): new `case "discover"` content (now tabbed), new overlay state for trip detail (`viewingTrip*`), possibly new `discoverActiveTab` registry. High-traffic file (2771 lines) — touch surgically.
- **`DiscoverScreen.tsx`**: header restructure (pill + existing filter row coexistence) — the ORCH-0996 cache signature + ORCH-0991 gesture coordination + ORCH-0839-A no-mobile-cache invariant must all survive. CI gate `app-mobile/scripts/ci/orch-0839-a-mobile-cache-removed.mjs` watches this file.
- **`ConsumerBrandProfileScreen.tsx`** + `@mingla/brand-rendering`: `onOpenTrip` should repoint from WebBrowser to in-app detail (else journey inconsistency). Shared package change → affects both consumer + business renders of `PublicBrandPage`.
- **Backend**: new global-trips SECURITY DEFINER RPC migration → triggers COMMS-0002 strict-grep gate (needs `ORCH_1016_BACKEND_ALLOWLIST` in the same commit). `GRANT EXECUTE … TO anon, authenticated` required (per `pg_public_trips_by_brand` precedent).
- **`ticket-checkout-create`** edge fn: NO change needed if trips reuse the existing `eventId`+`lines` native contract (COMMS-0014 compliant). Only touch if the intake-form payload must ride the checkout body (F-E3 open question).
- **Signal scoring** (`discover-cards`/`scoringService`): only if AC #12 is kept in C1 (recommend DEFER to C2).
- **Cross-surface:** Consumer iOS + Android only. Business/web/admin untouched (the trip data + buyer engine are reused server-side). **Android risk:** the Likes pill + Discover header use `BlurView`/glass — the `ANDROID_GLASS_USES_OPAQUE_FALLBACK` opaque-frosted policy (META-ORCH-1002) MUST be honored on the new pill + trip cards (LikesPage already does; the new TripCard must too). No new Android-specific glass risk beyond replicating the existing fallback correctly.

**Invariants in play:** I-TAB-SCREENS-MEMOIZED (memoize new tab children), I-TAB-PROPS-STABLE (stable props from host), I-PROPOSED-DISCOVER-NO-MOBILE-CACHE (don't reintroduce a mobile cache for trips), I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE (any new spots_left calc must mirror the checkout capacity gate exactly, like `pg_public_trips_by_brand` does), ANDROID_GLASS_USES_OPAQUE_FALLBACK, I-ANON-BRANDS-VIA-DEFINER-VIEW (COMMS-0009).

---

## 7. What Must Be True For The Build (SPEC inputs)

1. **Shell.** Discover title → "Discover" (i18n `discover:title`, decide EN-only vs all locales). Discover becomes tabbed with **Events** + **Trips** using the EXACT `LikesPage` spotlight-pill pattern (interface in F-B1); Events tab = the existing grid pipeline UNCHANGED; add a `discoverActiveTab` Zustand registry slot. Designer owns the pill-vs-existing-filter-row IA tension.
2. **Trips feed read.** New SECURITY DEFINER RPC `published_trips_public(...)` (global, filterable by city/date-window/price-range/group-size, sortable, paginated), `GRANT EXECUTE TO anon, authenticated`, mirroring `pg_public_trips_by_brand`'s definer JOIN-brands + `tickets`-sold derivation + I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE. New consumer service `tripsDiscoveryService.ts` + hook `useDiscoverTrips.ts` (React Query, anon-tolerant, `staleTime`, query-key factory). Add `ORCH_1016_BACKEND_ALLOWLIST` (COMMS-0002).
3. **Card.** `TripCard` renders cover, title, dates (from `event_dates` master), destination (`destination_text`), planner name (definer view), verified badge (`verified_at` — will be empty today), price-from (`min_price_cents`), capacity/spots_left. Android opaque-glass fallback.
4. **Hard guards (enforce in the RPC `WHERE`, not client-side):** `event_type='trip' AND visibility='public' AND status IN ('scheduled','live') AND deleted_at IS NULL AND bookings_closed=false AND (booking_deadline IS NULL OR booking_deadline >= now()) AND EXISTS (≥1 published, non-hidden pricing tier)`. Decide `show_on_discover` policy (F-D3). Never expose planner manage view. Never break the Events grid.
5. **Intent chip (AC #3) + signal scoring (AC #12): DEFER or descope** — no backing data exists (F-D2, F-F1). Operator decision required; brief §9 already lists both as deferrable.
6. **Detail.** Consumer trip detail screen mirroring `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (TripPreview + booking-deadline state + refund ladder + Reserve), mounted BOTH as an in-app overlay (state slot in `app/index.tsx`) AND a deep-link route (`app/t/[brandSlug]/[tripSlug].tsx` thin re-export). Anon hook MUST use `business_public_brands_view`/definer RPC, NOT a direct `brands` read (F-E2). Repoint `ConsumerBrandProfileScreen.onOpenTrip` away from WebBrowser.
7. **Checkout.** Reuse `nativeCheckoutFlow.ts` → `ticket-checkout-create` (surface:"native", `eventId=tripEventId`, `lines=[{ticketTypeId,quantity}]`) per COMMS-0014. Add: tier→ticketTypeId mapping, trip intake form from `trip_intake_schemas` (trace the intake persistence sink — currently `suspected`), deadline enforcement at CTA, refund/installment disclosure display.
8. **Data gate.** The operator must publish real verified trips + set `show_on_discover` (if honored) before C1 reads as a real feature, OR accept shipping a near-empty tab (F-C2).

---

## 8. Single Biggest Scope Risk

**There are effectively zero real, discover-ready trips in production.** Live DB: only **3** published public trips, from **2** brands (`travelbrand`, `testtttt`), **none verified**, **all with `show_on_discover=false`**, **2 of 3 with no booking_deadline**, intent tags empty, one priced at $20,000 ("Untitled trip"). C1 can be built end-to-end and pass every mechanical test, yet the Trips tab will render an empty/test-grade feed that looks broken or fake to a real consumer. The feature's *value* is gated on Tr2-onward planners actually publishing real trips AND a product decision on `show_on_discover`. The SPEC MUST surface this as an operator product-gate (publish real seed trips + decide the discover flag) — not bury it. Secondary risk: AC #3 (intent chip) and AC #12 (trip signal scoring) have **no backing data and no scorer support** and should be descoped from C1 to C2.

---

## 9. Discoveries for Orchestrator (side issues)

- **D-1 (P2).** `mingla-business/src/hooks/usePublicTripBySlug.ts:63-68` reads `brands` directly with a comment asserting anon-readability that is **false** (anon has no `brands` grant — COMMS-0009). For a true anon buyer on the public trip share link, this `suspected`-fails. Worth an INVESTIGATE on the business public trip route's anon behavior independent of ORCH-1016 (the consumer ORCH simply must not copy it).
- **D-2 (P3).** `DiscoverScreen.tsx` header comment (L1-16) says the title is "Discover" but the rendered i18n value is "Events" — stale comment, mildly misleading. Cleaned up incidentally by this ORCH's rename.
- **D-3 (P3).** The brief's "Files Touched" + "Data Model" sections cite non-existent paths (`src/screens/Discover/…`, `signalScoringService.ts`) and a non-existent column (`master_start_at`). The milestone doc should be corrected post-SPEC so future readers aren't misled.

---

## 10. Completion Gate (7 clauses)

1. **Root facts proven w/ 6 fields + ≥2 candidates disproven.** ✔ Title source (F-A2) proven via i18n+line; anon-RPC need (F-C1) proven via grants table (disproved the "raw-table read works" candidate); checkout reuse (F-G1) proven via full read of `nativeCheckoutFlow`. Non-causes disproven (e.g., "anon can read brands" disproven by empty `role_table_grants`).
2. **Pipeline traced backward AND forward to terminal outcome.** ✔ §5 maps intent→empty-feed; both the read path (RPC→service→hook→card) and the buyer path (CTA→ticket-checkout-create→PaymentSheet→confirmation→planner dashboard) walked; the WebBrowser-eject divergence found forward of the brand page.
3. **Journey mapped, divergences named, "does fixing deliver outcome?" answered.** ✔ §5 — answer: only partially; data gate (F-C2) blocks the real outcome.
4. **External research done (docs/competitors) or web-gap flagged.** ✔ Competitor/UX research on travel-feed filtering (destination/dates/price/group-size + flair tags) confirms the C1 filter set is current best practice and the intent-chip pattern is valued — but Mingla lacks the data. Stripe contract reused verbatim (no new external enum → no new doc citation owed).
5. **Every pertinent file read in full; hot-path imports followed.** ✔ `LikesPage`, `nativeCheckoutFlow`, `pg_public_trips_by_brand` migration, the business trip route, `ConsumerBrandProfileScreen`, `useBrandBySlug` read in full; `DiscoverScreen` read across header+grid+fetch sections; `BottomNavPage`/host switch read.
6. **DB-object root causes: latest migration confirmed current.** ✔ `pg_public_trips_by_brand` = latest (only) definition (migration `20260728000000`, grep-confirmed no later supersede). RLS policies + grants read live from the running DB (authoritative over migrations).
7. **UI/runtime bug reproduced on sim.** N/A — this is a build investigation of a not-yet-built feature (code+schema+data audit), not a reproducer-bound runtime bug. Source+live-DB confidence is HIGH; the two `suspected` items (business anon-brands failure D-1; trip-intake persistence sink F-E3) are explicitly labelled and flagged for the SPEC to trace/verify, not inflated.

**Overall confidence: HIGH.** Two narrow `suspected` seams flagged for SPEC-phase tracing.
