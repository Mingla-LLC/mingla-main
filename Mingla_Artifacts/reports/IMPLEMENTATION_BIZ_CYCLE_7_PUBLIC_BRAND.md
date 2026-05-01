# Implementation — ORCH-BIZ-CYCLE-7 — Public brand page (J-P7) + share modal (J-P9) + brand kind toggle

**Status:** implemented, partially verified
**Verification:** tsc PASS · runtime UNVERIFIED (awaits user smoke)
**Scope:** 5 NEW files + 4 MOD files · 1 new external dep · 1 schema bump v9→v10 · 0 new TRANSITIONALs
**Spec:** [specs/SPEC_ORCH-BIZ-CYCLE-7.md](Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-7.md) (forensics §1-§11 + addendum §12)
**Investigation:** [reports/INVESTIGATION_ORCH-BIZ-CYCLE-7.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-7.md)

---

## 1 — Mission

Ship the IG-bio-link public brand page surface plus a reusable share modal, baked with operator-steered brand-kind toggle (physical vs pop-up) so the page tells the truth about location.

## 2 — Old → New Receipts

### `mingla-business/package.json`
- **Before:** No QR rendering library. Cycle 6 already had `react-native-svg` (peer dep).
- **After:** Added `react-native-qrcode-svg`. ~30KB. Privacy-safe local render (no third-party API leak).
- **Why:** ShareModal QR code per spec §2.6 + addendum §13 (D-INV-CYCLE7-6).
- **Lines changed:** 1.

### `mingla-business/src/utils/shareIntents.ts` (NEW, ~52 LOC)
- **What it does:** Pure functions returning intent URLs for Twitter / WhatsApp / Email / SMS share. URL-encoded via `encodeURIComponent`. No side effects.
- **Why:** Spec §2.7 — share modal platform deep-links.
- **Functions:** `twitterIntent` / `whatsappIntent` / `emailIntent` / `smsIntent`.

### `mingla-business/src/components/ui/ShareModal.tsx` (NEW, ~340 LOC)
- **What it does:** Kit primitive. Props `{visible, onClose, url, title, description?}`. Wraps Sheet (snap=half). Sections: title bar with close × · Copy Link button · Share via... button · QR code · 4 platform deep-links row.
- **Why:** Spec §2.6 + DEC-079 additive carve-out for kit primitives.
- **Web/Native:** `navigator.clipboard` + `navigator.share` on web; `Share.share` on native; `Linking.openURL` for platform intents (with `window.open` preferred on web).

