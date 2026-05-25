# INVESTIGATION — ORCH-0964 [Public-page customization: theme color + preset fonts + entrance animations]

**Authored:** 2026-05-25 by Claude `mingla-forensics` (INVESTIGATE mode)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]`
**Branch:** `ORCH-0964-public-page-theme-customization`
**Severity:** S2-medium / `missing-feature` + `ux`
**Confidence:** `proven` for current-state evidence; `inconclusive` for ORCH-0962 dependent fields (their investigation not yet returned)

---

## 1. Phase 0 ingest summary

**Read:**
- Dispatch prompt `Mingla_Artifacts/prompts/FORENSICS_INVESTIGATE_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`.
- `Mingla_Artifacts/WORLD_MAP.md` ORCH-0964 banner + sibling banners (ORCH-0961, ORCH-0962, ORCH-0963).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` grep for theme/color/font/animation.
- Memory: `feedback_rn_color_formats.md`, `feedback_brand_kind_immutable_post_create.md`.
- Migration baseline `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` + post-baseline `20260506000000_brand_kind_address_cover_hue_media.sql`.
- Sibling worktree `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/Mingla_Artifacts/`: only prompt file present — INVESTIGATION not yet returned.

**Skipped (deferred to ORCH-0962):** exhaustive walk of every Brand-edit input field and its public-render correspondent. ORCH-0964 only needs to know that the shared rendering surface exists (it does — see §4) and that ORCH-0962's outputs will refine the candidate set for Q-b.

## 2. Layer × surface matrix (5-truth-layer × 3-surface)

| | Buyer-web (`mingla-business/`) | Consumer iOS (`app-mobile/`) | Consumer Android (`app-mobile/`) |
|---|---|---|---|
| **Docs** | No prior theme spec. Cover-hue (single integer 0–359) is the only existing brand "color" knob, codified `20260506000000`. | Same. | Same. |
| **Schema** | `brands.cover_hue` integer NOT NULL default 25 (0–359). No `theme` JSONB. No font/animation columns. `events.theme` JSONB NOT NULL default `'{}'` already holds `coverHue` + `business_*` subkeys. | (shared DB) | (shared DB) |
| **Code** | Public brand page `mingla-business/app/b/[brandSlug]/index.tsx` → `mingla-business/src/components/brand/PublicBrandPage.tsx`. Public event page `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` → adapter `mingla-business/src/components/event/PublicEventPage.tsx` → shared `packages/event-rendering/PublicEventPage.tsx`. | Event detail: `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` (nightOut/Ticketmaster events) + `ExpandedBusinessEventSheet.tsx` (business events) → mounts shared `packages/event-rendering/PublicEventPage.tsx` via `mapCardToPublicEvent`. | Same as iOS (RN cross-platform). |
| **Runtime** | `mingla-business` is Expo / React-Native-Web (NOT Next.js — `mingla-business/app/_layout.tsx` is Expo Router). Client-side render, no SSR/hydration concern. `marketing` is the Next.js project. | RN on iOS — design tokens static from `app-mobile/src/constants/designSystem.ts`. | RN on Android — same code path. |
| **Data** | Real brands have `cover_hue` set to hue integers; `events.theme` JSONB observed populated with `coverHue` + business event/trip/draft subkeys per `mingla-business/src/utils/serverDraftEventMapper.ts`. | Same. | Same. |

**Contradiction map:** zero today. The system has a single hue-integer knob (`brands.cover_hue`) consistently propagated. Adding a richer theme is greenfield — no layer contradicts any other yet, but ORCH-0964 introduces new surface that must be propagated identically.

## 3. Schema evidence

### Existing columns

**`brands`** (final state via `20260506000000`):
- 20 columns total. The only style-related column is `cover_hue` (integer, NOT NULL, default 25, CHECK 0 ≤ hue < 360). `profile_photo_url`, `cover_media_url`, `cover_media_type` exist for media. **No `theme`, no `brand_color`, no `font`, no `animation`, no `metadata` JSONB.**

