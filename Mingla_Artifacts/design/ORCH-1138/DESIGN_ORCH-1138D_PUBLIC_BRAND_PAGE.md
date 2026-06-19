# DESIGN — ORCH-1138D Public Brand Page Redesign (Direction A, brand-hub fine-tune)

**Status:** DESIGN-FIRST. Mockup for review BEFORE any implementation.
**Surface:** Public buyer-anon BRAND profile/hub — `mingla-business` React Native Web, route `/b/[brandSlug]`.
**Inherits:** the APPROVED Direction A system (`DIRECTION_A_V2_FULL_RESPONSIVE.html` + `DESIGN_ORCH-1138_PUBLIC_TRIP_PAGE_REDESIGN.md`), Seth-confirmed "works perfect."
**Deliverable mockup:** `BRAND_DIRECTION_A_RESPONSIVE.html` — one self-contained responsive file. Resize: ≤1023px phone immersive parallax hub, ≥1024px desktop 2-column (directory left, sticky brand-summary panel right). Demo bar: brand color swatches + font picker + State picker (Many / Few / None / Cover-is-video).
**Reviewer action:** double-click the HTML, flip the brand color/font, cycle the State picker, resize the window.

> **The key product difference from the trip page:** a trip page is a single-offering CHECKOUT (the sticky panel is a Reserve/payment block). A brand page is a PROFILE + DIRECTORY (the sticky panel is a brand SUMMARY + Share/Contact + featured offering). There is **no money decision** and **no Follow** on this page — see §F.

---

## A. FIELD INVENTORY — every field the brand page can actually carry (traced to source)

Sourced by reading the real shared renderer + the props adapter + the public `PublicBrand` type, NOT guessed.
- Renderer: `packages/brand-rendering/PublicBrand` types — `packages/brand-rendering/types.ts`
- Shared component: `packages/brand-rendering/PublicBrandPage.tsx`
- Business adapter (maps store → shared props): `mingla-business/src/components/brand/PublicBrandPage.tsx`
- Route + states: `mingla-business/app/b/[brandSlug]/index.tsx`
- Hook (data fetch): `mingla-business/src/hooks/usePublicEvents.ts` → `usePublicBrandBySlug`
- Authoring (what an owner can SET): `mingla-business/src/components/brand/BrandEditView.tsx` (5 sections: Photo · About · Theme · Contact · Social)

### A.1 Brand identity (`PublicBrand`, from `brands` row)
| Field | Source | Authored at | Rendered as |
|---|---|---|---|
| `displayName` | `types.ts:25` → adapter `:53` | BrandEditView name field (`:548`) | Identity name (hero overlay desktop / body phone) |
| `slug` | `types.ts:24` | system | URL + canonical/OG/share |
| `address` | `types.ts:26` (`string \| null`) | BrandEditView "Add your venue" / address (`:531/645`) | Sub-name address line (rendered only when non-empty — `PublicBrandPage.tsx:582`) |
| `photo` | `types.ts:30` | BrandEditView avatar picker (`:471`) | Circular avatar (fallback = initial — `:774`) |
| `coverMediaUrl` | `types.ts:28` | BrandEditView cover picker (`:618`) | Full-bleed hero cover (`PublicBrandPage.tsx:524`) |
| `coverMediaType` | `types.ts:29` (`image\|video\|gif`) | cover picker | `EventCoverMedia` autoplays video muted (`:527`) — see §F mute note |
| `coverHue` | `types.ts:27` (number, required) | BrandEditView cover-hue tiles | No-cover fallback hue (`:417`, `:536`) |
| `bio` | `types.ts:31` | BrandEditView bio field (`:563`) | About body + identity lead + OG/meta (rendered only when non-empty — `:606`) |
| `tagline` | `types.ts:32` | BrandEditView tagline field (`:556`) | Tagline line above bio (rendered only when non-empty — `:595`) |
| `theme` | `types.ts:35` (`ThemeInput`) | ThemeEditorSection (color · font · animation — `:628`) | Drives accent / font / light-dark page / entrance animation (`resolveTheme` + `createThemePalette` — `PublicBrandPage.tsx:263/356`) |

### A.2 Social links (`PublicBrandLinks`, all optional)
`types.ts:5–15` → authored in BrandEditView Social section (`:696–775`). Each renders an accent icon chip ONLY when present (`PublicBrandPage.tsx:427–484`):
`website` · `instagram` · `tiktok` · `x` · `facebook` · `youtube` · `linkedin` · `threads`. (Also a `custom[]{label,url}` slot in the type — NOT surfaced today.)

### A.3 Contact (`PublicBrandContact`)
`types.ts:17–20` → BrandEditView Contact section (`:664/682`). `email` (mailto) + `phone` (tel) — each rendered in the About tab only when present (`PublicBrandPage.tsx:1426–1464`).

