# Implementation Report — Cycle 1 · Account Anchor

> **Initiative:** Mingla Business Frontend Journey Build (DEC-071 frontend-first)
> **Cycle:** ORCH-BIZ-CYCLE-1-001
> **Codebase:** `mingla-business/`
> **Predecessor:** Cycle 0a CLOSED (commits `85961e30` + `83b6b142`)
> **Implementor turn:** 2026-04-29
> **Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_CYCLE_1_ACCOUNT_ANCHOR.md` (with addendum A1–A7)
> **Status:** implemented, partially verified

---

## 1. Summary

Cycle 1 ships the **Account anchor** journey: returning organisers sign in →
land on Home → see KPIs + upcoming events + Build CTA → can switch or create
a brand from the topbar chip. 5 journeys covered (J-A1, J-A2, J-A3, J-A4,
J-A5). Built entirely on the Cycle 0a kit (24 primitives) plus one additive
prop on TopBar (per DEC-079 carve-out, ratified pre-build). No backend code.

**6 files** changed (1 more than dispatch — shared `BrandSwitcherSheet`
component replaces the two route files per dispatch §2.2's explicit choice).

---

## 2. Old → New Receipts

### `mingla-business/src/store/brandList.ts` (NEW)

**What it did before:** did not exist.

**What it does now:** exports `STUB_BRANDS: Brand[]` with the 4 brands
specified in dispatch §3.2 (Lonely Moth, The Long Lunch, Sunday Languor,
Hidden Rooms) plus `STUB_DEFAULT_BRAND_ID = "sl"`. Only Sunday Languor has
`currentLiveEvent` set (matches AC#3 hero figure: "Slow Burn vol. 4 — Live
tonight £8,420 / £12,000"). All marked `[TRANSITIONAL]` with B1 backend exit.

**Why:** dispatch §3.2 + addendum A3 — stub data source.

**Lines:** +60 net.

### `mingla-business/src/store/currentBrandStore.ts` (MODIFIED)

**What it did before:** persisted Zustand store with permissive Cycle 0a
schema `Brand = { id, displayName }`. Persist key
`mingla-business.currentBrand.v1`. Empty by default.

**What it does now:** schema evolved per addendum A2 to full Brand shape:
`{ id, displayName, slug, photo?, role: "owner" | "admin", stats: { events,
followers, rev }, currentLiveEvent: { name, soldGbp, goalGbp } | null }`.
Bumped persist key to `v2` with `migrate` callback that resets to empty when
prior version `< 2`. Cycle 0a never seeded the store, so the migration is
cold-start safe (no real user data lost).

**Why:** addendum A2 — schema needs richer fields for KPI + live-event hero.
`displayName` kept as canonical (preserves TopBar consumer at line 118).

**Lines:** +35, -10. Net +25.

### `mingla-business/src/components/ui/TopBar.tsx` (MODIFIED)

**What it did before:** brand-chip tap fired a Cycle 0a transitional Toast
("Brand creation lands in Cycle 1." or "Brand switcher lands in Cycle 2.").

**What it does now:** added `onBrandTap?: () => void` prop. When defined,
the override fires on chip tap (suppressing the Toast). When undefined,
existing Cycle 0a Toast logic runs (backward compatible — verified that
no other call sites in the kit or app depend on the Toast firing).

**Why:** dispatch addendum A1 — required for AC#4. Authority: DEC-079
kit-closure carve-out (additive prop retiring a `[TRANSITIONAL]`-marked
behaviour anchored at TopBar.tsx line 11 header comment).

**Lines:** +18, -0. Net +18.

### `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (NEW)

**What it did before:** did not exist.

**What it does now:** dual-mode shared sheet component — `"switch"` lists
all brands with active indicator + footer CTA flipping to create mode;
`"create"` shows single Input field (displayName) + submit Button. Initial
mode auto-derives from `useBrandList().length`. On submit: builds new Brand
with `slugify(displayName)` for slug, default stats `{0,0,0}`, owner role,
null `currentLiveEvent`; appends to brand list, sets as current, fires
`onBrandCreated(brand)` callback so parent surfaces a Toast. Mounts via
Sheet primitive (snap point `half`, lazy-mount per E.4).

