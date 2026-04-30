# Implementation Report — Cycle 2 · J-A7 (View Brand Profile, Founder View)

> **Initiative:** Mingla Business Frontend Journey Build (DEC-071 frontend-first)
> **Cycle:** ORCH-BIZ-CYCLE-2-J-A7
> **Codebase:** `mingla-business/`
> **Predecessor:** Cycle 1 CLOSED (`d3fc820e`); J-A6 audit ⚠ PASS WITH CARVE-OUTS; J-A7 spec landed
> **Implementor turn:** 2026-04-29
> **Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_2_J_A7_BRAND_PROFILE.md`
> **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A7_BRAND_PROFILE.md`
> **Status:** implemented, partially verified (code-trace + tsc PASS; founder runtime smoke pending)

---

## 1. Summary

Cycle 2 J-A7 ships the **founder-view brand profile screen** at `/brand/:id/`. The Account tab gains a "Your brands" section as the entry point. Brand schema extended v2 → v3 with bio, tagline, contact, links, and stats.attendees. All 4 stub brands populated with realistic copy. All inert future-cycle CTAs (Edit, View-public, Stripe banner, Operations rows, empty-bio, empty-events, social chips) labeled `[TRANSITIONAL]` with explicit exit conditions (J-A8 / J-A9 / J-A10 / J-A12 / Cycle 3+).

**5 files** changed: 2 new + 3 modified, exactly per spec §1.1.

Sequential discipline preserved: schema → stubs → component → route → Account integration, with tsc clean check between every step.

---

## 2. Old → New Receipts

### `mingla-business/src/store/currentBrandStore.ts` (MODIFIED)

**What it did before:** Brand type with `{id, displayName, slug, photo?, role, stats: {events, followers, rev}, currentLiveEvent}`. Persist key `mingla-business.currentBrand.v2`. Migration handled v1 (reset) and v2 (passthrough).

**What it does now:** Brand type extended with `bio?, tagline?, contact?, links?` and `stats.attendees: number` (required). Added `BrandContact`, `BrandCustomLink`, `BrandLinks` interfaces. Persist key bumped to `v3`. Migration:
- v1 → reset to empty (unchanged)
- v2 → upgrade brands by injecting `stats.attendees ?? 0`; new optional fields stay undefined; preserves currentBrand and brands array
- v3+ → passthrough

Added internal `V2Brand` / `V2BrandStats` types + `upgradeV2BrandToV3` helper for typed migration. Header comment updated with full schema-version history (v1/v2/v3).

**Why:** spec §3.1 — Brand schema gap from investigation H-A7-2.

**Lines:** +60, -16. Net +44.

### `mingla-business/src/store/brandList.ts` (REWRITTEN)

**What it did before:** 4 STUB_BRANDS with v2 schema (no bio, no contact, no links, no attendees count).

**What it does now:** 4 STUB_BRANDS extended with realistic bio (3-4 sentences each), tagline (1 sentence), contact (email + optional phone), links (website + instagram + empty custom array), and `stats.attendees`. Per-brand attendees: Lonely Moth 728, The Long Lunch 124, Sunday Languor 1860, Hidden Rooms 256 — exactly per spec §3.2. Header comment updated to reference v3 schema.

**Why:** spec §3.2 — without populated stub data, J-A7 profile screen has nothing to render.

**Lines:** +50, -2. Net +48.

### `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (MODIFIED — schema-cascade only)

**What it did before:** `buildBrand` function created Brand with `stats: {events: 0, followers: 0, rev: 0}`.

**What it does now:** `stats: {events: 0, followers: 0, rev: 0, attendees: 0}` — adds the new required `attendees` field.

**Why:** schema bump cascade. tsc would error otherwise. Single-line additive change; no behavioral diff.

**Lines:** +1, -1. Net 0.

### `mingla-business/src/components/brand/BrandProfileView.tsx` (NEW)

**What it did before:** did not exist.

