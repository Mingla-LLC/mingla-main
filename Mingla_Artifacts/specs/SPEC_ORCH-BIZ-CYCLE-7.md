# Spec — ORCH-BIZ-CYCLE-7 — Public brand page (J-P7) + share modal (J-P9)

**Date:** 2026-05-01
**Author:** mingla-forensics
**Investigation:** [reports/INVESTIGATION_ORCH-BIZ-CYCLE-7.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-7.md)
**Estimated effort:** ~7-9 hrs implementor + 30 min web smoke + 30 min iOS smoke

---

## 1 — Scope

This spec ships TWO journeys:
- **J-P7** — Public brand page at `/b/{brandSlug}` (the IG-bio-link surface)
- **J-P9** — Share modal (kit primitive; reusable across event + brand surfaces)

### Files affected

**NEW (5 files):**
1. `mingla-business/app/b/[brandSlug]/index.tsx` — route handler
2. `mingla-business/src/components/brand/PublicBrandPage.tsx` — main component
3. `mingla-business/src/components/brand/PublicBrandNotFound.tsx` — 404 fallback
4. `mingla-business/src/components/ui/ShareModal.tsx` — kit primitive
5. `mingla-business/src/utils/shareIntents.ts` — platform-specific intent URL helpers

**MOD (3 files):**
1. `mingla-business/src/components/event/PublicEventPage.tsx` — Share IconChrome onPress now opens ShareModal
2. `mingla-business/package.json` — add `react-native-qrcode-svg` dep
3. `Mingla_Artifacts/INVARIANT_REGISTRY.md` — promote I-17 (brand-slug stability)

**Schema:** No bumps. Brand schema unchanged for Cycle 7.