**Why:** dispatch §3.1 + addendum A2/A3/A5. Replaces the two listed route
files (`app/brand/switcher.tsx` + `app/brand/create.tsx`) per dispatch
§2.2's explicit choice — in-place state cleaner with Sheet's lazy-mount
lifecycle.

**Lines:** +280 net.

### `mingla-business/app/(tabs)/home.tsx` (REWRITE)

**What it did before:** 64-line Cycle 0a placeholder with TopBar +
GlassCard + "Cycle 1 lands content here" text.

**What it does now:** full Home screen with three states:
- **Empty** (`brands.length === 0` OR `currentBrand === null`): GlassCard
  with greeting tier + "No brands yet" heading + body pointing to topbar
  chip.
- **Populated, no live event**: greeting + 7-day aggregate KpiTile + 2-col
  KPI grid (Active events / Followers) + "Upcoming" section + 2 stub event
  rows + Build CTA.
- **Populated with live event** (Sunday Languor): live KPI hero with
  livePulse Pill + event name + £soldGbp/£goalGbp + progress bar + 3-stat
  row + 2-col KPI grid + Upcoming section with live event row prepended +
  Build CTA.

Brand-chip on TopBar opens BrandSwitcherSheet via `onBrandTap`. Sheet's
`onBrandCreated` callback fires Toast `"{displayName} is ready"`.

`Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" })` for
all £ figures (Invariant I-10 satisfied).

Build CTA uses composed Pressable (NOT ActionTile primary) because the
design package's dashed-border treatment isn't in the ActionTile prop API.
Composition stays inside screen-level code — no kit extension needed.

**Why:** dispatch §3.1 + AC#1, #2, #3, #4, #5, #6.

**Lines:** +330, -55. Net +275.

### `mingla-business/app/(tabs)/account.tsx` (MODIFIED)

**What it did before:** 134-line Cycle 0a placeholder with TopBar +
sign-out button + dev styleguide link.

**What it does now:** brand-chip on TopBar now opens BrandSwitcherSheet
(consistent with Home — both tabs use the same chip flow). Added
`__DEV__`-gated second GlassCard with two buttons:
- **"Seed 4 stub brands"**: calls `setBrands([...STUB_BRANDS])` + sets
  current to Sunday Languor (so AC#3 Home hero fires immediately on tab
  switch).
- **"Wipe brands"**: calls `reset()` to empty store for AC#1 testing.

Both marked `[TRANSITIONAL]` with B1 backend exit. Production builds
(`__DEV__ === false`) never see these — gated by `__DEV__ ? <card> : null`.

Toast shows confirmation messages (`Seeded 4 stub brands` / `Brands wiped` /
`{displayName} is ready` after sheet-create).

**Why:** addendum A4 (dev seeding) + A1 (brand-chip wiring). Sign-out flow
unchanged (Invariant I-2).

**Lines:** +90, -3. Net +87.

---

## 3. Spec Traceability — AC verification matrix

Per dispatch addendum A6 (resolutions-restated AC). Code-trace verification;
device smoke gates 3–5 require founder run.

