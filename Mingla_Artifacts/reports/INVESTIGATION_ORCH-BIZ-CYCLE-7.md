# Investigation — ORCH-BIZ-CYCLE-7 — Public brand page (J-P7) + share modal (J-P9)

**Date:** 2026-05-01
**Investigator:** mingla-forensics
**Confidence:** HIGH
**Mode:** INVESTIGATE-THEN-SPEC
**Scope:** Cycle 7 = J-P7 + J-P9. **J-P8 OUT OF SCOPE** (founder steering: defer to Cycle 7b when multi-brand organiser model is concretely needed).

---

## 1 — Symptom Summary

This is a forward-looking cycle (build, not break). The "symptom" is: founders today have no shareable URL to drop in their IG bio. Cycle 6 shipped the public event surface (`/e/{brandSlug}/{eventSlug}`) but no public BRAND surface (`/b/{brandSlug}`). And Cycle 6's Share button is a bare `Share.share` / `navigator.share` call with no QR, no platform-specific deep-links, no proper modal — it works but it's thin.

Cycle 7 fills both gaps:
- **J-P7** — `/b/{brandSlug}` public brand page (the IG-bio-link surface)
- **J-P9** — Share modal (kit primitive; reusable on event + brand surfaces)

---

## 2 — Investigation Manifest

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `Mingla_Artifacts/design-package/mingla-business-app-screens/project/screen-public-brand.jsx` (216 lines, read full) | Docs (designer) | J-P7 source of truth for layout + sections + copy |
| 2 | `mingla-business/src/store/currentBrandStore.ts` (lines 1-330) | Code (schema) | Brand fields available today |
| 3 | `mingla-business/src/store/liveEventStore.ts` (full + `useLiveEventsForBrand` selector at line 183) | Code | Events-by-brand selector confirmed |
| 4 | `mingla-business/src/components/event/PublicEventPage.tsx` (Cycle 6 reference) | Code (pattern) | Reuse: floating chrome, ownsThisEvent gate, Head web-only, Share API |
| 5 | `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` (Cycle 6 route) | Code (pattern) | Mirror for `/b/[brandSlug]/index.tsx` |
| 6 | `mingla-business/src/components/brand/BrandEditView.tsx` (lines 20, 368-369) | Code (mutability) | Confirm brand slug edit-ability |
| 7 | `mingla-business/src/components/brand/BrandProfileView.tsx` | Code (sibling) | Founder-side brand fields rendered today |
| 8 | `mingla-business/src/store/brandList.ts` | Code (stub data) | Verify each brand has enough field-coverage to render the public page |
| 9 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-11 through I-16) | Docs | Confirm which invariants govern Cycle 7 |
| 10 | `Mingla_Artifacts/DECISION_LOG.md` § DEC-081 | Docs | Web served from mingla-business via Expo Web |

---

## 3 — Findings

### 🔵 OBS-1 — Brand slug is currently FROZEN by absence of edit affordance

**File:** `mingla-business/src/components/brand/BrandEditView.tsx:20, 368-369`

**Code:** Line 20 docstring: `Slug rendered read-only below photo (slug edit is §5.3.6 settings).` Line 368-369 renders the slug as plain `<Text>` (NOT TextInput), prefixed with `mingla.com/`.

**Behavior:** Founders cannot edit their brand slug from the founder UI. The slug is set at brand-creation (in `brandList.ts` stub) and never changes through any shipped path.

**Implication for Cycle 7:** Q-1 RESOLVED at H confidence. Slug stability is currently maintained by absence of an edit path. Cycle 7 spec must:
1. Add an explicit code-comment LOCK in `currentBrandStore.ts` Brand type definition: "// I-17: brand.slug is frozen at creation. NEVER add an edit path. IG-bio links depend on this."
2. Add a NEW invariant I-17 (brand-slug stability) to `INVARIANT_REGISTRY.md` mirroring the Cycle 6 event-slug pattern.

**Severity:** Observation today — the slug is de-facto frozen. Hidden flaw if anyone in a future cycle adds a "rename brand" feature without the lock.

---

### 🟡 HF-1 — Designer source includes 5 fields that don't exist in current Brand schema

**File:** `screen-public-brand.jsx` (designer) vs `currentBrandStore.ts:256-330` (current Brand type)

**Designer requires:**
- `verified` flag (line 85: `<MinglaIcon name="check" />` next to display name)
- `rating: number` (line 105: `RATING 4.9 ★`)
- `since: number` year (line 209: "Verified host on Mingla since 2022")
- `following: boolean` (line 121-127: Follow/Following CTA)
- `handle: string` separate from displayName (line 87: `@lonelymoth`)
- `location: string` (line 87: `· East London`)