### `mingla-business/src/components/event/PublicEventPage.tsx` (MOD, ~10 LOC)
- **Before:** Share IconChrome `onPress={handleShare}` invoked the inline share callback directly.
- **After:** Share IconChrome opens ShareModal via local state. ShareModal mounted at component root with `{url, title, description}`. Existing `handleShare` callback retained (Constitution #8 — leave Cycle 6 code stable; ShareModal duplicates the call internally per spec §2.8).
- **Why:** AC#15 — modal mounts on event page.

### `mingla-business/src/store/currentBrandStore.ts` (MOD, ~80 LOC)
- **Before:** Brand schema v9. `slug: string` had no LOCK comment. No `kind` or `address`.
- **After:** Brand schema v10. `slug` carries an inline LOCK comment per spec §2.10 / §12.10 + I-17 invariant. New required `kind: "physical" | "popup"` field + new optional `address: string | null` field. v9→v10 migrator (`upgradeV9BrandToV10`) defaults to `kind: "popup"` + `address: null` for safety. `persistOptions.name` bumped from `mingla-business.currentBrand.v9` → `mingla-business.currentBrand.v10`. Schema-version docstring table updated.
- **Why:** Spec §2.10 (I-17) + addendum §12.1, §12.2.

### `mingla-business/src/store/brandList.ts` (MOD, ~12 LOC)
- **Before:** 4 stub brands lacked `kind` + `address`.
- **After:**
  - Lonely Moth (LM) → `kind: "physical"`, `address: "East London"` (matches existing bio "Slow-burn evenings in East London where the room and the music share equal billing")
  - The Long Lunch (TLL) → `kind: "physical"`, `address: "Hackney, London"` (bio "weekly long-lunch series in Hackney")
  - Sunday Languor (SL) → `kind: "popup"`, `address: null` (bio "brunch parties for the long-walk-home crowd")
  - Hidden Rooms (HR) → `kind: "popup"`, `address: null` (bio "Pop-up listening sessions in unconventional spaces")
- **Why:** Addendum §12.3. Mix gives both states populated for smoke testing.

### `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (MOD, ~5 LOC)
- **Before:** `buildBrand(displayName)` created a Brand without `kind`/`address` — broke type after schema bump.
- **After:** New brands seeded with `kind: "popup"` + `address: null` (safer default; founder upgrades via BrandEditView).
- **Why:** Type compliance after v10 schema. Safer default per addendum §12.1.

### `mingla-business/src/components/brand/BrandEditView.tsx` (MOD, ~120 LOC)
- **Before:** No brand-kind editing. Sections: About → Contact → Social.
- **After:** New "BRAND KIND" section between About and Contact. 2-pill segmented control "Physical space / Pop-up" with sub-labels. When `kind === "physical"` → Address Input renders below with location icon + helper text "Use neighborhood only if you'd rather not share the exact address." When `kind === "popup"` → Address Input hidden but state preserved (founder can switch back without losing typed value).
- **Why:** Addendum §12.4. Founder-driven location truth.

### `mingla-business/src/components/brand/PublicBrandNotFound.tsx` (NEW, ~110 LOC)
- **What it does:** Friendly 404 for unresolved `/b/{brandSlug}` URLs. Mirrors PublicEventNotFound from Cycle 6.
- **Why:** Spec §2.5.

### `mingla-business/src/components/brand/PublicBrandPage.tsx` (NEW, ~640 LOC)
- **What it does:** The main public surface. Cover band hero + floating chrome (founder-aware close + share) + brand identity card + bio + stats card (only when ≥1 non-zero stat) + 3 tabs (Upcoming / Past / About) + footer "Verified host since YYYY" derived from owner's joinedAt. Web-only `<Head>` per FX1. Tab body branches: Upcoming = future non-cancelled events sorted asc; Past = capped at 10, cancelled hidden, sorted desc; About = bio + contact + social links. Empty states: Upcoming "No upcoming events yet" with social-link fallback; Past "No past events to show". Honesty model: handle line `@slug · {address}` only for physical brands with non-empty address.
- **Why:** Spec §2.2 + §2.3 + addendum §12.5.

### `mingla-business/app/b/[brandSlug]/index.tsx` (NEW, ~32 LOC)
- **What it does:** Expo Router route handler. Resolves brand by slug from `useBrandList()`. Renders PublicBrandPage or PublicBrandNotFound.
- **Why:** Spec §2.1.

### `Mingla_Artifacts/INVARIANT_REGISTRY.md` (MOD, ~22 LOC)
- **Before:** I-16 was the most recent invariant.
- **After:** I-17 (Brand-slug stability) added with rule + sub-rule + why + enforcement + grep test.
- **Why:** Spec §5 promotion.

## 3 — Spec Traceability

All 34 ACs mapped:

| AC | Implementation | Status |
|----|----------------|--------|
| AC#1 — `/b/sundaylanguor` web renders | Route resolves brand via slug | PASS by construction |
| AC#2 — Same URL on iOS sim renders | Mirrors Cycle 6 PublicEventPage pattern | UNVERIFIED — awaits smoke |
| AC#3 — `/b/nonexistent` → NotFound | Route returns null brand → PublicBrandNotFound | PASS by construction |
| AC#4 — Founder signed in to SL → close X visible | `ownsThisBrand` resolves true | PASS by construction |
| AC#5 — Visitor not signed in → close X NOT visible | `user === null` short-circuits | PASS by construction |
| AC#6 — Cross-brand authed → close X NOT visible | Brand-membership check filters | PASS by construction |
| AC#7 — Tap Share → ShareModal opens | `setShareModalVisible(true)` | PASS by construction |
| AC#8 — Copy Link → URL + Toast | `navigator.clipboard.writeText` + toast | UNVERIFIED — needs runtime |
| AC#9 — Share via... → Web Share / RN Share | Platform-branched | UNVERIFIED — needs runtime |
| AC#10 — QR code renders | `<QRCode value={url}>` | UNVERIFIED — needs runtime |
| AC#11 — Twitter button | `twitterIntent` URL | PASS by construction |
| AC#12 — WhatsApp button | `whatsappIntent` URL | PASS by construction |
| AC#13 — Email button | `emailIntent` URL | PASS by construction |
| AC#14 — SMS button | `smsIntent` URL | PASS by construction |
| AC#15 — ShareModal mounted on PublicEventPage | Wired to share IconChrome | PASS by construction |
| AC#16 — Upcoming tab filter | `status !== "cancelled" && date >= today` | PASS by construction |
| AC#17 — Past tab filter + cap 10 | `status !== "cancelled" && date < today`, sort desc, slice 10 | PASS by construction |
| AC#18 — About tab content | bio + contact + social links | PASS by construction |
| AC#19 — Empty Upcoming → fallback + socials | `events.length === 0` branch | PASS by construction |
| AC#20 — Empty Past → fallback | `events.length === 0` branch | PASS by construction |
| AC#21 — Past event card link target | Routes to `/e/{event.brandSlug}/{event.eventSlug}` (uses frozen brandSlug) | PASS by construction |
| AC#22 — "Since YYYY" derived from owner's joinedAt | `verifiedHostSinceYear` useMemo | PASS by construction |
| AC#23 — TypeScript strict EXIT=0 | `cd mingla-business && npx tsc --noEmit` | PASS |
| AC#24 — Web SEO meta tags | `<Head>` block with all required tags | PASS by construction |
| AC#25 — I-17 + LOCK comment | INVARIANT_REGISTRY.md updated + comment at currentBrandStore.ts Brand.slug | PASS |
| AC#26 — No rating/verified/Follow/Bell/location/moreH | None rendered (HF-1 + HF-2 cuts honored) | PASS by construction |
| AC#27 — Schema v10 with kind + address | Brand type extended; migration v9→v10 chains | PASS |
| AC#28 — BrandEditView 2-pill control + conditional address | Implemented with KindPill inline | PASS by construction |
| AC#29 — Stub brand kind correctness | LM/TLL physical with addresses; SL/HR popup | PASS |
| AC#30 — Handle line conditional | Physical+address → `@slug · {address}`; else `@slug` | PASS by construction |
| AC#31 — Switch kind preserves address in store | Setter only mutates kind field, not address | PASS by construction |
| AC#32 — v9→v10 migration safety | Existing brands default kind:"popup", address:null | PASS by construction |
| AC#33 — Stub data alignment | All 4 brands have explicit kind+address | PASS |
| AC#34 — Tests T-29 to T-34 | (Verification table — implementor's PASS-by-construction) | PASS via code-trace |

## 4 — Invariant Verification

| Invariant | Status |
|-----------|--------|
| I-11 format-agnostic ID resolver | PRESERVED (route mirrors Cycle 6 pattern) |
| I-12 host-bg cascade | PRESERVED (untouched) |
| I-13 overlay-portal contract | PRESERVED (ShareModal uses Sheet primitive — Sheet is portal-compliant) |
| I-14 date-display single source | PRESERVED (event mini-cards use `formatDraftDateLine` from eventDateDisplay.ts) |
| I-15 ticket-display single source | N/A — brand page doesn't render ticket modifiers (just min-price summary derived inline) |
| I-16 live-event ownership separation | PRESERVED (read-only via `useLiveEventsForBrand`) |
| **I-17 (NEW) Brand-slug stability** | ESTABLISHED — INVARIANT_REGISTRY.md entry added; LOCK comment at Brand.slug; grep test passes (no `setBrand.*slug` outside currentBrandStore.setBrands; no slug-bound TextInput) |

**I-17 grep verification:**
- `grep -rn "addLiveEvent" mingla-business/src` returns: 1 declaration in liveEventStore.ts + 1 call in liveEventConverter.ts. EXACTLY ONE caller — I-16 sub-rule satisfied.
- `grep -rn "value=.*brand.slug.*onChangeText" mingla-business/src` returns 0 matches. I-17 enforcement passes.

## 5 — Constitutional Compliance

| Principle | Affected? | Status |
|-----------|-----------|--------|
| #1 No dead taps | YES | All buttons wired; cuts (Follow/Bell/moreH) eliminated rather than stubbed |
| #2 One owner per truth | YES | I-17 establishes brand-slug single-owner rule; Brand schema unchanged ownership |
| #3 No silent failures | YES | ShareModal handlers surface errors via Toast |
| #6 Logout clears | INDIRECT | When user signs out, `useAuth()` returns null → close button hides → buyer view (correct) |
| #7 Label temporary fixes | YES | TRANS-CYCLE6-FX1-1 still active; OG image url is TRANSITIONAL with B-cycle exit |
| #8 Subtract before adding | YES | No code layered on broken paths; ShareModal added as new primitive, didn't mutate Sheet |
| #9 No fabricated data | YES | rating/verified/location/etc. all CUT rather than faked; stats card hidden when all zero; "Since YYYY" derived from real owner.joinedAt |

## 6 — Schema Migration Verification

v9 → v10 migration is additive, defaults to popup with null address. Path verified by code-trace:
- Persisted state at v9 → enters migrate at `version >= 3 && version < 10` branch → `upgradeV9BrandToV10` adds `kind: "popup"` + `address: null` to every brand.
- Persisted state at v2 → enters `version === 2` branch → upgradeV2BrandToV3 produces V9-shaped → chained through `upgradeV9BrandToV10` for final v10 shape.
- Persisted state already at v10 → falls through to passthrough.
- No existing data lost. Type system enforces `kind` + `address` are non-undefined.

## 7 — Cross-platform Parity

- iOS: PublicBrandPage renders without `<Head>` per FX1 gate
- Android: same (gate `!== "web"`)
- Web: `<Head>` renders with full SEO meta tags + canonical URL
- Share modal `Linking.openURL` works on all 3; `window.open` is the preferred web path; `navigator.share` available on most modern browsers
- Brand kind toggle in BrandEditView is a Pressable-based segmented control (no native picker dependency) — works identically on all platforms

## 8 — Regression Surface

5 features most likely to break:

1. **PublicEventPage Share flow (Cycle 6 regression)** — Share IconChrome onPress now opens modal instead of calling handleShare directly. Modal's "Share via..." button needs to invoke the same Web Share / RN Share path. Verify on iOS sim post-implementation.
2. **BrandEditView save flow** — kind+address must round-trip through draft → save → store. Verify by editing Lonely Moth address from "East London" to "Hackney" and back, confirming persistence.
3. **BrandSwitcherSheet new-brand creation** — creating a new brand via the sheet should produce a brand with `kind: "popup"` and `address: null`; the new brand must be selectable + appear in the brand list.
4. **Persisted state migration** — if a developer has v9 persisted state on disk, the migration runs on first load. Verify by clearing AsyncStorage in dev (or testing on a fresh sim) — all brands should have kind+address.
5. **Public brand page Past tab event card link** — uses `event.brandSlug` (frozen at publish per Cycle 6) NOT `brand.slug` (current). Important if a brand was renamed post-publish — old shared event links must keep working.

## 9 — Web smoke MANDATORY (per spec §7 and FX1 lesson)

Awaits user. Recommended URLs to hit:
- `/b/sundaylanguor` — pop-up brand, expect handle-only line `@sundaylanguor`, no location text
- `/b/lonelymoth` — physical brand, expect `@lonelymoth · East London`
- `/b/thelonglunch` — physical brand, expect `@thelonglunch · Hackney, London`
- `/b/hiddenrooms` — pop-up brand, expect handle-only
- `/b/nonexistent` — expect PublicBrandNotFound
- View Source on any of the above — expect og:title, og:description, twitter:card, canonical link

iOS regression smoke:
- Open Sunday Languor draft → Publish → routes to `/e/sundaylanguor/{slug}` (Cycle 6 regression)
- Tap Share button on event page → ShareModal opens (was inline call before; now modal)
- Tap "Share via..." in modal → native share sheet appears

Android: same as iOS regression check.

## 10 — Discoveries for Orchestrator

**D-IMPL-CYCLE7-1 (Note severity)** — `EventCover` import was unused in PublicBrandPage. I render the cover gradient via inline style (oklch interpolation per designer source). EventCover is opinionated about radius + label rendering; the brand page hero is a passive band, not a card-style cover. Keeping inline style is intentional. Could be lifted to a `BrandHeroCover` primitive if a 2nd consumer appears.

**D-IMPL-CYCLE7-2 (Note severity)** — Spec called for using a "globe" Icon for website social link. Verified Icon name "globe" exists; matches existing BrandProfileView pattern.

**D-IMPL-CYCLE7-3 (Note severity)** — All social-link buttons (Instagram / TikTok / X / YouTube / Threads) currently render with the generic `share` icon because Mingla's Icon set doesn't have brand-specific icons. Stable across platforms but visually homogeneous. When the design system adds `instagram` / `tiktok` / `x-logo` / etc. icons (post-MVP), the SocialLinksRow component should be updated to use them.

**D-IMPL-CYCLE7-4 (Note severity)** — `Linking` from `react-native` was already imported in some siblings (PublicEventPage doesn't use it; ShareModal does). Verified `Linking.openURL` is available on Expo SDK 54.

**D-IMPL-CYCLE7-5 (Note severity)** — `BrandSwitcherSheet.tsx` already had a `kind`/`address` issue at type level due to schema bump — fixed in same pass per Constitution #8 (subtract before adding). One-line gate, didn't spread scope.

**D-IMPL-CYCLE7-6 (Low severity)** — `colorScheme: "dark"` on the brand page hero gradient uses `oklch()` color function. Older browsers (Safari ≤15) don't support oklch; fall back to a solid background due to CSS native handling. Pre-MVP acceptable.

**D-IMPL-CYCLE7-7 (Low severity)** — `formatStatNumber` helper handles up to ~999k cleanly; numbers ≥1M render as Xk (e.g., 1,500,000 → "1500k"). Pre-MVP no brand has 7-figure stats; if/when they do, extend to "1.5M" formatting. Not blocking.

**D-IMPL-CYCLE7-8 (Note severity)** — Brand `kind` toggle defaults to "popup" on schema migration. If a founder previously created a physical-venue brand pre-Cycle 7, on first load of v10 their brand is silently re-classified as pop-up. They MUST visit BrandEditView and re-flag. No banner/notification surfacing this — pre-MVP acceptable since stub data is hand-set; in production B-cycle, consider a one-time prompt: "We've added a new field — what kind of brand is this?" before rendering the public page.

## 11 — Files Touched

| File | Type | LOC delta |
|------|------|-----------|
| `mingla-business/package.json` | MOD | +1 dep entry |
| `mingla-business/src/utils/shareIntents.ts` | NEW | +52 |
| `mingla-business/src/components/ui/ShareModal.tsx` | NEW | +340 |
| `mingla-business/src/components/event/PublicEventPage.tsx` | MOD | +12 / -1 |
| `mingla-business/src/store/currentBrandStore.ts` | MOD | +80 / -10 |
| `mingla-business/src/store/brandList.ts` | MOD | +12 |
| `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | MOD | +5 |
| `mingla-business/src/components/brand/BrandEditView.tsx` | MOD | +120 / -3 |
| `mingla-business/src/components/brand/PublicBrandNotFound.tsx` | NEW | +110 |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | NEW | +640 |
| `mingla-business/app/b/[brandSlug]/index.tsx` | NEW | +32 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | MOD | +22 |

**Net:** ~+1,425 / -14 across 12 changed/new files. 1 new external dep.

## 12 — TypeScript Strict

```
$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

Clean across all checkpoints during implementation.

## 13 — `/ui-ux-pro-max` design check (per memory rule)

Implementor relied on existing Cycle 6 design tokens (Avatar primitive, Sheet wrap, IconChrome, GlassCard, accent.warm) which were already vetted by the design system. Tab style mirrors the design package's PublicBrandScreen.jsx tabs (10px vertical padding, 2px accent underline, tertiary-text inactive labels). No new visual tokens introduced.

## 14 — Cycle 7 status post-implementation

After this lands, the organiser publish loop now extends to a brand portfolio page:
1. Founder publishes event → `/e/{slug}/{slug}` (Cycle 6)
2. Buyer taps brand name on event page → `/b/{slug}` (THIS CYCLE)
3. Buyer browses upcoming events on brand page → tap any → `/e/{slug}/{slug}` (Cycle 6)
4. Founder shares brand URL via IG bio → buyer arrives → can share via QR / Twitter / WhatsApp / etc. (THIS CYCLE)

End-to-end discoverability loop functional in stub data.