**`events`** (final state via baseline `20260505000000`):
- `theme jsonb NOT NULL default '{}'` exists. Keys currently used per `serverDraftEventMapper.ts`: `business_draft`, `business_event`, `business_trip`, `coverHue`, `existingFlag`.
- `cover_media_url`, `cover_media_type` exist.
- **No event-level font/animation/brand_color column.**

### Conflict / reuse analysis

- **NO column-name collisions.** Zero `DROP COLUMN` statements anywhere post-baseline. New columns `brand_color`, `theme_font`, `theme_animation` (names TBD by SPEC) are clear.
- **`events.theme` JSONB exists and is heavily used** — adding new top-level keys here is structurally available, BUT: per `SCOPE_EXPANSION_ORCH-0950_DASHBOARD_COHERENCE.md` and `feedback_keyboard_never_blocks_input.md` precedents, JSONB blobs in this column have been the site of wholesale-wipe bugs (ORCH-0950 partial-patch / deep-merge fix). Putting theme inside the same JSONB exposes it to the same risk class. **Recommendation for SPEC (not decided here): typed columns over JSONB-blob, OR a dedicated `events.theme_overrides` JSONB column distinct from the existing `theme` to keep blast radius small.**
- **No `brands.theme` exists** — schema must add brand-level columns or a new `brands.theme` JSONB. Same SPEC-level decision.

### RLS coverage

- `brands` UPDATE policy `Brand admin plus can update brands` (baseline line 14114) uses `biz_is_brand_admin_plus_for_caller(id)` — covers ANY new column added to brands; no column-level RLS exclusions exist.
- `events` UPDATE policy `Event manager plus can update events` (baseline line 14258) uses `biz_brand_effective_rank_for_caller(brand_id) >= event_manager` — covers any new column.
- Public SELECT: `Public can read brands with public events` (line 14430) is row-level only; new columns will be readable by anon.
- **Conclusion:** owner-write + anon-read paths are already in place. No new RLS policies required for the columns themselves.

## 4. Consumer-app render-site enumeration (Q-b evidence)

The dispatch description named "event/brand views inside consumer app" without specifics. Enumerated candidates (with file paths) so SPEC can pick a minimal set:

| # | File | Surface | What it renders | Recommended for SPEC? |
|---|---|---|---|---|
| 1 | `packages/event-rendering/PublicEventPage.tsx` | **shared** (consumer iOS, consumer Android, business iOS, business Android, buyer-web) | Full event detail (hero, ticket tiers, organiser, address). Pure presentational, no data fetching, no app-specific imports. Own local `designTokens.ts`. | **YES — primary injection point.** Theming this component themes 5 surfaces simultaneously. |
| 2 | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | consumer iOS + Android | Consumer-facing bottom sheet that mounts (#1). Passes `coverHue` via `mapCardToPublicEvent()`. | Implicit via #1 — the sheet host needs a theme prop pass-through, not its own theming logic. |
| 3 | `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` | consumer iOS + Android | nightOut/Ticketmaster (3rd-party) event detail. Distinct from business events. | **NO** — Ticketmaster/nightOut events have no brand_color (no Mingla brand owns them). Out of scope. |
| 4 | `app-mobile/src/components/discover/BusinessEventCard.tsx` | consumer iOS + Android | Grid card in Discover for business events. Already uses `heroColorFromHue(hue): hsl(h,60%,45%)` per `feedback_rn_color_formats.md`. | **MAYBE** — operator decision at SPEC time. Card chrome theming widens blast radius significantly. |
| 5 | `app-mobile/src/components/SwipeableCards.tsx` + `CuratedExperienceSwipeCard.tsx` | consumer iOS + Android | Tinder-style swiper deck card. Currently uses `glass.*` static tokens. | **NO recommended** — recommendation deck is heterogeneous (mixes brands). Theming individual cards by brand would be visually chaotic. Out of scope. |
| 6 | `mingla-business/src/components/brand/PublicBrandPage.tsx` | buyer-web | Public brand page hero + tabs (Events / Stats / Venue). Inline `backgroundColor: hsl(${brand.coverHue},60%,45%)` at line 309. | **YES** — primary brand-page render site. |
| 7 | `mingla-business/app/b/[brandSlug]/index.tsx` + `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | buyer-web | Route wrappers. Fetch via `usePublicBrandBySlug` / `usePublicEventBySlug`. | **YES** — must thread brand-theme + event-theme-override props down to PublicBrandPage and PublicEventPage. |

**Recommended minimal scope for SPEC (NOT decided here — operator confirms):** sites 1 + 2 + 6 + 7. Skip 3, 4, 5. Theming the shared `PublicEventPage` covers consumer-app event view automatically because `ExpandedBusinessEventSheet` already mounts it. Brand page is buyer-web-only (no dedicated consumer-app brand screen exists today).

### Design-token files
- `mingla-business/src/constants/designSystem.ts` — static spacing/radius/text/accent/canvas/glass; no theme provider.
- `app-mobile/src/constants/designSystem.ts` — same shape, separate file (no shared design-token package).
- `packages/event-rendering/designTokens.ts` — local to shared package; the file SPEC will likely modify or extend.

## 5. Font candidate evaluation table (Q-a evidence)

**Current state:** Mingla uses **no custom fonts** anywhere. Zero `fontFamily:` usages found in `packages/event-rendering/`, `mingla-business/src/components/brand/PublicBrandPage.tsx`, `app-mobile/src/components/expandedCard/`. No Expo `useFonts` registration in `app-mobile/app.json` or `mingla-business/app.config.ts`. Everything inherits the system default (SF Pro on iOS, Roboto on Android, system-stack on web).

Adding fonts is therefore **net-new infrastructure** — `expo-font` integration on both `app-mobile` and `mingla-business`, font files bundled into each app, web `@font-face` mappings.

Candidate fonts to evaluate at SPEC time (operator picks 6–10):

| Font | Style | Web availability | RN bundle cost (TTF) | License (commercial) | Weights useful |
|---|---|---|---|---|---|
| Inter | Sans | Google Fonts | ~150 kB × N weights | OFL — clean | 400/500/600/700 |
| Poppins | Sans | Google Fonts | ~140 kB × N | OFL — clean | 400/500/600/700 |
| Montserrat | Sans | Google Fonts | ~210 kB × N | OFL — clean | 400/600/700 |
| Space Grotesk | Sans (techy) | Google Fonts | ~120 kB × N | OFL — clean | 400/500/700 |
| DM Serif Display | Serif (display) | Google Fonts | ~160 kB × N | OFL — clean | 400 only |
| Playfair Display | Serif | Google Fonts | ~270 kB × N | OFL — clean | 400/700 |
| Lora | Serif (text) | Google Fonts | ~150 kB × N | OFL — clean | 400/600/700 |
| Fraunces | Serif (variable) | Google Fonts | ~700 kB variable | OFL — clean | variable |
| Bebas Neue | Display (caps) | Google Fonts | ~50 kB × 1 | OFL — clean | 400 only |
| Merriweather | Serif (text) | Google Fonts | ~250 kB × N | OFL — clean | 400/700 |

**Bundle math:** 6 fonts × 3 weights average × ~180 kB = ~3.2 MB per platform per app. iOS+Android+web × 2 apps (app-mobile + mingla-business) → real cost depends on whether we share via the workspace `packages/` boundary (recommended).

**SPEC needs operator input on Q-a final list.** Investigation cannot pick for the operator.

## 6. WCAG contrast surfaces (Q-c evidence)

Text/iconography that overlays the brand color in the candidate render sites:

| Surface | Foreground | Background | Current contrast | Risk |
|---|---|---|---|---|
| `PublicBrandPage.tsx` line 309 hero | White text (brand name, tagline) | `hsl(coverHue, 60%, 45%)` brand color | hue 0–60° (red→yellow at 45% lightness) drops to ~3.5:1 for white text — sub-AA. | If user picks pure yellow `#FFFF00`, white-on-yellow = unreadable. |
| `PublicEventPage` hero (shared package) | White event title, "BUY TICKETS" CTA, ticket-tier text | Brand color (theme prop) | Same risk class. | Same. |
| Avatar ring / chrome accents | Brand color on white background | white canvas | Self-on-light always fine (≤white). | Low. |
| Glass overlays (`glass.scrim`) | Translucent dark over hero photo | brand color showing through | Depends on photo + scrim opacity. | Medium — already handled by existing scrim. |

**SPEC must establish:** a WCAG AA contrast floor (4.5:1 for normal text, 3:1 for large text) enforced AT WRITE TIME on the hex picker. Two implementation patterns to evaluate at SPEC: (a) picker UI rejects sub-AA picks against white text, OR (b) brand_color stored as-is but a derived `foreground_color` (auto-computed black or white) is stored alongside.

## 7. Checkout-isolation proof (Q-d evidence)

- `mingla-business/app/checkout/[eventId]/_layout.tsx` exists as a **dedicated checkout layout** (separate from `app/_layout.tsx` root). Checkout pages mount under this layout.
- `mingla-business/app/b/[brandSlug]/index.tsx` and `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` have **no dedicated `_layout.tsx`** in their respective folders — they inherit from `app/_layout.tsx`.
- **There is no shared intermediate layout file between the brand/event public routes and the checkout routes.** Checkout's `_layout.tsx` is its own boundary.
- **PROVEN:** a theme rendered in `PublicBrandPage` or `PublicEventPage` cannot cross into `/checkout/*` via shared layout inheritance. SPEC must still ensure no theme provider mounted at `app/_layout.tsx` (root) — themes must mount INSIDE the brand/event pages, not at the app root.

## 8. Lottie bundle-cost estimates (Q-e evidence)

**Today's state:**
- `app-mobile/package.json`: no `lottie-react-native`, no `lottie-web`. `react-native-reanimated@~4.1.5` IS present.
- `mingla-business/package.json`: no `lottie-react-native`, no `lottie-web`. `react-native-reanimated@~4.1.1` IS present.

**Adding `lottie-react-native`:**
- Native module — requires `eas build` for both apps (NOT just OTA).
- Lottie JSON file sizes per animation (typical): confetti ~15–40 kB, balloons ~20–50 kB, sparkles ~10–25 kB. Four animations × max ~50 kB ≈ 200 kB total per app, minimal bundle impact.
- Web: `lottie-react-native` plays nicely with `react-native-web` on Expo, but documentation suggests using `@lottiefiles/dotlottie-react` or `lottie-react` for the web build path. Cross-platform parity claim from INTAKE needs SPEC-level verification — operator decision-locked Lottie before this evidence existed.

**Alternative tech already present:** `react-native-reanimated` 4.x can program confetti/balloons/sparkles entirely without native deps. Cost: hand-coded effects (several days of design + animation tuning per effect). Saves the native rebuild cycle. **Discovery for orchestrator — see §10.**

## 9. Open-question summary for SPEC (with operator input where needed)

| # | Question | Status |
|---|---|---|
| Q-a | Final font whitelist (6–10) | **Operator picks at SPEC time.** Candidate table in §5. |
| Q-b | Consumer-app theming scope | **Operator confirms at SPEC time.** Recommended minimal set: sites 1, 2, 6, 7 (skip 3, 4, 5) — see §4. |
| Q-c | WCAG AA contrast enforcement mechanism | **SPEC chooses.** Two patterns proposed in §6. |
| Q-d | Checkout isolation | **RESOLVED — proven §7.** No further SPEC action; just don't mount theme provider at app root. |
| Q-e | Lottie vs Reanimated for animations | **REOPENED.** Operator INTAKE locked Lottie before knowing both apps need native rebuild AND Reanimated already supports the same effects. SPEC should re-surface this decision OR operator should re-affirm Lottie. See §10 discovery. |
| Q-NEW | Theme storage shape — typed columns vs `events.theme` JSONB vs new `events.theme_overrides` JSONB | **SPEC decides.** Three trade-offs in §3 conflict-analysis. ORCH-0950 wholesale-wipe class is the cautionary tale. |
| Q-NEW | Per-event override resolver location — DB view, edge function, or service-layer | **SPEC decides.** `event.theme ?? brand.theme ?? mingla.default` resolution can live in `usePublicEventBySlug` hook (simplest), in a new edge function (centralized but more deploys), or in a DB view (single query but harder to evolve). |

## 10. Cross-ORCH coordination + discoveries for orchestrator

### What ORCH-0964 needs from ORCH-0962
- ORCH-0962 [Brand-edit → public-brand field rendering audit] is in flight (worktree spawned, INVESTIGATE prompt staged, NO report returned). Its outputs will tell us which existing brand-edit fields already have render-side coverage on PublicBrandPage. **ORCH-0964 SPEC can begin without it** (the theme storage and rendering work is greenfield, not field-audit-dependent), but the SPEC §3 inventory of "fields the Edit Brand page already supports" should cite ORCH-0962's findings rather than re-walking. **Recommendation:** SPEC can start after operator confirms Q-a/Q-b/Q-c/Q-e/Q-NEW; ORCH-0962's outputs are amendments, not blockers.

### Discoveries for orchestrator

**D-1 — Reanimated alternative to Lottie.** `react-native-reanimated` 4.x is already in both apps. Confetti/balloons/sparkles can be implemented without adding a native dep. INTAKE locked Lottie before this evidence was on the table. Surface for operator re-confirmation. Severity: P2-medium (correctness of decision-lock, not a bug).

**D-2 — Two parallel `designSystem.ts` files.** `app-mobile/src/constants/designSystem.ts` and `mingla-business/src/constants/designSystem.ts` are separately maintained with similar shape. The shared `packages/event-rendering/designTokens.ts` is a partial third source. Theming logic written into one and not the others creates drift risk. **Future ORCH candidate:** unify into a shared `packages/design-tokens/` workspace package. Not in scope for ORCH-0964 but should be flagged.

**D-3 — `events.theme` JSONB is a known footgun.** Per `SCOPE_EXPANSION_ORCH-0950_DASHBOARD_COHERENCE.md` and ORCH-0950 close banner (PR #210, merged `5b6036842`), this JSONB has caused wholesale-wipe bugs solved by deep-merge defenses. ORCH-0964 should NOT add more keys to this blob without explicit JSONB strategy guidance from SPEC. Surfacing for orchestrator awareness.

**D-4 — No live brands have non-default themes.** Per the sibling ORCH-0962 dispatch banner, the count of live brands at INTAKE is very small. ORCH-0964 ships with zero migration risk on existing brand data (no theme data to back-fill). Confirms SPEC can pick the cleanest schema shape without legacy compatibility constraints.

**D-5 — No font infrastructure exists today.** `expo-font` registration is net-new. Adding font bundling to both apps is its own native-rebuild milestone independent of the theme system. SPEC may want to phase: Phase A = color + animation (lighter, OTA-friendly if no Lottie), Phase B = fonts (native rebuild required regardless).

### Comms ledger writes
None this turn. Findings above are local to ORCH-0964 and don't materially affect other in-flight ORCHs beyond what's already in COMMS-0003 (external-API docs — N/A here, no external API surface).

---

**Confidence:** `proven` for current-state schema, code paths, dependency presence, and shared-package architecture. `inconclusive` only on items dependent on operator decisions (Q-a, Q-b, Q-c, Q-e, Q-NEW) — these are SPEC inputs, not investigation gaps.

**Investigation complete.** Hand back to orchestrator for REVIEW → SPEC dispatch.