**Current schema does NOT have:** `verified`, `rating`, `since`, `following`, `handle`, `location`.

**Implication:**
- `verified` — ship as `verified: false` for ALL brands (no verification infrastructure exists; would require trust-and-safety review pipeline). Hide the check icon when false.
- `rating` — DROP entirely from Cycle 7 page. Showing "4.9 ★" without a real review system is **fabricated data** (Constitution #9 violation). Defer to a B-cycle when reviews infrastructure ships.
- `since` — derive from `members[0].joinedAt` (the owner's join date) for honest data. Format as year only. Show "Verified host since YYYY" only when `members.length > 0`.
- `following` / Follow CTA — DROP entirely from Cycle 7. No follow infrastructure exists in either mingla-business or the consumer app for organiser brands. A Follow button that does nothing or stubs to a TRANSITIONAL Toast is dead-tap (Constitution #1 violation).
- `handle` — derive from `slug` directly (`@${brand.slug}`). No new field needed.
- `location` — DROP for Cycle 7. No "primary location" field on Brand. Could be derived from most-recent event venue but that's noise (a single event in a different city would change the brand "location"). Defer to B-cycle.

**Severity:** Hidden flaw if implementor follows designer literally. Spec must explicitly call out the 4 designer features being CUT for Constitution #9 compliance and document a TRANSITIONAL exit path.

---

### 🟡 HF-2 — Designer "moreH" (3-dot overflow menu) has no defined affordance

**File:** `screen-public-brand.jsx:54-57`

**Code:** Floating chrome includes `<button>...<MinglaIcon name="moreH" /></button>` with no onPress defined.

**Implication:** The 3-dot menu is decoration in the designer mock. No specified behavior. Per Constitution #1 (no dead taps), spec must EITHER (a) drop the button entirely OR (b) ship it with a defined affordance (e.g., "Report this brand", "Block this brand"). For Cycle 7 simplicity, recommend DROP. Rationale: the floating-chrome share button (paired with founder-only close per Cycle 6 pattern) covers the practical needs.

**Severity:** Hidden flaw if implementor ships the icon without behavior.

---

### 🔵 OBS-2 — `useLiveEventsForBrand` already exists and returns `LiveEvent[]`

**File:** `mingla-business/src/store/liveEventStore.ts:183-192`

**Code:**
```ts
export const useLiveEventsForBrand = (brandId: string | null): LiveEvent[] => {
  const events = useLiveEventStore((s) => s.events);
  return useMemo(
    (): LiveEvent[] =>
      brandId === null ? [] : events.filter((e) => e.brandId === brandId),
    [events, brandId],
  );
};
```

**Implication:** Cycle 7 reads its events list directly via this hook. Filter into upcoming/past via `event.date` + `event.status` ("live" / "ended" / "cancelled"). No new selector needed.

---

### 🔵 OBS-3 — `/b/` directory does not exist yet in `mingla-business/app`

**File:** `mingla-business/app/b/` — directory absent

**Implication:** Cycle 7 creates `mingla-business/app/b/[brandSlug]/index.tsx` route. Pattern mirrors `app/e/[brandSlug]/[eventSlug].tsx` (Cycle 6).

---

### 🔵 OBS-4 — PublicEventPage's existing `handleShare` is the J-P9 starting point

**File:** `mingla-business/src/components/event/PublicEventPage.tsx` lines 190-225

**Code:** Implements `globalThis.navigator.share` for web (with `clipboard.writeText` fallback) + native RN `Share.share`. Wired correctly. No QR, no platform-specific deep-links.

**Implication for J-P9:** The new `ShareModal` component WRAPS this logic — the existing two-platform code path becomes the modal's "Share via..." button. The modal adds:
- "Copy link" button (with Toast) — extracted from existing clipboard fallback
- QR code (NEW)
- Platform-specific deep-links (NEW): Twitter, WhatsApp, Email, SMS

The PublicEventPage Share IconChrome onPress changes from "call handleShare" to "open ShareModal".

---

### 🔵 OBS-5 — Cycle 6 pattern fully mirrors-able for Cycle 7

The PublicEventPage pattern (floating chrome with founder-aware close + share, Web-only `<Head>`, Sheet primitive for state-variant rendering) maps 1:1 to PublicBrandPage. Cycle 7 spec re-uses identical patterns and structural typing.

---

## 4 — Five-Layer Cross-Check (J-P7)

| Layer | Finding |
|-------|---------|
| **Docs** | Designer source `screen-public-brand.jsx` defines structure. PRD § organiser brand confirms required fields. Roadmap Cycle 7 confirms scope. |
| **Schema** | Brand schema has bio, tagline, contact, links (full social), stats, members. Missing: verified, rating, since, following, handle (computable), location. (See HF-1 for cuts.) |
| **Code** | No `/b/` route today. PublicEventPage establishes mirror-able pattern. Brand slug is read-only by absence of edit path. |
| **Runtime** | Expo Router will resolve `/b/sundaylanguor` against `app/b/[brandSlug]/index.tsx`. Verified by Cycle 6 precedent (same routing pattern). |
| **Data** | brandList stub (`brandList.ts`) seeds 4 brands (LM/TLL/SL/HR) with full bio/tagline/contact/links/stats coverage. Sufficient for full smoke. |

**No layer contradictions.** All five align on what must ship.

---

## 5 — Five-Layer Cross-Check (J-P9)

| Layer | Finding |
|-------|---------|
| **Docs** | No formal designer source for the share modal — it's a kit primitive defined here. |
| **Schema** | N/A (no schema impact). |
| **Code** | PublicEventPage handleShare is the wrap target. No existing `ShareModal` primitive. |
| **Runtime** | All target channels (copy, native share, QR render, intent-link generation) work synchronously without any backend or external API. |
| **Data** | N/A. |

---

## 6 — Strategic Decisions Resolved

| Q | Decision | Confidence |
|---|----------|-----------|
| **Q-1 — Brand slug freeze** | Slug is already de-facto frozen (no edit path). Spec explicitly LOCKS via inline comment + new invariant I-17. | H |
| **Q-2 — Past + cancelled event visibility** | Designer specifies tabs (Upcoming · Past · About). Cycle 7 ships Upcoming + Past tabs. Cancelled events HIDDEN from Past tab (filter `status !== "cancelled"`). About tab = bio + contact + social links. | H |
| **Q-3 — Empty state** | Upcoming-tab empty: "No upcoming events yet" + brand's social links as visual fallback. Past-tab empty: "No past events to show." | H |
| **Q-4 — Restricted Stripe** | Public page renders unchanged — Stripe state is a founder-side concern, not buyer-side. Buyers just see no payable tickets on the events that happen to be Stripe-blocked. | H |
| **Q-5 — Share modal channels** | Copy link · Native share (existing) · QR code · Twitter · WhatsApp · Email · SMS. All URL-scheme based, no SDKs. | H |
| **Q-6 — Share modal reuse** | Generic `{url, title, description}` props. Mounts on PublicEventPage AND PublicBrandPage. Documented as kit primitive carve-out (DEC-079-style). | H |
| **Q-7 — Founder-aware close on brand page** | Mirror Cycle 6 PublicEventPage. `ownsThisBrand = isSignedIn && userBrands.some(b => b.id === brand.id)`. Close X routes to `/(tabs)/account` (founder lands where they can edit the brand). | H |
| **Q-8 — Head web-only gate** | Mirror FX1. `<Head>` wrapped in `Platform.OS === "web"`. og:title = `${brand.displayName} on Mingla`, og:description = bio, og:url = canonical, og:image = TRANSITIONAL placeholder. | H |
| **Q-9 — Route shape** | `mingla-business/app/b/[brandSlug]/index.tsx`. Mirrors `app/e/[brandSlug]/[eventSlug].tsx` pattern + I-11 format-agnostic ID resolver. | H |
| **Q-10 — Past-event card link** | Past event cards link to `/e/{brandSlug}/{eventSlug}`. Cycle 6's `past` variant already renders the "this event has ended" state. | H |
| **NEW Q-11 — Designer features cut for honesty** | DROP rating + verified-check + Follow/Bell + location text (Constitution #9: no fabricated data; Constitution #1: no dead taps). KEEP "Since YYYY" derived from owner's joinedAt. KEEP handle = `@${slug}`. Spec documents the cuts as TRANSITIONAL with B-cycle exit conditions. | H |
| **NEW Q-12 — moreH overflow menu** | DROP entirely from Cycle 7. No defined affordance; Constitution #1. | H |
| **NEW Q-13 — QR library decision** | Add `react-native-qrcode-svg` as a dependency. Justification: small bundle, web-compatible via react-native-svg (already a dep), no native modules, ~30KB. Self-rendered = privacy-safe (URL doesn't leak to a third-party rendering API). | H |

---

## 7 — Blast Radius

**J-P7 affects:**
- NEW route `app/b/[brandSlug]/index.tsx`
- NEW components: `PublicBrandPage.tsx`, `PublicBrandNotFound.tsx`
- READS from existing `currentBrandStore` (Brand schema unchanged) + `liveEventStore` (existing `useLiveEventsForBrand`) + `AuthContext` (existing `useAuth`)

**J-P9 affects:**
- NEW component: `ShareModal.tsx` (kit primitive)
- MODIFIES: `PublicEventPage.tsx` — Share IconChrome onPress wires to modal instead of calling `handleShare` directly
- NEW dependency: `react-native-qrcode-svg`

**No invariant violations.**

**Cross-platform:** iOS + Android + Web all functional. Web pickers / Web Share API patterns from Cycle 6 + FX3.5 carry forward.

---

## 8 — Invariants Preserved + Proposed

| Invariant | Status |
|-----------|--------|
| I-11 format-agnostic ID resolver | Preserved (route reuses pattern) |
| I-12 host-bg cascade | Preserved |
| I-13 overlay-portal contract | Preserved (ShareModal uses Sheet primitive — already portal-compliant) |
| I-14 date-display single source | Preserved (event cards on brand page route through eventDateDisplay.ts) |
| I-15 ticket-display single source | Preserved (event cards on brand page route through ticketDisplay.ts) |
| I-16 live-event ownership separation | Preserved (read-only access via existing selector) |
| **I-17 (NEW PROPOSED) — Brand-slug stability** | Brand `slug` is FROZEN at brand creation. No edit path may ever be added. IG-bio links depend on this. Mirrors Cycle 6 event-slug freeze. Promote to global registry on Cycle 7 close. |

---

## 9 — Fix Strategy (direction)

For J-P7:
- Mirror Cycle 6 PublicEventPage architecture closely. Same floating chrome pattern, same `ownsThisBrand` discriminator (just one field different), same Web-only `<Head>`, same NotFound fallback.
- Tabs (Upcoming / Past / About) implemented as a 3-pill segmented control + conditional render of each tab body. Reuse the `Pill` primitive.
- Past-events list filtered + sorted descending by date, capped at last 10 with "Show more" disclosure if > 10.
- About tab renders bio + contact (email, phone if listed) + social links (mirrors BrandProfileView's existing social-links rendering).

For J-P9:
- ShareModal as Sheet-based primitive. Sheet snap = "half".
- Body sections: Copy Link button (full-width primary) → Native Share button (full-width secondary, Platform-aware label) → QR code (centered, ~200×200) → 4 platform icons row (Twitter / WhatsApp / Email / SMS).
- Each platform button opens an intent URL via `Linking.openURL` (or `window.open` on web).
- PublicEventPage + PublicBrandPage both mount `<ShareModal />` and pass `{url, title, description}` props.

---

## 10 — Discoveries for Orchestrator

**D-INV-CYCLE7-1 (Note severity)** — `verified` field absent; designer shows a check icon. Spec drops the icon for Cycle 7. When trust-and-safety pipeline ships post-MVP, add `verified: boolean` to Brand + render the check.

**D-INV-CYCLE7-2 (Note severity)** — `rating` field absent + showing it would be fabricated data. Spec drops the rating display. When reviews ship (post-MVP), add `rating: number | null` + render only when `>= 4.0` and review count `>= 10` (avoid one-bad-review distortion).

**D-INV-CYCLE7-3 (Note severity)** — Follow / Bell CTAs present in designer with no follow infrastructure. Spec drops both. When organiser-follow infra ships (consumer Mingla integration), add back.

**D-INV-CYCLE7-4 (Note severity)** — `location` field absent on Brand. Designer shows "@lonelymoth · East London". Spec drops the location text. When primary-location is added to Brand schema (or derived from a primary venue), add back.

**D-INV-CYCLE7-5 (Note severity)** — moreH overflow menu in designer with no defined affordance. Dropped from Cycle 7 (Constitution #1). Add back when "Report this brand" / "Block this brand" features ship in a trust-and-safety cycle.

**D-INV-CYCLE7-6 (Low severity)** — Adding `react-native-qrcode-svg` (a new external dep). Per `react-native-svg` already being installed, the QR library is a thin layer. Document in `package.json` review.

**D-INV-CYCLE7-7 (Low severity)** — When B-cycle backend lands and `brand.slug` becomes truly editable (e.g., for typo correction), an explicit migration path is needed: old slug → 301 redirect to new slug for a grace period to avoid breaking shared links. Out of scope for Cycle 7; flag for B-cycle planning.

---

## 11 — Confidence Level

**HIGH overall.**

- All 13 strategic decisions resolved at H confidence
- Designer source read verbatim (216 lines, all sections covered)
- Brand schema fully audited; missing fields itemized; cuts justified per Constitution #1 + #9
- Existing pattern from Cycle 6 (PublicEventPage) is 1:1 reusable for the brand page
- Zero ambiguity in route shape, props, or render logic

**What would need to change to lower confidence:** if the founder rejects the designer cuts (HF-1) and demands rating/Follow/etc. shipped, scope expands ~3-4× (would need infrastructure work for each).