### A.4 Venue verification (`PublicVenueDetail`, server-derived)
`types.ts:124–128`. `isVerifiedVenue: true` → "Verified venue" accent eyebrow above the name (`:568`). `city` → page title + "in {city}" meta. `venueCategory` (restaurant/play/creative_and_arts) — fetched, NOT rendered today.

### A.5 OFFERINGS — the core hub content (4 buckets)
| Bucket | Type | Source | Card fields rendered |
|---|---|---|---|
| **Upcoming** (mixed) | `PublicBrandUpcoming` | `types.ts:105–122` | offeringType, name, coverMediaUrl, startsAt (date), priceFromMinorUnits/isFree, → routes by type |
| **Events** | `PublicBrandEvent` | `types.ts:45–66` | name, dateLine, venueName/format, coverMediaUrl/Hue, `displayPriceCents`(all-in)→"From £X"/Free, status (upcoming vs ended) |
| **Trips** | `PublicBrandTrip` | `types.ts:68–85` | title, destinationText, startAt/endAt range, coverMediaUrl, `minPriceCents`/hasFreeTier→"From £X", `spotsLeft`(≤5→"N spots left"/0→"Sold out"), `bookingsClosed`→"Booking closed" |
| **Experiences** | `PublicBrandExperience` | `types.ts:87–103` | name, venueText, nextOccurrenceAt, coverMediaUrl, `priceFromMinorUnits`/isFree→"From £X" |

Past offerings: `pastEvents` / `pastTrips` arrays (`types.ts:143/144`) — rendered dimmed (`eventCardPast` opacity 0.7) after upcoming within a bucket.

### A.6 Fields present in the model but NOT rendered (and why)
- **`venueCategory`** — fetched, unused. Could become a real brand category chip (restaurant/play/creative & arts). Rendered in the redesign ONLY if Seth wants it; flagged §G.
- **`links.custom[]`** — typed but never surfaced. Out of scope unless requested (rule 9: it exists, but no authoring path populates it today).
- **FOLLOW / subscriber count** — **DOES NOT EXIST anywhere in the brand model.** No `follow`, `subscriber`, or `is_following` field in `types.ts`, the adapter, or the store. The only "follow" matches in the codebase are venue-claim "follow_up" (unrelated). **The redesign must NOT fabricate a Follow button.** See §F.
- **Stats / attendees** — `Brand.stats.attendees` exists in the *business-app store* (`currentBrandStore.ts`) but is NOT in the public `PublicBrand` payload — it is owner-facing analytics, not buyer-facing. Excluded.

---

## B. Current page — brutal assessment

The current `PublicBrandPage.tsx` is functional but under-designed relative to the now-approved event/trip DNA:

1. **Hero is a fixed 380px absolute banner, not the immersive parallax cover.** Content sits in a flat scroll with `paddingTop: 284`; there is no overlapping rounded body seam, no parallax slide-over. It reads as "a header image with a card under it," not the immersive event/trip hero.
2. **Identity is a single floating glass card** (avatar + name + address + tagline + bio all stacked) — reasonable, but it defaults the whole page to the **About tab**, so a buyer landing on a brand sees *bio first, offerings second*. For a directory whose JOB is "what can I book," that is backwards.
3. **Offerings live behind a pill TAB BAR** (Upcoming / Events / Trips / Experiences / About) that shows ONE bucket at a time as a single-column list. On desktop it's a centered 620px column — a stretched phone, no real grid. A brand with 10 offerings across 3 types forces the buyer to tab-hunt.
4. **No desktop information architecture** — `maxWidth: 620` everywhere; the whole page is a narrow centered column on a 1440px screen. Acres of dead space.
5. **Theming is already correct** (it reuses `createThemePalette` + `resolveTheme` + `ThemeEntranceAnimation` + themed font) — this is the one thing to KEEP verbatim. The redesign is an IA + layout + immersion upgrade, not a theming fix.

### Current → improved (3 bullets)
- **Tab-hidden offerings → directory-first hub.** Offerings become the spine of the page (a sectioned, count-aware grid, upcoming first), surfaced immediately under the identity instead of buried behind an About-default tab bar. The segmented control becomes a *filter over a visible grid*, not a *switch that hides 3 of 4 buckets*.
- **Flat 380px banner → immersive parallax cover with the overlapping rounded body seam.** Reaches 1:1 visual parity with the approved event/trip hero (pinned cover, content slides over, floating X+Share chrome) — the buyer can't tell the brand page and the trip page were designed by different hands.
- **Stretched 620px phone column → true desktop 2-column shell.** A real multi-column offerings directory on the left; a sticky brand-summary panel on the right (identity + socials + Share/Contact + featured next-offering) — the brand-page analogue of the trip page's sticky Reserve card, but a SUMMARY, never a checkout.

---