**OUT OF SCOPE:**
- 🚫 J-P8 (public organiser page) — deferred to Cycle 7b per founder steering
- 🚫 Verified flag, rating, Follow/Bell CTAs, location text, moreH overflow menu (HF-1, HF-2 — deferred per Constitution #1 + #9)
- 🚫 No new RLS / edge functions / migrations (DEC-071 frontend-first)
- 🚫 No backend dependencies — reads from existing client stores
- 🚫 No SEO crawl optimization beyond `<Head>` tags (post-MVP concern)

---

## 2 — Layer Specification

### 2.1 Route

**File:** `mingla-business/app/b/[brandSlug]/index.tsx`

**Pattern:** Mirror `app/e/[brandSlug]/[eventSlug].tsx` (Cycle 6).

```tsx
/**
 * /b/{brandSlug} — public brand page route.
 *
 * Resolves a Brand by slug. Renders PublicBrandPage or PublicBrandNotFound.
 *
 * Per Cycle 7 spec §2.1.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { useBrandList } from "../../../src/store/currentBrandStore";
import { PublicBrandPage } from "../../../src/components/brand/PublicBrandPage";
import { PublicBrandNotFound } from "../../../src/components/brand/PublicBrandNotFound";

export default function PublicBrandRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ brandSlug: string | string[] }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;

  const brands = useBrandList();
  const brand =
    typeof brandSlug === "string"
      ? brands.find((b) => b.slug === brandSlug) ?? null
      : null;

  if (brand === null) {
    return <PublicBrandNotFound />;
  }

  return <PublicBrandPage brand={brand} />;
}
```

### 2.2 Component: `PublicBrandPage`

**File:** `mingla-business/src/components/brand/PublicBrandPage.tsx`

**Props:**

```tsx
interface PublicBrandPageProps {
  brand: Brand;
}
```

**Hooks consumed:**
- `useSafeAreaInsets()` — top inset for floating chrome
- `useRouter()` — for close handler
- `useAuth()` — `user` for ownsThisBrand check
- `useBrandList()` — for ownsThisBrand membership check
- `useLiveEventsForBrand(brand.id)` — events list

**State:**

```tsx
const [activeTab, setActiveTab] = useState<"upcoming" | "past" | "about">("upcoming");
const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
```

**Computed:**

```tsx
const ownsThisBrand = useMemo<boolean>(() => {
  if (user === null) return false;
  return userBrands.some((b) => b.id === brand.id);
}, [user, userBrands, brand.id]);

const allEvents = useLiveEventsForBrand(brand.id);

const upcomingEvents = useMemo(() => {
  const now = Date.now();
  return allEvents
    .filter((e) => {
      if (e.status === "cancelled") return false;
      // Use event.date (ISO YYYY-MM-DD); treat date >= today as upcoming
      const eventDate = new Date(e.date);
      return eventDate.getTime() >= now - 24 * 60 * 60 * 1000; // include today
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}, [allEvents]);

const pastEvents = useMemo(() => {
  const now = Date.now();
  return allEvents
    .filter((e) => {
      if (e.status === "cancelled") return false; // hide cancelled per Q-2
      const eventDate = new Date(e.date);
      return eventDate.getTime() < now - 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => b.date.localeCompare(a.date)) // newest first
    .slice(0, 10); // cap at 10 — Q-2 last 10
}, [allEvents]);

const verifiedHostSinceYear = useMemo<number | null>(() => {
  const owner = (brand.members ?? []).find((m) => m.role === "owner");
  if (owner === undefined) return null;
  return new Date(owner.joinedAt).getFullYear();
}, [brand.members]);

const handleClose = useCallback(() => {
  router.replace("/(tabs)/account" as never);
}, [router]);

const canonicalUrl = `https://business.mingla.com/b/${brand.slug}`;
```

### 2.3 PublicBrandPage render structure

Sections in order (top to bottom):

1. **Cover band hero** — gradient background using brand's primary hue (derive from `brand.id` hash or use a stable token). Height 220.
2. **`<Head>` web-only block** — SEO meta tags. Wrap in `Platform.OS === "web"` per FX1.
3. **Floating chrome** (absolute, z=3, top = insets.top + spacing.sm):
   - Left: close X IconChrome — visible only when `ownsThisBrand === true`. Tap → `handleClose()`.
   - Right: share IconChrome — always visible. Tap → `setShareModalVisible(true)`.
4. **Brand identity card** (positioned over hero gradient):
   - 76×76 letter avatar (existing `Avatar` primitive, size="hero")
   - Display name (h1) + handle (`@${slug}`)
   - NO verified check (HF-1 cut)
5. **Bio paragraph** — `brand.bio ?? null`. If null, render nothing.
6. **Stats card** — 3-column grid: FOLLOWERS / EVENTS / ATTENDEES. Read from `brand.stats`. (DROPPED: rating column.)
   - Suppress entirely if `displayAttendeeCount === false` AND followers === 0 AND events === 0.
   - Otherwise render with available data.
7. **Tabs** — segmented row: Upcoming (n) · Past (n) · About. Active state = accent underline. Use existing `Pill` primitive or inline 3-pill segmented (precedent from Cycle 5 visibility picker).
8. **Tab body**:
   - **Upcoming** — list of `PublicEventCard` (mini cards) for `upcomingEvents`. Empty state: "No upcoming events yet." + social links as visual fallback.
   - **Past** — same card style, `pastEvents` list. Empty state: "No past events to show."
   - **About** — bio (full text) + contact (if email present, render mailto link; if phone present, render tel link) + social links (already-rendered in `BrandProfileView` — extract a small `BrandSocialLinks` sub-component).
9. **Footer trust strip** — "Verified host on Mingla since YYYY" using `verifiedHostSinceYear`. If null, omit. Drop "Refund policy / House rules / Report" links for Cycle 7 (no targets exist).

### 2.4 PublicEventCard sub-component

**File:** Inline in `PublicBrandPage.tsx` (not extracted as separate file unless 2nd consumer appears).

Mini event card:
- Cover thumb (96×116) — uses event.coverHue with same gradient treatment as designer
- Date + time (eyebrow): use `formatDraftDateLine(event)` from `eventDateDisplay.ts` (I-14)
- Event name (title)
- Venue or "Online event"
- "From £X" using existing currency formatter
- Status pill (sold-out / pre-sale / etc.) using existing ticket status logic
- Tap → `router.push("/e/{brandSlug}/{eventSlug}")`

### 2.5 PublicBrandNotFound

**File:** `mingla-business/src/components/brand/PublicBrandNotFound.tsx`

Mirror `PublicEventNotFound` pattern (Cycle 6). Centered icon + title "We couldn't find that brand" + body "Check the link or try again." + CTA "Browse Mingla →" routing to `/`.

### 2.6 ShareModal kit primitive

**File:** `mingla-business/src/components/ui/ShareModal.tsx`

**Props:**

```tsx
export interface ShareModalProps {
  visible: boolean;
  onClose: () => void;
  url: string;
  title: string;
  description?: string;
}
```

**Render:**
Wraps existing `Sheet` primitive (snap="half"). Sheet body contains:

1. Title bar — "Share" + close ✕ on right
2. **Copy Link** button (full-width primary). On tap: copy `url` to clipboard via `navigator.clipboard.writeText` (web) or RN `Clipboard` (native — verify if it exists in mingla-business; if not, web is the only platform with clipboard for now). Show Toast "Link copied" on success.
3. **Share via...** button (full-width secondary). On tap: invoke existing handleShare-style flow — `globalThis.navigator.share` (web) or RN `Share.share` (native).
4. **QR code** — centered ~200×200 using `react-native-qrcode-svg`. Renders the URL.
5. **Platform deep-links** — 4-icon row: Twitter, WhatsApp, Email, SMS. Each opens via `Linking.openURL`.

### 2.7 shareIntents utility

**File:** `mingla-business/src/utils/shareIntents.ts`

Pure functions (no side effects):

```tsx
const enc = (s: string): string => encodeURIComponent(s);

export const twitterIntent = (url: string, title: string): string =>
  `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`;

export const whatsappIntent = (url: string, title: string): string =>
  `https://wa.me/?text=${enc(`${title} ${url}`)}`;

export const emailIntent = (
  url: string,
  title: string,
  description?: string,
): string => {
  const body = description !== undefined
    ? `${description}\n\n${url}`
    : url;
  return `mailto:?subject=${enc(title)}&body=${enc(body)}`;
};

export const smsIntent = (url: string, title: string): string =>
  `sms:?body=${enc(`${title} ${url}`)}`;
```

### 2.8 PublicEventPage modification

**File:** `mingla-business/src/components/event/PublicEventPage.tsx`

**Change:** Replace existing Share IconChrome's `onPress={onShare}` (which calls handleShare directly) with `onPress={() => setShareModalVisible(true)}`. Mount `<ShareModal />` near the Toast at the bottom of the component. Pass `{ url: canonicalUrl(event), title: event.name, description: event.description.slice(0, 200) }`.

The existing `handleShare` callback can be REMOVED (subtracted) — its logic moves into ShareModal's "Share via..." button. Constitution #8: subtract before adding.

OR — to minimize blast radius on Cycle 6 code — keep `handleShare` intact and route ShareModal's "Share via..." button through it via a callback. This is the safer choice. **Spec mandates: keep handleShare unchanged on PublicEventPage; ShareModal duplicates the call internally.** No double-call risk because the user only chooses one button.

### 2.9 Web-only `<Head>` on PublicBrandPage

```tsx
{Platform.OS === "web" ? (
  <Head>
    <title>{brand.displayName} on Mingla</title>
    <meta name="description" content={brand.bio?.slice(0, 160) ?? brand.tagline ?? brand.displayName} />
    <meta property="og:title" content={brand.displayName} />
    <meta property="og:description" content={brand.bio?.slice(0, 200) ?? brand.tagline ?? brand.displayName} />
    <meta property="og:url" content={canonicalUrl} />
    <meta property="og:image" content={ogImageUrl(brand)} />
    <meta property="og:type" content="profile" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={brand.displayName} />
    <meta name="twitter:description" content={brand.bio?.slice(0, 200) ?? brand.tagline ?? brand.displayName} />
    <link rel="canonical" href={canonicalUrl} />
  </Head>
) : null}
```

`ogImageUrl(brand)` — TRANSITIONAL placeholder mirroring Cycle 6 pattern. Returns a static placeholder until B-cycle image upload lands.

### 2.10 Brand-slug LOCK comment

**File:** `mingla-business/src/store/currentBrandStore.ts:259`

Add a code comment above the `slug: string;` line in the Brand type:

```tsx
/**
 * URL-safe brand slug. FROZEN at brand creation per I-17.
 * NEVER add an edit path — IG-bio links and shared brand URLs
 * depend on this slug being immutable. If a future cycle needs
 * brand renaming for typo correction, ship a slug-redirect table
 * + 301 to new slug; do NOT mutate this field directly.
 */
slug: string;
```

### 2.11 INVARIANT_REGISTRY.md update

Add new I-17 entry mirroring I-16 format. See template in §5.

---

## 3 — Success Criteria

| AC | Criterion |
|----|-----------|
| AC#1 | Open `/b/sundaylanguor` in Expo Web → page renders with brand displayName, tagline, bio, social links, upcoming events list. |
| AC#2 | Same URL on iOS sim → page renders identically (modulo native-vs-web layout). |
| AC#3 | Open `/b/nonexistent-slug` → PublicBrandNotFound renders with "Browse Mingla →" CTA. |
| AC#4 | Founder signed in to SL → close X visible top-left of brand page. Tap → routes to `/(tabs)/account`. |
| AC#5 | Visitor not signed in → close X NOT visible. Only Share button on right. |
| AC#6 | Visitor signed in but not a member of SL → close X NOT visible. |
| AC#7 | Tap Share button → ShareModal opens with brand URL + title. |
| AC#8 | ShareModal "Copy Link" → URL copied + Toast "Link copied". |
| AC#9 | ShareModal "Share via..." → invokes Web Share API on web / native Share.share on mobile. |
| AC#10 | ShareModal QR code renders the URL (verifiable by scanning the QR with a phone). |
| AC#11 | ShareModal Twitter button → opens twitter.com/intent/tweet pre-populated. |
| AC#12 | ShareModal WhatsApp button → opens wa.me/?text= URL. |
| AC#13 | ShareModal Email button → opens mailto: client. |
| AC#14 | ShareModal SMS button → opens sms: composer. |
| AC#15 | ShareModal mounted on PublicEventPage → tap Share IconChrome → modal opens with EVENT URL + title. |
| AC#16 | Upcoming tab → only events with date >= today AND status !== "cancelled". |
| AC#17 | Past tab → only events with date < today AND status !== "cancelled". Capped at 10 newest. |
| AC#18 | About tab → bio + contact + social links. |
| AC#19 | Empty Upcoming tab → "No upcoming events yet." with social-link fallback. |
| AC#20 | Empty Past tab → "No past events to show." |
| AC#21 | Tap a Past event card → routes to `/e/{brandSlug}/{eventSlug}` past variant. |
| AC#22 | Footer "Verified host on Mingla since YYYY" displays year derived from `brand.members[0].joinedAt` (where role === "owner"). Suppressed if no owner-member found. |
| AC#23 | TypeScript strict EXIT=0 across all touched files. |
| AC#24 | Web SEO: View Source on a brand page shows og:title, og:description, twitter:card, canonical link. |
| AC#25 | I-17 invariant added to INVARIANT_REGISTRY.md. Inline LOCK comment present at `brand.slug` declaration. |
| AC#26 | NO rating, verified-check, Follow CTA, Bell, location, or moreH menu visible (HF-1, HF-2 cuts). |

---

## 4 — Test Cases

| Test | Scenario | Layer |
|------|----------|-------|
| T-01 | `/b/sundaylanguor` web → page renders | Full stack |
| T-02 | `/b/sundaylanguor` iOS → page renders | Native |
| T-03 | `/b/lonelymoth` (not in stub) → NotFound | Route resolution |
| T-04 | Authed-as-SL-owner → close X visible | Auth + brand membership |
| T-05 | Signed out → close X hidden | Auth gate |
| T-06 | Authed-as-LM (different brand) → close X hidden on SL page | Brand membership gate |
| T-07 | Tap close X → /(tabs)/account | Routing |
| T-08 | Tap Share → modal opens | Modal mount |
| T-09 | Copy Link → clipboard + Toast | Web Clipboard API |
| T-10 | Share via Web → navigator.share invoked | Web Share API |
| T-11 | Share via Native iOS → RN Share.share invoked | Native Share API |
| T-12 | QR renders | react-native-qrcode-svg integration |
| T-13 | Twitter intent URL correct format | shareIntents helper |
| T-14 | WhatsApp intent URL correct format | shareIntents helper |
| T-15 | Email intent URL correct format | shareIntents helper |
| T-16 | SMS intent URL correct format | shareIntents helper |
| T-17 | Upcoming tab — only future + non-cancelled events | Filter logic |
| T-18 | Past tab — only past + non-cancelled, capped 10 | Filter + sort + slice |
| T-19 | About tab — bio + contact + social links | Render |
| T-20 | Empty Upcoming → fallback copy + social links | Empty state |
| T-21 | Empty Past → fallback copy | Empty state |
| T-22 | Past card tap → /e/{slug}/{slug} past variant | Routing |
| T-23 | Footer year correctness — derived from owner.joinedAt | Computation |
| T-24 | tsc strict | Type system |
| T-25 | Brand with no bio → bio section omitted (not blank) | Null guard |
| T-26 | Brand with no `members` → footer year omitted | Null guard |
| T-27 | Web View Source check — og:* + twitter:* + canonical present | SEO |
| T-28 | iOS regression — PublicEventPage Share button still works (now via ShareModal) | Cycle 6 regression |

---

## 5 — Invariants

### Preserved
- I-11 format-agnostic ID resolver (route reuses pattern)
- I-12 host-bg cascade
- I-13 overlay-portal contract (ShareModal uses Sheet; Sheet is portal-compliant)
- I-14 date-display single source (event cards on brand page route through `eventDateDisplay.ts`)
- I-15 ticket-display single source (any ticket-status pills route through `ticketDisplay.ts`)
- I-16 live-event ownership separation (read-only access via existing selector)

### NEW — I-17 Brand-slug stability

**Rule:** `brand.slug` is FROZEN at brand creation. NO edit path may ever be added in BrandEditView, settings, or any other UI surface. Shared brand URLs (IG bio, WhatsApp, email signatures) depend on this.

**Sub-rule:** If a future cycle needs brand renaming for typo correction or rebrand, ship a slug-redirect table (oldSlug → newSlug) + a 301 redirect handler in the route layer. NEVER mutate `brand.slug` directly.

**Why:** Cycle 7 ships `/b/{brandSlug}` as the IG-bio-link surface. Founders will treat the URL as permanent. If slug ever becomes editable without a redirect path, every shared link breaks instantly. Mirrors Cycle 6 event-slug freeze.

**Established by:** Cycle 7 — ORCH-BIZ-CYCLE-7 close (2026-05-01).

**Enforcement:**
- Inline LOCK comment at `currentBrandStore.ts:259` (Brand.slug declaration).
- Header docstring on `BrandEditView.tsx` already notes slug is read-only; spec re-affirms this.

**Test that catches a regression:** `grep -rn "setBrand.*slug\|brand.slug =" mingla-business/src` — any direct mutation outside `currentBrandStore.setBrands` initialization is a violation. Also: any new TextInput bound to `brand.slug` in any `Brand*View.tsx` is a violation.

---

## 6 — Implementation Order

1. **Add `react-native-qrcode-svg` dependency** to `mingla-business/package.json` (`npm install react-native-qrcode-svg`).
2. **Create** `mingla-business/src/utils/shareIntents.ts` (pure functions).
3. **Create** `mingla-business/src/components/ui/ShareModal.tsx` (kit primitive).
4. **Modify** `mingla-business/src/components/event/PublicEventPage.tsx` — wire Share IconChrome onPress to ShareModal. Run iOS sim regression smoke at this checkpoint.
5. **Create** `mingla-business/src/components/brand/PublicBrandNotFound.tsx`.
6. **Create** `mingla-business/src/components/brand/PublicBrandPage.tsx` — the main render.
7. **Create** `mingla-business/app/b/[brandSlug]/index.tsx` — route handler.
8. **Add LOCK comment** at `currentBrandStore.ts:259` (Brand.slug).
9. **Update** `Mingla_Artifacts/INVARIANT_REGISTRY.md` — add I-17 entry per §5.
10. **Run tsc strict** (`cd mingla-business && npx tsc --noEmit`) — must EXIT=0.
11. **Web smoke** — boot Expo Web, hit `/b/sundaylanguor`, walk through tabs + share modal + close button.
12. **iOS smoke** — same surface on iOS sim. Confirm no regression of PublicEventPage.
13. **Write impl report** to `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_7_PUBLIC_BRAND.md`.

---

## 7 — Regression Prevention

1. **I-17 enforcement** — see §5 test that catches a regression. Run at every Cycle close that touches Brand schema.
2. **Founder-aware close pattern reuse** — document in code comment at `PublicBrandPage` ownsThisBrand computation: "Mirrors Cycle 6 PublicEventPage's `ownsThisEvent` pattern. If you build another founder/buyer surface, mirror this pattern again."
3. **Web `<Head>` gate** — every public-facing surface MUST gate `<Head>` to `Platform.OS === "web"` (FX1 lesson). Spec re-affirms.
4. **Implementor MUST run web + iOS smoke** before declaring "implemented." This is the same recommendation FX1's discovery D-IMPL-CYCLE6-FX1-2 made; mandatory for any runtime-config-dependent module use.

---

## 8 — Hard Constraints

- ❌ No new external libraries beyond `react-native-qrcode-svg` (justified per investigation Q-13)
- ❌ No new kit primitives beyond `ShareModal` (DEC-079-style carve-out — documented in spec §2.6 + impl report)
- ❌ No backend dependencies (DEC-071 frontend-first)
- ❌ No verified flag, no rating, no Follow/Bell, no location text, no moreH menu (HF-1 + HF-2 cuts)
- ❌ No edit path for `brand.slug` (I-17)
- ✅ Cross-platform parity: iOS + Android + Web all functional (mirror Cycle 6 patterns)
- ✅ TypeScript strict EXIT=0
- ✅ Web smoke MANDATORY before declaring "implemented"
- ✅ iOS regression smoke MANDATORY (PublicEventPage Share flow MUST still work)
- ✅ Implementor pre-flight invokes `/ui-ux-pro-max` per memory rule (visible UI surface)

---

## 9 — Estimated Scope

- `app/b/[brandSlug]/index.tsx` — ~50 LOC NEW
- `PublicBrandPage.tsx` — ~500-600 LOC NEW (matches PublicEventPage scale)
- `PublicBrandNotFound.tsx` — ~80 LOC NEW
- `ShareModal.tsx` — ~250 LOC NEW
- `shareIntents.ts` — ~30 LOC NEW
- `PublicEventPage.tsx` — ~10 LOC MOD (wire to ShareModal)
- `currentBrandStore.ts` — ~10 LOC MOD (LOCK comment)
- `package.json` — 1 line MOD (qrcode-svg dep)
- `INVARIANT_REGISTRY.md` — ~25 LOC MOD (I-17 entry)

**Total:** ~900-1100 LOC NET across 8 files (5 NEW + 3 MOD). 1 new external dep (react-native-qrcode-svg).

**Implementor wall time estimate:** 7-9 hrs.

---

## 10 — Open Questions for Orchestrator (none blocking)

- **OQ-1** — Should the brand identity card show the photo (if `brand.photo` is set) instead of the letter avatar? **Recommendation:** YES, prefer photo when present; fall back to letter avatar via existing `Avatar` primitive's `photo?` prop.
- **OQ-2** — Does the brand "Stats" card make sense pre-MVP when followers/attendees are stub data? **Recommendation:** SHOW it for SL (which has populated stats), HIDE for brands with all-zero stats. Per Constitution #9 — don't fabricate stats.

Both have safe defaults; not blocking.

---

## 11 — Dependencies

- Cycle 6 closed (Public event page exists for past-event card linkage and ShareModal wiring)
- I-16 adopted (no impact, but read-only access via `useLiveEventsForBrand` requires the store)
- DEC-081 (web shipped from mingla-business)
- DEC-079 (additive kit-primitive carve-out style — applies to ShareModal)

All satisfied.

---

## 12 — Addendum: Brand kind + address (operator-steered 2026-05-01)

**Authored by:** orchestrator post-forensics, after operator decision to bake the location problem fix into Cycle 7 instead of deferring (D-INV-CYCLE7-4 retired).

**Problem this addresses:** Designer mock shows "@lonelymoth · East London" — a location text after the handle. Forensics original §3 HF-1 cut this for Cycle 7 because Brand had no `location` field and faking it from event venues lies if the brand operates in multiple cities. Operator's product call: don't fake, don't drop — model it correctly. Two real-world brand types exist:

1. **Physical** — owns/leases a venue (a bar, brunch space, listening room). Address is fixed and public.
2. **Pop-up** — curates events across multiple venues (Sunday Languor, touring DJ collectives, supper-club operators). No fixed address.

This addendum extends Cycle 7 with a `kind` toggle on Brand. HF-1 location-text cut in §3 of the forensics report is RETIRED — replaced by this honest model.

### 12.1 Brand schema changes (additive — schema v9 → v10)

Two new fields on `Brand` type in `currentBrandStore.ts`:

```tsx
/**
 * Brand kind. Drives whether the public brand page shows a location
 * after the handle. NEW in Cycle 7 schema v10.
 *   - "physical" — brand owns/leases a venue. Public page renders address.
 *   - "popup"    — brand operates across multiple venues. No location shown.
 *
 * Required field. Defaults to "popup" on migration from v9 (safer default —
 * no fake address shown). Set per-brand in stub data; founder can edit via
 * BrandEditView.
 */
kind: "physical" | "popup";

/**
 * Public-facing address for physical brands. Free-form string (matches the
 * existing event-venue pattern). Examples: "12 Old Street, London EC1V 9HL"
 * or "Shoreditch, London". Founder controls what's public.
 *
 * Only meaningful when `kind === "physical"`. UI hides the address input
 * entirely when kind === "popup". When kind switches popup → physical,
 * any previously-entered address is preserved and re-shown (don't clear).
 *
 * NEW in Cycle 7 schema v10.
 */
address: string | null;
```

### 12.2 Migration v9 → v10

Add to the `migrate` chain in `currentBrandStore.ts`:

```tsx
if (version < 10) {
  const v9 = persistedState as { brands?: Array<unknown>; currentBrand?: unknown };
  const upgrade = (b: Record<string, unknown>): Record<string, unknown> => ({
    ...b,
    kind: typeof b.kind === "string" ? b.kind : "popup",
    address: typeof b.address === "string" || b.address === null ? b.address : null,
  });
  return {
    ...(persistedState as object),
    brands: Array.isArray(v9.brands) ? v9.brands.map((b) => upgrade(b as Record<string, unknown>)) : [],
    currentBrand:
      v9.currentBrand !== null && v9.currentBrand !== undefined
        ? upgrade(v9.currentBrand as Record<string, unknown>)
        : null,
  };
}
```

Update `version: 10` in persistOptions. Update header docstring schema-version table to record v10.

### 12.3 Stub data updates in `brandList.ts`

Set `kind` + `address` on all 4 brands. Implementor decides per brand based on existing bio + contact, with these recommended defaults:

| Brand | Kind | Address recommendation |
|-------|------|----------------------|
| Late Mornings (LM) | `physical` | Recommend implementor pick from existing brand bio/contact context (e.g., "London Fields, E8" or similar). If unclear, set as `physical` with `address: null` — founder fills in via BrandEditView at smoke time. |
| The Long Lunch (TLL) | `popup` | `address: null` (curated dinners at varying venues — bio implies nomadic) |
| Sunday Languor (SL) | `popup` | `address: null` ("brunch parties for the long-walk-home crowd" — bio implies nomadic) |
| House Riot (HR) | `popup` | `address: null` (safer default; founder edits if wrong) |

Implementor uses judgment for LM's address based on what's already in stub data; if no clear address exists, set `null` and the founder fills in at smoke. Don't fabricate.

### 12.4 BrandEditView changes

Add a "Brand kind" section between the existing "About" and "Contact" sections (or wherever it fits the existing edit flow — implementor picks based on file structure):

```tsx
{/* Brand kind — physical (with address) or pop-up (nomadic). */}
<View style={styles.field}>
  <Text style={styles.fieldLabel}>What kind of brand is this?</Text>
  <View style={styles.kindSegmentRow}>
    <KindPill
      label="Physical space"
      sub="A venue you own or lease"
      active={kind === "physical"}
      onPress={() => setKind("physical")}
    />
    <KindPill
      label="Pop-up"
      sub="Events at varying venues"
      active={kind === "popup"}
      onPress={() => setKind("popup")}
    />
  </View>
</View>

{/* Address — only when physical. */}
{kind === "physical" ? (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>Address (public)</Text>
    <Input
      value={address ?? ""}
      onChangeText={(v) => setAddress(v.length === 0 ? null : v)}
      placeholder="e.g. 12 Old Street, London EC1V 9HL"
      variant="text"
      accessibilityLabel="Brand address"
    />
    <Text style={styles.helperHint}>
      Shown to buyers on your public brand page. Use neighborhood only if you'd rather not share the exact address.
    </Text>
  </View>
) : null}
```

Implementor MAY adjust the inline `KindPill` shape to match existing segmented-pill patterns in the codebase (e.g., the When-step segmented control in CreatorStep2When). Reuse the closest precedent.

### 12.5 PublicBrandPage handle-line rendering

In §2.3 step 4 of the forensics spec, the brand identity card line was:

> Display name (h1) + handle (`@${slug}`)

Update to:

> Display name (h1) + handle (`@${slug}`) + location chip (only when `brand.kind === "physical"` AND `brand.address !== null` AND `brand.address.trim().length > 0`)

Render shape:
```tsx
<Text style={styles.handleLine}>
  @{brand.slug}
  {brand.kind === "physical" && brand.address !== null && brand.address.trim().length > 0
    ? <> · {brand.address}</>
    : null}
</Text>
```

For `kind === "popup"` brands: clean omission (no separator, no faked location). The handle line just reads `@sundaylanguor`.

### 12.6 Validation

- `kind` is required at the type level — segmented control prevents null state.
- `address` is OPTIONAL even when `kind === "physical"` — founder may not want exact address public for security reasons; the page-line rendering already guards on non-empty.

No new validation errors. No `draftEventValidation`-style rules.

### 12.7 Updated AC list (additions to forensics spec §3)

- AC#27 — Brand schema includes `kind` (required) and `address` (optional). Migration v9 → v10 passes.
- AC#28 — BrandEditView shows the 2-pill kind segmented control. Tapping "Physical space" reveals the address Input. Tapping "Pop-up" hides the address Input but preserves entered value in store.
- AC#29 — Stub data: SL/TLL/HR are `kind: "popup"` with `address: null`. LM is `kind: "physical"` with implementor-chosen address (or null if unclear).
- AC#30 — PublicBrandPage handle line renders `@{slug} · {address}` for physical brands with non-empty address. Renders just `@{slug}` for popup brands or physical-with-empty-address.
- AC#31 — Switching kind physical → popup → physical preserves the address.

### 12.8 Updated test cases (additions to forensics spec §4)

| Test | Scenario | Layer |
|------|----------|-------|
| T-29 | Physical brand with address → handle line shows location | Render |
| T-30 | Pop-up brand → handle line shows just handle (no separator) | Render |
| T-31 | Physical brand with empty address → handle line shows just handle (no fake) | Render guard |
| T-32 | Switch kind physical → popup → physical → address preserved | State persistence |
| T-33 | v9 → v10 migration → existing brands default to popup with null address | Migration |
| T-34 | Stub data verification — kinds match recommendations | Stub correctness |

### 12.9 Updated scope estimate

- BrandEditView: ~80 LOC MOD (kind segmented control + conditional address Input + state)
- currentBrandStore: ~30 LOC MOD (schema fields + v9→v10 migration)
- brandList stub: ~10 LOC MOD (4 brands × 2 fields)
- PublicBrandPage: ~5 LOC MOD (handle-line conditional)
- INVARIANT_REGISTRY: no new invariant needed (kind+address are open product fields, not stability rules)

**Net addition:** ~125 LOC across 4 file MODs. Pushes Cycle 7 total from ~900-1100 LOC to ~1050-1250 LOC. Implementor wall time: 9-11 hrs (was 7-9 hrs).

### 12.10 Implementation order update

Insert into forensics spec §6 between steps 8 (LOCK comment) and 9 (INVARIANT update):

- 8a. **Add `kind` + `address` to Brand type** in `currentBrandStore.ts` (with header docstring schema-version v10 entry).
- 8b. **Add v9 → v10 migration** to the migrate chain. Bump `version: 10` in persistOptions.
- 8c. **Update brandList stub** with kind + address per §12.3 table.
- 8d. **Add kind segmented control + conditional address Input to BrandEditView** per §12.4.
- 8e. **Update PublicBrandPage handle-line rendering** per §12.5 (this happens naturally during the §6 step 6 PublicBrandPage build — implementor merges).

### 12.11 Why this is a single-cycle bundle, not a separate cycle

- Schema bump is additive and trivial (2 fields, defaults safe)
- BrandEditView already handles many fields — adding 2 more matches existing pattern
- PublicBrandPage handle-line conditional is 5 lines
- Stub data update is mechanical
- All trade-offs are settled (operator decided 2026-05-01)
- Single coherent commit instead of "ship brand page that drops location, then ship follow-up that adds it back"

Constitution #8 alignment — we're SUBTRACTING the HF-1 cut and ADDING the honest model in one pass.