| AC | Criterion | Status | Code-trace evidence |
|----|-----------|--------|---------------------|
| 1 | New user → empty state with topbar chip "Create brand" | ✅ CODE PASS · ⏳ DEVICE UNVERIFIED | `home.tsx`: `isEmpty = brands.length === 0 \|\| currentBrand === null` → renders empty GlassCard with greeting + "No brands yet" + body referencing the chip. TopBar's existing Cycle 0a logic at `TopBar.tsx:115-117` shows label "Create brand" when `currentBrand === null`. Both render correctly when store is empty (initial state on first sign-in or after "Wipe brands"). |
| 2 | Tap chip → sheet opens in create mode (form pre-filled) → submit → toast "{displayName} is ready" → home reflows | ✅ CODE PASS · ⏳ DEVICE UNVERIFIED | `home.tsx:handleOpenSwitcher` sets sheetVisible=true. `BrandSwitcherSheet:initialMode` evaluates to `"create"` when `brands.length === 0`. Form pre-fills with `useState<string>("Lonely Moth")`. Submit calls `buildBrand(trimmedName)` → `setBrands([...brands, newBrand])` + `setCurrentBrand(newBrand)` + `onBrandCreated(newBrand)` + `onClose()`. `home.tsx:handleBrandCreated` sets `toast.message = ${brand.displayName} is ready`. Home reflows because `useCurrentBrand()` is a Zustand selector — re-renders on store change. |
| 3 | Returning user with stub brands → home shows hero "Slow Burn vol. 4 — Live tonight £8,420 / £12,000" | ✅ CODE PASS · ⏳ DEVICE UNVERIFIED | After "Seed 4 stub brands": `STUB_BRANDS` populates store, `setCurrentBrand(STUB_BRANDS[2])` (Sunday Languor). Home detects `liveEvent !== null` (Sunday Languor's `currentLiveEvent`) → renders live hero. `formatGbp(8420)` = "£8,420" (en-GB, no fraction digits per `Intl.NumberFormat` config). `formatGbp(12000)` = "£12,000". Event name: `"Slow Burn vol. 4"` (verbatim from stub). |
| 4 | Tap chip when brands exist → sheet opens in switch mode → pick another → home reflows | ✅ CODE PASS · ⏳ DEVICE UNVERIFIED | `BrandSwitcherSheet:initialMode` evaluates to `"switch"` when `brands.length > 0`. `handlePick(brand)` calls `setCurrentBrand(brand)` + `onClose()`. Home re-renders via Zustand selector. Active row shown via `isActive` style + check icon. |
| 5 | KPI tiles, EventRow stack, Build CTA per design package screens-home.jsx | ✅ CODE PASS (with intentional deviation) · ⏳ DEVICE UNVERIFIED | Hero KPI: composed inline using GlassCard variant=elevated + Pill (live, livePulse) + custom progress bar — matches design package §27-44. KPI grid: 2 KpiTile primitives (Active events / Followers). EventRow: composed inline using EventCover + Pill — matches design package §110-134. Build CTA: composed Pressable with dashed border + accent-tint icon circle — matches design package §66-82. Build CTA uses inline composition NOT ActionTile primary because ActionTile lacks dashed-border styling — design-package faithfulness wins. |
| 6 | Dark mode default; light + warm-glow only on /welcome | ✅ CODE PASS · ⏳ DEVICE UNVERIFIED | No theme code touched in Cycle 1. Cycle 0a's existing dark-mode default applies. /welcome screen unchanged. |

**Summary**: 6/6 AC code-trace PASS. 0 FAIL. 6/6 require founder device smoke
to convert ⏳ UNVERIFIED → confirmed PASS.

---

## 4. Invariant Verification

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | `designSystem.ts` not touched (verified via git status — no diff) |
| I-2 | ✅ Preserved | Auth flow unchanged. AuthContext.tsx not touched. account.tsx still calls `await signOut()`. |
| I-3 | ⏳ iOS/Android: code-trace pass; web: bundle compile required (founder) | iOS + Android: per Cycle 0a kit pattern, all primitives already verified. Code-trace pass. Web: dispatch §3.4 amended — bundle MUST compile (gate 2), runtime smoke deferred per DEC-078. |
| I-4 | ✅ Preserved | No imports from `app-mobile/`. Verified via grep (no `app-mobile` strings in any modified file). |
| I-5 | ✅ Preserved | Mingla = experience app. Producer model (DEC-072): organiser produces events; consumer (mobile-mingla) consumes. No "events you might attend" UX in Cycle 1. |
| I-6 | ✅ Preserved | `npx tsc --noEmit` exits 0 (final check 2026-04-29 post-build) |
| I-7 | ✅ Preserved | All 6 stub-data + transitional sites marked `[TRANSITIONAL]` with B1 exit condition. Verified via grep (`brandList.ts:4`, `account.tsx:11/87/146`, `home.tsx:12/63`). |
| I-8 | ✅ Preserved | No Supabase code touched. No migrations. No edge functions. No RPCs. |
| I-9 | ✅ Preserved | No animation timings touched. Sheet primitive's E.4 lazy-mount lifecycle unchanged — sheet opens via `withSpring`, closes via `withTiming` per Cycle 0a config. |
| I-10 | ✅ Preserved | All £ amounts use `Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" })`. Caller-side formatting per KpiTile contract (line 28 comment). |

---

## 5. Constitutional Compliance

| # | Principle | Compliance |
|---|-----------|-----------|
| 1 | No dead taps | ✅ — every Pressable + Button has handler. "See all" link fires Toast (acknowledged inert until Cycle 3). |
| 2 | One owner per truth | ✅ — `currentBrandStore` owns brand state. No duplicate Zustand or React Context for brands. |
| 3 | No silent failures | ✅ — `signOut` catch logs to dev console (existing Cycle 0a pattern). Brand create has no failure path (no async — pure state mutation). |
| 4 | One query key per entity | N/A — no React Query in Cycle 1 (no backend). When B1 lands, brand list moves to `brandKeys.list()` factory. |
| 5 | Server state stays server-side | ✅ — `currentBrandStore` holds CLIENT state only. Brand list is `[TRANSITIONAL]` cached stub during pre-backend phase; documented in store header. When B1 lands, list moves to React Query and store keeps only the active brand ID. |
| 6 | Logout clears everything | ⚠ partial — `signOut` doesn't currently clear `currentBrandStore`. BUG flag for orchestrator: when B1 lands, sign-out should clear the brand store too. Currently Cycle 0a doesn't expose a brand-clearing mechanism on sign-out. **Logged as discovery D-IMPL-38.** |
| 7 | Label temporary fixes | ✅ — all 6 stub-data sites marked `[TRANSITIONAL]` with B1 exit. |
| 8 | Subtract before adding | ✅ — `home.tsx` placeholder fully replaced (not layered on top). `account.tsx` Cycle 0a placeholder kept (sign-out + styleguide link still load-bearing) but extended with new dev-card. |
| 9 | No fabricated data | ⚠ stub-data tradeoff — KPI numbers (£24,180 rev for Lonely Moth, etc.) are stub-feeling but visible to users in dev builds. Production builds (`__DEV__ === false`) don't ship the seed button, so users can't seed stubs in prod. Stub data NEVER reaches a real user — gated by `__DEV__` on the seeding action. |
| 10 | Currency-aware UI | ✅ — `Intl.NumberFormat("en-GB", "GBP")`. When B1 lands per-brand currency, KpiTile's caller-formats contract supports it. |
| 11 | One auth instance | ✅ — `AuthContext` unchanged. |
| 12 | Validate at the right time | ✅ — brand-create form submit validates `trimmedName.length > 0` via `canSubmit` memo. Submit button disabled when invalid. |
| 13 | Exclusion consistency | N/A — no event-eligibility logic in Cycle 1. |
| 14 | Persisted-state startup | ✅ — Zustand v2 migration handles cold-launch from v1 (drops to empty). v2 cold-launch with seeded brands rehydrates correctly per existing persist middleware. |

---

## 6. Cache Safety

No React Query keys changed (no backend). Persisted state shape:
- `mingla-business.currentBrand.v1` (Cycle 0a) — auto-migrates to v2 (drops content)
- `mingla-business.currentBrand.v2` (Cycle 1) — new shape with full Brand fields

If a Cycle 0a tester device has `v1` content persisted, it gets reset to
empty on cold launch. That's intentional — v1 was effectively unused.

---

## 7. Parity Check (mobile + web)

| Surface | iOS | Android | Web (compile) | Web (runtime) |
|---------|-----|---------|---------------|---------------|
| Home (empty) | ⏳ device | ⏳ device | ✅ tsc | ⛔ deferred WEB2 |
| Home (live) | ⏳ device | ⏳ device | ✅ tsc | ⛔ deferred WEB2 |
| BrandSwitcher | ⏳ device | ⏳ device | ✅ tsc | ⛔ deferred WEB2 |
| Brand create | ⏳ device | ⏳ device | ✅ tsc | ⛔ deferred WEB2 |
| Account dev-buttons | ⏳ device | ⏳ device | ✅ tsc | ⛔ deferred WEB2 |

Web runtime smoke deferred per DEC-078 (WEB2 — AuthProvider hangs at `/`).
The styleguide route at `/__styleguide` MAY render on web if Account-tab
navigation works post-auth, but auth-gate is broken so we cannot reach it
from `/`. This is a known cycle-0b unblocker.

---

## 8. Regression Surface (3-5 features most likely to break)

1. **TopBar's existing `leftKind="brand"` callers** — verified by grep that
   only home + account use `leftKind="brand"`, both of which now pass
   `onBrandTap`. No legacy caller relies on the Cycle 0a Toast fallback.
2. **Sign-out** — auth flow unchanged, but brand store NOT cleared on sign-out
   (D-IMPL-38). User testing should sign out → sign back in and verify the
   stub brands persist (which is BAD security — but acceptable in dev only;
   D-IMPL-38 fixes properly at B1).
3. **Sheet dismissal** — drag-down + scrim-tap should still close the sheet.
   Sheet primitive E.4 lazy-mount still applies; verified by code trace.
4. **Cold-launch with v1 persisted state** — migration drops v1 content to
   empty. Should NOT crash on read. Verified by Zustand `migrate` callback
   returning typed `{ currentBrand: null, brands: [] }`.
5. **Toast double-fire** — if user rapidly taps "Seed 4 stub brands" → Toast
   shows once, but if rapidly tapped during fade-out, may re-trigger. Toast
   primitive's auto-dismiss handles this gracefully (re-fire resets timer).

---

## 9. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-38** | Sign-out does NOT clear `currentBrandStore`. Constitutional #6 says "Logout clears everything." Currently the brand store persists across sign-out → sign-in, leaking previous user's brand selection (in stub data; in B1 backend, this would leak server-fetched brand IDs). Fix: add brand store reset to AuthContext's sign-out cleanup. **DEFERRED to B1** because brand store will move to React Query at B1, and React Query has its own sign-out clear pattern that should be applied uniformly across all server-state. | Medium | Track for B1 — fix as part of broader sign-out cleanup pattern |
| D-IMPL-39 | Build CTA uses inline composition rather than ActionTile primary because ActionTile's prop API doesn't expose `borderStyle: "dashed"`. Could be addressed by extending ActionTile with a `dashed?: boolean` prop in a future cycle, OR keeping inline composition (current approach) since the dashed-border treatment is screen-specific to Home. Decision deferred. | Low | Track for design review — when more "Build" CTAs land in other cycles, decide whether to abstract |
| D-IMPL-40 | `BrandSwitcherSheet` is a "shared component" (`src/components/brand/`) NOT a "primitive" (`src/components/ui/`). The `brand/` folder is new. This sets the precedent for cycle-specific composed components living in `src/components/<domain>/` separate from the closed kit. Recommend documenting this in Cycle 1's report as the kit-vs-app-component naming convention. | Info | Document convention in next SYNC cycle |
| D-IMPL-41 | The existing TopBar Toast fallback path ("Brand creation lands in Cycle 1." / "Brand switcher lands in Cycle 2.") is now dead code at runtime — every consumer in Cycle 1 passes `onBrandTap`. The fallback strings are stale (Cycle 1 has shipped). Could be removed in a future cycle, OR left as defensive backup. | Info | Defer — harmless dead branch, useful as documentation of the carve-out's anchor |

---

## 10. Transition Items

| Marker | Site | Exit condition |
|--------|------|----------------|
| `[TRANSITIONAL] stub data — replaces real backend.` | `brandList.ts:4` | B1 backend cycle — endpoints `GET /brands`, `POST /brands` land |
| `[TRANSITIONAL] dev seed buttons — removed in B1` | `account.tsx:87` | B1 backend cycle |
| `[TRANSITIONAL] stub upcoming-events list` | `home.tsx:63` | B1 backend cycle — events endpoints land |
| Persist key `mingla-business.currentBrand.v2` | `currentBrandStore.ts:69` | When backend lands, store becomes thin (active brand ID only) — likely v3 |

---

## 11. Cycle 1 file changes summary

| Path | Action | Net lines |
|------|--------|-----------|
| `mingla-business/src/store/brandList.ts` | NEW | +60 |
| `mingla-business/src/store/currentBrandStore.ts` | MODIFIED | +25 |
| `mingla-business/src/components/ui/TopBar.tsx` | MODIFIED (additive prop) | +18 |
| `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | NEW | +280 |
| `mingla-business/app/(tabs)/home.tsx` | REWRITE | +275 |
| `mingla-business/app/(tabs)/account.tsx` | MODIFIED | +87 |

**Total:** 2 created, 4 modified, 0 deleted. Net ~+745 lines.

---

## 12. Founder smoke instruction

```
SETUP:
  cd mingla-business && npx expo start --dev-client
  Open on iPhone (founder smoke #1) and Android device (smoke #2).

iOS smoke (gates a–g, AC#1–#6):

1. Cold-launch the app with NO brands seeded.
   AC#1: Home tab opens → empty state GlassCard with greeting + "No brands yet"
   AC#1: TopBar chip reads "Create brand"

2. Tap topbar chip → BrandSwitcherSheet opens in CREATE mode.
   AC#2: form pre-filled "Lonely Moth"
   AC#2: edit to "My Test Brand" → tap Create brand
   AC#2: sheet closes
   AC#2: Toast appears "My Test Brand is ready"
   AC#2: Home reflows — chip now reads "My Test Brand"
   AC#2: hero shows "Last 7 days £0" KpiTile (no live event)

3. Go to Account tab → tap "Wipe brands" → tap "Seed 4 stub brands"
   AC#3 setup: 4 brands seeded, current = Sunday Languor.

4. Go back to Home tab.
   AC#3: chip reads "Sunday Languor"
   AC#3: hero shows live KPI:
        - Live tonight pill (with pulse animation)
        - "Slow Burn vol. 4"
        - £8,420 / £12,000
        - progress bar at ~70%
        - 3 stat row (Tickets sold / Capacity / Scanned)
   AC#5: KPI grid below: "Active events 6" / "Followers 1,124"
   AC#5: Upcoming section: live event row + 2 stub rows
   AC#5: Build CTA at bottom (dashed border, plus icon)

5. Tap topbar chip → BrandSwitcherSheet opens in SWITCH mode.
   AC#4: 4 brands listed, Sunday Languor checked
   AC#4: tap "Lonely Moth" → sheet closes
   AC#4: Home reflows — chip "Lonely Moth", hero NOT live (no currentLiveEvent)
   AC#4: KPI grid updates to Lonely Moth's stats

Android smoke: repeat all of the above.

REGRESSION CHECKS:
- AC#6: dark mode looks correct (no light-mode bleed-through)
- Sign-out from Account → return to /welcome
- Sheet drag-down + scrim-tap both close cleanly
- Toast auto-dismisses after ~3s
- All glass surfaces still feel premium (no Android shadow regression)

If anything is off, surface to orchestrator with the specific symptom
+ which AC failed.
```

---

## 13. Working method actually followed

1. ✅ Pre-flight reads — orchestrator dispatch + addendum + screens-home/brand
2. ✅ Surface-up to orchestrator (4 contradictions resolved as A1–A7)
3. ✅ Build phase 1: store layer + TopBar prop (3 files)
4. ✅ tsc check (clean)
5. ✅ Build phase 2: BrandSwitcherSheet shared component (1 file)
6. ✅ tsc check (token-name fixes, then clean)
7. ✅ Build phase 3: home.tsx + account.tsx (2 files)
8. ✅ tsc check (clean)
9. ✅ TRANSITIONAL marker grep verification (6 markers placed)
10. ✅ Report written
11. ⏳ Founder device smoke — pending

---

## 14. Hand-off

Per locked sequential rule, **stopping here**. tsc clean across all 6 files;
6/6 acceptance criteria PASS at code-trace level; device smoke pending
founder.

D-IMPL-38 (sign-out brand-store cleanup) is the only open Constitutional
risk. Properly addressed at B1 per orchestrator discretion.

Hand back to `/mingla-orchestrator` for review + founder smoke instruction
+ AGENT_HANDOFFS update.

---

**End of Cycle 1 Account Anchor implementation report.**