## C. Reimagined IA & layout

### C.1 Reading order (phone, top → bottom)
hero cover (parallax, pinned) → **identity** (avatar + verified eyebrow + name + address) → tagline → bio (clamped 4 lines + "Read more") → social chips (wrapping, only-present) → **featured next-offering teaser** (real `upcoming[0]`) → **offerings directory** (sticky segmented filter + count-aware grid, upcoming first, past dimmed at bottom) → contact (email/phone) → footer space.

This puts the *bookable* content high (featured + directory) while keeping the brand story (tagline/bio) as the lead — the inverse of today's About-default.

### C.2 Desktop (≥1024px) two-column shell
- Single centered shell, `max-width: 1200px`, hero contained at 21:9 (`max-height 460`), rounded 24, identity overlaid bottom-left ON the hero (avatar + verified + name + address) — the in-body phone identity is hidden.
- `.shell` = `grid-template-columns: minmax(0,1fr) 360px; gap: 40px`.
  - **LEFT (≈1fr) = the offerings directory** — sticky segmented filter + a **2-column card grid** (scales to 3-col cap-room on ultra-wide if desired; mockup ships 2-col), past dimmed at the bottom.
  - **RIGHT (360px, `position: sticky; top: 24px`) = the brand summary panel** — 4px accent top-stripe, avatar + name + address, tagline, short bio, social chips, **Share + Contact action buttons**, and a featured "Next up" offering card. **No Reserve, no payment, no Follow.**

### C.3 Token grid (inherited from Direction A §1.3)
- Spacing 4/8/16/24/32 (8pt rhythm). Radius cards 14–16, pills 999, body seam 28, hero desktop 24.
- Type scale: brand name 30 (phone) / 42 (desktop hero) / 22 (panel) · tagline 19/16 · bio 15/14 · section head 20–22 · card title 17 · eyebrow/label 10–11 / 900 upper / 1.2–1.6 letter-spacing.
- Touch targets ≥44pt (chrome buttons 40 → use hitSlop 8 as today; social chips 44; filter segments 44+; cards full-area; desktop action buttons 44+).
- Color is never the only indicator: spots-left uses an accent badge WITH text; booking-closed uses a neutral badge WITH "Booking closed" label; past uses opacity AND a "Past" header.