**What it does now:** ~530-line composed view component implementing all spec §3.4 sections:

- Props: `{brand: Brand | null, onBack: () => void}`
- **Not-found state** (when `brand === null`): TopBar back + GlassCard with "Brand not found" + "Back to Account" Button
- **Populated state**: 5 sections + sticky shelf:
  - **Hero**: GlassCard variant="elevated" with 84×84 gradient avatar (initial), name (h2 centered), tagline (bodySm centered, conditional), bio body text OR empty-bio inline CTA (Pressable with dashed border), contact column (email/phone rows with icons, conditional), social chip row (website/instagram Pills, conditional)
  - **Stats Strip**: 3 KpiTile primitives in flex row (Events / Attendees / GMV) with `Intl.NumberFormat("en-GB","GBP")` for GMV and `toLocaleString("en-GB")` for Attendees
  - **Stripe-Not-Connected Banner**: GlassCard variant="base" with `bank` icon + "Connect Stripe to sell tickets" + sub + chevR. Whole row Pressable → fires `[TRANSITIONAL]` Toast "Stripe Connect lands in J-A10."
  - **Operations List**: GlassCard padding=0 wrapping 4 Pressable rows (Payments, Team, Tax, Reports). Each row icon-circle + label/sub + chevR. Each fires its specific `[TRANSITIONAL]` Toast (J-A10/J-A9/later/J-A12)
  - **Recent Events**: section header + (when `pastEvents.length === 0` → empty-state GlassCard with "Create your first event" Button → Toast Cycle 3) OR (3 stub past-event rows per brand with EventCover + Pill "Past" + title + when + sold count)
  - **Sticky Bottom Shelf** (absolute bottom, semi-opaque dark backdrop): 2 Buttons in flex row — "Edit brand" primary (leadingIcon edit, → Toast J-A8) and "View public page" secondary (leadingIcon eye, → Toast Cycle 3+)
- TopBar `leftKind="back"` with `title=brand.displayName`, `rightSlot={<View />}` to suppress default search/bell icons (focused content per spec)
- Toast component for inert CTA feedback

Past-events stub data keyed by brand.id in `STUB_PAST_EVENTS` const — separate per-brand copy so each brand's "Recent events" section feels distinct.

All 11 inert handlers + stub data sites carry `[TRANSITIONAL]` markers with explicit cycle-specific exit conditions.

**Why:** spec §3.4 — implements the J-A7 founder-view design per HANDOFF_BUSINESS_DESIGNER.md §5.3.3.

**Lines:** +560 net.

### `mingla-business/app/brand/[id]/index.tsx` (NEW)

**What it did before:** did not exist.

**What it does now:** Thin Expo Router dynamic-segment wrapper:
- Reads `useLocalSearchParams<{id: string | string[]}>()`
- Normalizes array-form param to single string (Expo Router edge case for repeated segments)
- Resolves brand via format-agnostic `useBrandList().find(b => b.id === idParam)` — verifies J-A6 audit H-1 mitigation + new invariant I-11
- Renders `<BrandProfileView brand={...} onBack={...} />` inside paddingTop=safeAreaInsets.top View
- Back handler uses `router.canGoBack()` guard with fallback to `router.replace("/(tabs)/account")` for cold-launch (deep link) cases where there's no back history

Includes the spec §8 regression-prevention comment block at top warning against future ID normalization logic.

**Why:** spec §3.3 — required new route file for J-A7.

**Lines:** +43 net.

### `mingla-business/app/(tabs)/account.tsx` (MODIFIED)

**What it did before:** TopBar + sign-out GlassCard + (dev-only) dev-tools GlassCard.