### C.4 Offerings directory — count-aware behavior
- **Filter buckets render only when populated** (mirrors today's `visibleTabs` logic — `PublicBrandPage.tsx:393`). "Upcoming" = all upcoming interleaved; Events/Trips/Experiences filter to one type. Counts shown in each segment (`countForTab` — `:487`).
- **Grid is count-aware:** 1 col phone; 2-col desktop. (Optional density: 3-col on ≥1440px if a brand is offering-dense — flagged §G, not in mockup.)
- **Upcoming first, past dimmed** under a "Past" header at the end of the filtered set (the filter hides the Past header when its section is empty — see mockup `showFilter`).

---

## D. Theming map (inherited verbatim from the event/trip engine — KEEP)
accent → verified eyebrow, social chips, filter active band + segments, featured-teaser fill, card date/price emphasis, badges, avatar border, contact icons, desktop action buttons, panel top-stripe. Font → brand name, tagline, section heads, card titles. Page light/dark + ALL text colors → `createThemePalette` (already wired). Entrance animation → `ThemeEntranceAnimation` keyed `brand:${slug}:${color}:${font}` (already wired — `PublicBrandPage.tsx:708`). **Do not invent a second theming path.** The redesign reuses the existing palette/theme machinery exactly; only the layout/IA around it changes.

---

## E. Every state

| State | Phone | Desktop |
|---|---|---|
| **Loading** | Skeleton: cover shimmer + avatar circle + name bar + 2 tagline/bio bars + filter bar + 4 card skeletons. (Today: bare spinner — `index.tsx:33`. Upgrade to a skeleton matching the layout, no content jump.) | Same skeleton in the 2-col shape (cover + left grid skeletons + right panel skeleton). |
| **Error** | Centered "Brand could not load — refresh or try the link again" (preserve `index.tsx:42`). | Same. |
| **Not found** | `PublicBrandNotFound` (preserve). | Same. |
| **No cover media** | Hero falls back to `heroColor` (accent-derived hue, `PublicBrandPage.tsx:417/536`); identity still legible over the scrim. | Same; contained hero shows the hue fill. |
| **Cover is video** | `EventCoverMedia` autoplay-muted; a circular **Mute** button appears beside Share in the chrome row (X + Mute + Share). When cover is image/gif: chrome is X + Share only. (See §F.) | Same chrome on the contained hero. |
| **No tagline / no bio** | That line is omitted (rule 9 — already guarded `:595/606`). | Same; panel omits the missing line. |
| **No social links** | Social row omitted entirely (already guarded `:788`). | Panel omits the social row. |
| **No contact** | Contact block omitted (already guarded `:1426`). | Panel "Contact" action hidden if no email/phone. |
| **No offerings (empty brand)** | Filter bar + featured teaser + directory hidden; friendly Mingla-voice empty: "Nothing on the calendar yet — Wander hasn't posted any public events, trips or experiences. Follow on Instagram or check back soon." Identity + socials + contact still render (the page is still a valid profile). | Same empty in the left column; right panel shows identity + socials + Share/Contact (no "Next up"). |
| **Few offerings (1–2)** | Single-bucket grid, NO segmented filter (nothing to filter); featured teaser hidden when only 1 (it would duplicate the single card). | Same; right panel "Next up" = the one card. |
| **Many offerings** | Full filter bar + featured teaser + multi-section grid + past. | 2-col directory + sticky panel + "Next up". |
| **Verified venue** | "Verified venue" accent eyebrow above name (preserve `:568`). | Eyebrow on the hero overlay (white on image). |
| **Trip card scarcity / closed** | spots-left accent badge / "Booking closed" neutral badge (preserve `:1135–1167`). | Same on grid cards. |

---

## F. The mute + Follow decisions (the two brand-page-specific calls)

1. **Mute control — conditional, not default.** The brand cover IS the same `EventCoverMedia` and CAN be a video (`coverMediaType` supports `video`), but the CURRENT public brand page renders **no sound control** — only X + Share chrome (`PublicBrandPage.tsx:505–516`). The brief said "a brand page has no cover audio, so likely NO mute." Resolution: **render the circular Mute button (event-page `VolumeGlyph`, identical to the trip page) ONLY when `coverMediaType === "video"`**, slotted left of Share in the chrome row. For image/gif covers (the overwhelming majority), chrome stays X + Share exactly as today. Toggle the "Cover is video" State in the demo bar to preview. This adds parity without forcing a sound control onto static-cover brands.

2. **Follow — DOES NOT EXIST. Not rendered.** There is no follow/subscriber concept in the brand model (confirmed: no `follow`/`subscriber`/`is_following` in `types.ts`, the adapter, the store, or the renderer). The desktop sticky panel therefore carries **Share (primary) + Contact** action buttons + a featured "Next up" offering — the real, buildable analogue of the trip page's sticky card. **If Seth wants Follow, it is a net-new feature (schema + edge fn + auth), a separate ORCH — flag it, do not fabricate it in this redesign.**

---

## G. Open questions for review
1. **Brand category chip** — render `venueCategory` (restaurant / play / creative & arts) as a real chip near the identity? It exists in the payload but is unused today. (Recommend: yes, small accent chip beside the address — cheap, real, adds scanability.)
2. **Grid density** — 3-column on ultra-wide (≥1440px) for offering-dense brands, or keep 2-col? (Mockup ships 2-col; 3-col is a one-line `grid-template-columns` change.)
3. **Featured teaser source** — `upcoming[0]` (mixed, soonest) vs the soonest *paid* offering? (Mockup uses `upcoming[0]` = soonest, matching today's `NextOfferingTeaser` which already uses `upcoming[0]` — `PublicBrandPage.tsx:622`.)
4. **About as a section vs a tab** — the redesign folds About (bio) into the identity lead and drops the standalone About tab. Confirm we're comfortable retiring the explicit "About" tab (its content — bio + contact — is now always-visible in the body/panel).

---

## H. Per-surface deltas (web vs in-app RN)
- **Web (`/b/...` react-native-web):** hero full-bleed to viewport top (the documented `orch-strict-grep-allow` status-bar-overlap aesthetic — `index.tsx:9`). Hover lifts on cards + action buttons (no layout shift). Page centers at 1200px on desktop.
- **In-app RN:** no hover; `safeAreaInsets.top` pads the floating chrome (already passed as `chromeTopOffset={insets.top + 8}` — `PublicBrandPage.tsx:312`); sticky desktop panel is web-only (in-app is phone single-column).
- **Android glass policy:** the identity card, filter band, and offering cards use translucent fills on iOS; on Android use the opaque ≥0.92 frosted fallback via `Platform.select` + `overflow:'hidden'` + no Android shadow under a rounded fill (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`). The existing renderer already uses `GlassBlur` with a `glassTint`; the build keeps the opaque-Android values. Mockup shows the iOS translucent look.

## I. Deliverables
- **`BRAND_DIRECTION_A_RESPONSIVE.html`** — responsive phone↔desktop interactive mockup (brand swatches + font + State picker), all real fields, sticky brand-summary panel (no Follow), count-aware offerings directory.
- **This spec** — field inventory (§A), current-vs-reimagined (§B), IA/layout (§C), theming map (§D), every state (§E), the mute/Follow calls (§F), open questions (§G), per-surface deltas (§H).