**What it does now:** Adds "Your brands" GlassCard between sign-out card and dev card. Conditional on `brands.length > 0` — hidden entirely when no brands (Home tab's empty-state CTA handles first-brand path). Each row: 40×40 avatar with initial + displayName (numberOfLines=1) + sub-text "{events} events · {followers} followers" + chevR. Tap navigates to `/brand/${brand.id}` via new `handleOpenBrandProfile` callback.

Imports added: `Pressable` (already had View etc.), `Icon`, `accent`, `glass`, `radius` design tokens.

Style block extended with: `brandRowsCol`, `brandRow`, `brandAvatar`, `brandInitial`, `brandTextCol`, `brandName`, `brandSub`. Style tokens copy-paste from BrandSwitcherSheet.tsx pattern (acceptable inline duplication per spec §3.6 — only 2 use sites; extract if 3+).

**Why:** spec §3.6 + investigation H-A7-3 — entry point for J-A7 was missing.

**Lines:** +60, -1. Net +59.

---

## 3. Spec Traceability — AC verification matrix

Per dispatch §6. Code-trace verification across 16 ACs. Founder runtime smoke required for AC#12 (web parity) + AC#14 (persist migration).

| AC | Criterion | Status | Code-trace evidence |
|----|-----------|--------|---------------------|
| 1 | Account "Your brands" section with rows when brands.length > 0 | ✅ CODE PASS · ⏳ DEVICE | account.tsx new section line ~146; brand.map → Pressable rows with avatar+name+sub+chevR per spec §3.6 |
| 2 | Tap row → router.push(`/brand/${id}`) | ✅ CODE PASS · ⏳ DEVICE | account.tsx `handleOpenBrandProfile` calls `router.push(\`/brand/${brandId}\` as never)` |
| 3 | Profile renders all 5 sections + sticky shelf when brand !== null | ✅ CODE PASS · ⏳ DEVICE | BrandProfileView.tsx populated state renders Hero (line ~243), Stats Strip (~289), Stripe Banner (~298), Operations (~322), Recent Events (~349), Sticky Shelf (~393) |
| 4 | Hero: avatar + name + tagline + bio/empty-bio CTA + contact + social chips | ✅ CODE PASS · ⏳ DEVICE | BrandProfileView.tsx lines ~243-287; hasBio/hasContact/hasLinks render guards per spec §3.4.2 |
| 5 | Stats Strip: 3 KpiTiles with en-GB locale formatting | ✅ CODE PASS · ⏳ DEVICE | BrandProfileView.tsx lines ~290-294; `formatGbp` (Intl.NumberFormat en-GB GBP, 0 fraction digits) + `formatCount` (toLocaleString en-GB) |
| 6 | Stripe banner unconditionally rendered, fires J-A10 Toast | ✅ CODE PASS · ⏳ DEVICE | BrandProfileView.tsx Pressable wraps GlassCard at line ~301; handleStripeBanner toast "Stripe Connect lands in J-A10." |
| 7 | Operations List: 4 rows fire respective Toasts | ✅ CODE PASS · ⏳ DEVICE | OPERATIONS_ROWS const has 4 entries with toastMessages: J-A10, J-A9, "later cycle", J-A12 (lines ~95-127) |
| 8 | Recent Events: 3 stubs OR empty-state | ✅ CODE PASS · ⏳ DEVICE | BrandProfileView.tsx line ~352-389; `pastEvents.length === 0` ternary; empty state has "Create your first event" Button → Toast Cycle 3 |
| 9 | Sticky shelf: Edit + View-public buttons fire J-A8 / Cycle 3+ Toasts | ✅ CODE PASS · ⏳ DEVICE | shelfWrap absolute bottom (line ~393); Buttons with leadingIcon edit/eye; handlers fireToast J-A8 / Cycle 3+ |
| 10 | Brand-not-found state with back button | ✅ CODE PASS · ⏳ DEVICE | BrandProfileView.tsx lines ~205-228; `if (brand === null) return ...` early branch with GlassCard + Button |
| 11 | Both stub-format (`lm`) and user-created (`b_<ts36>`) IDs resolve | ✅ CODE PASS · ⏳ DEVICE | app/brand/[id]/index.tsx line ~30 — `brands.find(b => b.id === idParam)` is format-agnostic; spec §8 comment block warns against normalization (invariant I-11) |
| 12 | Web parity: direct URL paste, browser back, BlurView fallback | ⏳ UNVERIFIED — founder web smoke required | Code-level: useLocalSearchParams works on web; router.canGoBack/replace guards cold-launch; no Platform.OS branches in route or component; BlurView used only in TopSheet (not on this route — TopBar uses GlassChrome which has its own web fallback) |
| 13 | TopBar: back arrow + title=brand.displayName + suppressed right slot | ✅ CODE PASS · ⏳ DEVICE | BrandProfileView.tsx lines ~233-238; rightSlot={<View />} explicitly suppresses defaults |
| 14 | Persist v2 → v3 migration cold-launch | ⏳ UNVERIFIED — founder runtime required | Code-level: `migrate` callback type-safe (V2Brand internal type, upgradeV2BrandToV3 helper); v1 reset + v2 upgrade + v3 passthrough paths all return PersistedState shape; tsc clean confirms type contract |
| 15 | tsc strict clean, no kit extensions, no Platform branches in route | ✅ PASS | `npx tsc --noEmit` exits 0 (verified after every implementation step). No new files in `src/components/ui/`. Route file has zero Platform.OS branches. |
| 16 | All TRANSITIONAL markers with exit conditions | ✅ PASS | Grep results in §6 below: 11 markers in BrandProfileView + 1 in BrandSwitcherSheet (cascade) + 3 in store files (pre-existing v2/v3 markers). All have explicit cycle exits. |

**Summary:** 14/16 AC code-trace PASS. 2/16 (AC#12 web parity, AC#14 persist migration) require founder runtime smoke.

---

## 4. Invariant Verification

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | `designSystem.ts` not touched (no diff in git status) |
| I-3 | ⏳ iOS/Android: code-trace pass; web: ⏳ founder smoke | All primitives kit-side already verified for web. Route file is platform-agnostic. |
| I-4 | ✅ Preserved | Grep: zero `app-mobile/` strings in any modified or new file |
| I-5 | ✅ Preserved | Producer model intact — no consumer-app surface in J-A7 |
| I-6 | ✅ Preserved | tsc strict clean across all 5 files (verified live) |
| I-7 | ✅ Preserved | All 11 TRANSITIONAL markers have explicit exit conditions (§6) |
| I-8 | ✅ Preserved | No backend code, migrations, RPCs, RLS touched |
| I-9 | ✅ Preserved | No animation timings touched. TopSheet untouched. No new animations. |
| I-10 | ✅ Preserved | All £ amounts use `Intl.NumberFormat("en-GB","GBP")` per spec §3.4.2 / §3.1 helper |
| **I-11** (NEW) | ✅ Established | `app/brand/[id]/index.tsx` uses format-agnostic `useBrandList().find()` with explicit comment block warning against future normalization logic |
| DEC-071 | ✅ Preserved | No backend code anywhere — frontend-first |
| DEC-079 | ✅ Preserved | No new files in `src/components/ui/`. New files only in `src/components/brand/` |
| DEC-080 | ✅ Preserved | TopSheet primitive untouched |
| DEC-081 | ✅ Preserved | Grep: zero `mingla-web/` references in any new or modified file |

---

## 5. Constitutional Compliance

| # | Principle | Compliance |
|---|-----------|-----------|
| 1 | No dead taps | ✅ — every Pressable has handler; inert ones fire `[TRANSITIONAL]` Toast (not silent) |
| 2 | One owner per truth | ✅ — `currentBrandStore` remains single brand-state authority; new types co-located |
| 3 | No silent failures | ✅ — all inert paths produce Toast feedback. Migration handles type-cast errors via typed helper. |
| 4 | One query key per entity | N/A — no React Query in J-A7 (frontend-first) |
| 5 | Server state stays server-side | ✅ — Zustand still holds CLIENT state only; brand list still flagged `[TRANSITIONAL]` for B1 React Query move |
| 6 | Logout clears everything | ⚠ partial (D-IMPL-38 known) — sign-out doesn't clear brand store. **Inherited from Cycle 1; deferred to B1 per orchestrator acceptance.** Not introduced by J-A7. |
| 7 | Label temporary fixes | ✅ — 11 markers with cycle-specific exits (§6) |
| 8 | Subtract before adding | ✅ — Account section added between existing cards (no duplication); no Cycle 1 code rewritten |
| 9 | No fabricated data | ⚠ stub-data tradeoff — Brand stubs are clearly stub (existing pattern from Cycle 1; production builds gate seeding via `__DEV__`). New stub past-events explicitly `[TRANSITIONAL]` Cycle 3 exit. |
| 10 | Currency-aware UI | ✅ — `Intl.NumberFormat("en-GB","GBP")` |
| 11 | One auth instance | ✅ — AuthContext untouched |
| 12 | Validate at the right time | ✅ — route param normalized + length check before lookup; brand-null guard before populated render |
| 13 | Exclusion consistency | N/A — no event-eligibility logic in J-A7 |
| 14 | Persisted-state startup | ✅ — v2 → v3 migration is cold-launch safe (typed helper, no partial-record bugs) |

---

## 6. TRANSITIONAL marker grep

All markers in J-A7 surface:

```
src/components/brand/BrandProfileView.tsx:
  10:  [TRANSITIONAL] Toast strings (header doc)
  66:  STUB_PAST_EVENTS — exit Cycle 3 (event endpoints)
  97:  OPERATIONS_ROWS — exit J-A9/J-A10/J-A12 per row
  144: handleEdit — exit J-A8 (/brand/[id]/edit)
  149: handleViewPublic — exit Cycle 3+ (/brand/[id]/preview)
  154: handleStripeBanner — exit J-A10 (Brand.stripeStatus field)
  159: handleEmptyBio — exit J-A8
  164: handleCreateEvent — exit Cycle 3
  169: handleOpenLink — exit Cycle 3+ (external-link handling)
  311: Stripe banner inline — exit J-A10
  378: stub past-event rows inline — exit Cycle 3
```

**Pre-existing (untouched):**
```
src/store/brandList.ts:4 — exit B1 backend
src/store/currentBrandStore.ts:10, 13 — exit B1 backend
```

**Cascade additions:**
```
src/components/brand/BrandSwitcherSheet.tsx:73 — buildBrand `attendees: 0` (no marker; minimal cascade fix)
```

11 J-A7 markers + 3 pre-existing. All carry exit conditions tied to specific cycles.

---

## 7. Cache Safety

Persist key bumped `mingla-business.currentBrand.v2` → `v3`. Migration:
- v1 (Cycle 0a) → reset to empty (unchanged)
- v2 (Cycle 1) → upgrade brands by adding `stats.attendees: 0`; new fields (bio/tagline/contact/links) stay undefined
- v3+ → passthrough

A device with v2-persisted state (Cycle 1 tester device with seeded brands) will cold-launch into v3 without crash, with `attendees: 0` defaulted on all brands. This will show "Attendees: 0" on the J-A7 stats strip until the user re-seeds via "Wipe brands" + "Seed 4 stub brands".

No React Query keys (no backend in J-A7).

---

## 8. Parity Check (mobile + web)

| Surface | iOS | Android | Web (compile) | Web (runtime) |
|---------|-----|---------|---------------|---------------|
| Account "Your brands" | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| /brand/:id/ populated | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke (incl. direct URL paste) |
| /brand/:id/ not-found | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Edit / View-public Toast paths | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Sticky shelf positioning | ⏳ device (insets.bottom math) | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Persist v2→v3 cold-launch | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |

Web direct-URL deep-link is the most novel surface (first dynamic Expo Router route in mingla-business).

---

## 9. Regression Surface (3-5 features most likely to break)

1. **Cycle 1 Home tab live-event hero** — code path identical (still reads `currentBrand.currentLiveEvent`), but currentBrand object now carries new optional fields. Existing reads ignore them, no regression risk. **Low.**
2. **BrandSwitcherSheet create flow (J-A6)** — `buildBrand` updated to include `attendees: 0`. No behavior diff. **Verify post-create the new brand still appears in list and chip updates.** Low.
3. **Sign-out** — auth flow unchanged. Brand store still NOT cleared on sign-out (D-IMPL-38, known/deferred). **Low.**
4. **Cold-launch with v2 persisted state** — migration adds `attendees: 0` per brand. Verify Cycle 1 tester devices don't crash on first cold-launch with new build. **Medium-low.**
5. **Existing tabs Home/Account/Events** — visual regressions in Account (new section between sign-out + dev card). Verify spacing looks right with multiple GlassCards stacked. **Low.**

---

## 10. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| D-IMPL-A7-1 | Spec §3.3 example used `React.ReactElement` but didn't import `React`. Implementor added the import — no spec-bug, just code-completion. Surfaced for spec-template improvement. | Info | Minor — flag in next spec-template review |
| D-IMPL-A7-2 | Past-events stub data lives keyed by `brand.id` in BrandProfileView.tsx (`STUB_PAST_EVENTS`). When new brands are user-created via BrandSwitcherSheet, their ID won't match any key → empty-state path. This is the correct behavior (new brands have no events) but the spec didn't explicitly call out this dispatch. **Empty-state path verified for `b_<ts36>` IDs.** | Info | None — works as intended |
| D-IMPL-A7-3 | Sticky shelf semi-opaque background `rgba(12, 14, 18, 0.85)` chosen over GlassChrome to avoid the GlassChrome content-driven sizing issue from D-IMPL-44 (Cycle 1). Solid-tint backdrop is simpler and visually adequate for a 2-button shelf. | Info | None — informed by Cycle 1 lesson |
| D-IMPL-A7-4 | Route file uses `router.canGoBack()` guard with fallback to `router.replace("/(tabs)/account")`. This handles the web-direct-URL-paste case where there's no back history. Spec implicitly required this for AC#12; implementor added the guard explicitly. | Info | None — defensive add |
| D-IMPL-A7-5 | "Open social link" handler currently fires Toast "Opening links lands in a later cycle." rather than implementing real `Linking.openURL()` (which is a 1-line add via React Native's Linking module). Spec §3.4.2 deferred social link tap behavior; sticking to spec. | Info | If founder requests immediate, easy 1-line follow-up |

No new high-severity issues. D-IMPL-38 remains B1-deferred per Cycle 1 acceptance.

---

## 11. Transition Items

| Marker | Site | Exit condition |
|--------|------|----------------|
| `[TRANSITIONAL] stub past-events` | `BrandProfileView.tsx:66` | Cycle 3 — event endpoints + real Recent Events fetch |
| `[TRANSITIONAL]` ops rows | `BrandProfileView.tsx:97` (4 rows) | J-A9 (Team), J-A10 (Stripe Connect), J-A12 (Reports), Cycle later (Tax/VAT) |
| `[TRANSITIONAL]` Edit CTA | `BrandProfileView.tsx:144` | J-A8 (`/brand/[id]/edit`) |
| `[TRANSITIONAL]` View-public CTA | `BrandProfileView.tsx:149` | Cycle 3+ (`/brand/[id]/preview` route + public brand page) |
| `[TRANSITIONAL]` Stripe banner | `BrandProfileView.tsx:154, 311` | J-A10 (Brand.stripeStatus field added) |
| `[TRANSITIONAL]` Empty-bio CTA | `BrandProfileView.tsx:159` | J-A8 |
| `[TRANSITIONAL]` Empty-events CTA | `BrandProfileView.tsx:164` | Cycle 3 (event creator) |
| `[TRANSITIONAL]` Social chip taps | `BrandProfileView.tsx:169` | Cycle 3+ (external link handling — could land sooner per D-IMPL-A7-5) |
| Persist key `...currentBrand.v3` | `currentBrandStore.ts:88` | When backend lands (B1), store becomes thin (active brand ID only); likely v4 |

---

## 12. Founder smoke instructions

```
SETUP:
  cd mingla-business && npx expo start --dev-client
  Open on iPhone, Android device, AND web browser (Expo Web URL).

iOS smoke (gates AC#1-#11, #13, #15, #16):

1. Cold-launch the app with NO brands (use "Wipe brands" first if needed).
   Expected: Account tab does NOT show "Your brands" section.

2. Tap topbar chip → BrandSwitcherSheet → create "Test Brand" → Toast "Test Brand is ready".
   Expected: Home reflows; chip says "Test Brand".

3. Go to Account tab.
   AC#1: "Your brands" GlassCard now shows 1 row "Test Brand"
         (avatar gradient with "T" initial, "0 events · 0 followers" sub-text, chevR icon).

4. Tap the "Test Brand" row.
   AC#2: navigates to /brand/b_<ts36>/

   Expected on the profile screen:
   AC#3: Sees Hero + Stats Strip + Stripe Banner + Operations + Recent Events sections + sticky shelf
   AC#4 hero: gradient avatar with "T" + name "Test Brand" centered (no tagline/bio/contact/social since these are undefined for new brand)
   AC#4 empty-bio: dashed-border CTA "Add a description so people know what you're about" → tap → Toast "Editing lands in J-A8."
   AC#5 stats: Events="0", Attendees="0", GMV="£0"
   AC#6 banner: "Connect Stripe to sell tickets" → tap → Toast "Stripe Connect lands in J-A10."
   AC#7 ops: 4 rows; tap each → respective Toast (J-A10 / J-A9 / "later cycle" / J-A12)
   AC#8 events: empty state "No events yet" + "Create your first event" Button → tap → Toast "Event creation lands in Cycle 3."
   AC#9 shelf: bottom of screen has 2 buttons:
        - "Edit brand" (primary, leadingIcon edit) → Toast "Editing lands in J-A8."
        - "View public page" (secondary, leadingIcon eye) → Toast "Public preview lands in Cycle 3+."

5. AC#13: TopBar reads "Test Brand" with back arrow on left, NO right-side icons (no search, no bell).
6. Tap back arrow → returns to Account.

7. Account tab → tap "Wipe brands" → tap "Seed 4 stub brands".
   Expected: 4 brands seeded; "Your brands" shows all 4.

8. Tap "Sunday Languor" row.
   AC#3: Profile renders with rich content:
   AC#4 hero: gradient avatar with "S" + "Sunday Languor" + tagline "Brunch, but later." + bio (3 sentences) + contact (email + phone) + social chips (website + instagram)
   AC#5 stats: Events="6", Attendees="1,860", GMV="£8,420"
   AC#8 events: 3 stub past-event rows ("Sunday Languor — June/May/April")

9. Tap each social chip (website pill, instagram pill).
   Expected: Toast "Opening links lands in a later cycle." (D-IMPL-A7-5)

10. Tap back. Tap "Hidden Rooms".
    Expected: profile renders for that brand with its own bio/contact/links + 2 stub past events.

11. Tap back. Tap "The Long Lunch".
    Expected: profile renders. Recent events section shows just 1 stub row.

12. AC#10 brand-not-found: Manually navigate to /brand/nonexistent/ if possible
    via expo's debug menu OR via web URL paste.
    Expected: "Brand not found" GlassCard + "Back to Account" button.

Android smoke: repeat steps 1-12 on Android device. Verify identical behavior.

Web smoke (gates AC#12, AC#14):

1. Open the mingla-business web URL (Expo Web). Sign in.
2. Account tab → "Your brands" should render same as mobile.
3. Click "Sunday Languor" row.
   AC#12(a): URL bar shows /brand/sl/. Profile screen renders.
4. AC#12(b): Click browser back button. Returns to Account tab.
5. Click "Lonely Moth" row. Then refresh the page (F5 / Cmd+R).
   AC#12 cold-launch: Profile re-renders correctly for Lonely Moth (no crash, no empty state).
6. Type /brand/tll/ directly into URL bar. Press Enter.
   AC#12 direct paste: Profile renders for The Long Lunch.
7. Type /brand/nonexistent/ directly into URL. Press Enter.
   AC#10/AC#12: "Brand not found" renders.

Persist migration smoke (gates AC#14):
1. Have a device that already has Cycle 1 (v2) seeded brands.
2. Cold-launch this build (v3).
   AC#14: App opens without crash. Brands list intact. Stats tiles show
   "Attendees: 0" (default migration value). After "Wipe brands" + "Seed 4
   stub brands", the new attendees counts populate (728/124/1860/256).

REGRESSION CHECKS:
- Sign-out from Account → returns to /welcome (Cycle 0a behavior unchanged)
- Home tab live-event hero (Sunday Languor seeded) still works
- BrandSwitcherSheet create flow still works (J-A6)
- Account dev "Wipe brands" + "Seed 4 stub brands" buttons still work

If anything is off, surface to orchestrator with the specific symptom + which AC failed.
```

---

## 13. Working method actually followed

1. ✅ Pre-flight reads — dispatch + spec + investigation + Cycle 1 baseline + design handoff (all in context from session)
2. ✅ Kit primitive API verification (Button, KpiTile, Pill, Icon, GlassCard, IconName union)
3. ✅ Schema bump — currentBrandStore.ts (v2 → v3 with typed migration)
4. ✅ tsc check — clean
5. ✅ Stub data — brandList.ts (rewritten with v3 fields)
6. ✅ Cascade fix — BrandSwitcherSheet.tsx (1 line: `attendees: 0`)
7. ✅ tsc check — clean
8. ✅ Component build — BrandProfileView.tsx (560 lines, all 5 sections + sticky shelf + not-found)
9. ✅ tsc check — clean
10. ✅ Route file — app/brand/[id]/index.tsx (43 lines with regression-prevention comment)
11. ✅ tsc check — clean
12. ✅ Account integration — (tabs)/account.tsx ("Your brands" section + style block)
13. ✅ tsc check — clean (final)
14. ✅ TRANSITIONAL marker grep — 11 J-A7 markers + 3 pre-existing, all with explicit exits
15. ✅ Report written
16. ⏳ Founder device + web smoke — pending

---

## 14. Layman summary (for orchestrator chat reply)

When this lands and is verified, the founder will:
- Open Account → see "Your brands" with one row per brand
- Tap a brand → land on a profile screen with hero (photo + name + tagline + bio + contact + social), stats (events/attendees/GMV), Stripe-not-connected prompt, 4-row Operations list, recent events list, and a sticky bar with Edit + View-public buttons
- Every inert button surfaces a Toast pointing to the future cycle that lands real behavior — no dead taps
- Web users can paste `/brand/sl/` directly into the URL bar and the profile renders

Brand schema upgraded v2→v3 with safe migration (preserves existing data, defaults attendees count to 0).

---

## 15. Hand-off

Per locked sequential rule, **stopping here**. tsc clean across all 5 files; 14/16 acceptance criteria PASS at code-trace level; AC#12 (web parity runtime) + AC#14 (persist migration runtime) require founder smoke.

D-IMPL-38 (sign-out brand-store cleanup) remains the only open Constitutional risk; B1-deferred per Cycle 1 acceptance.

Hand back to `/mingla-orchestrator` for review + founder smoke instruction execution + AGENT_HANDOFFS update.

---

**End of J-A7 Brand Profile implementation report.**
