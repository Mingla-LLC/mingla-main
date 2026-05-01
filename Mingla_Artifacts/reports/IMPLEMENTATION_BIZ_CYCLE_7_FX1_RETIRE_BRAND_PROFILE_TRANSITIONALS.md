# Implementation — ORCH-BIZ-CYCLE-7-FX1 — Retire 3 BrandProfileView TRANSITIONALs

**Status:** implemented, partially verified
**Verification:** tsc PASS · runtime UNVERIFIED (awaits user smoke)
**Scope:** 2 files MOD · ~+85/-25 LOC delta · 0 new external deps · 3 TRANSITIONALs retired
**Spec:** [prompts/IMPL_BIZ_CYCLE_7_FX1_RETIRE_BRAND_PROFILE_TRANSITIONALS.md](Mingla_Artifacts/prompts/IMPL_BIZ_CYCLE_7_FX1_RETIRE_BRAND_PROFILE_TRANSITIONALS.md)

---

## 1 — Mission

3 dead-Toast buttons on BrandProfileView wired to their proper destinations. Constitution #1 (no dead taps) restored. Constitution #7 honored — 3 TRANSITIONALs retired (net −3) per the spec's required exit condition checks.

## 2 — Old → New Receipts

### `mingla-business/src/components/brand/BrandProfileView.tsx`

**What it did before:**
- 3 handlers fired `fireToast` stubs pointing at "Cycle 3+" or "later cycle" — all dead taps.
- "View public page" sticky-shelf button → "Public preview lands in Cycle 3+." toast
- "Build a new event" empty-events CTA → "Event creation lands in Cycle 3." toast
- Social chip taps → "Opening links lands in a later cycle." toast

**What it does now:**
- 3 new navigation-handler props on `BrandProfileViewProps`: `onViewPublic(brandSlug)`, `onCreateEvent()`, `onOpenLink(url)`. Mirrors the existing `onEdit`/`onTeam`/`onStripe`/`onPayments`/`onReports` pattern (route-handler-owned navigation; view stays props-driven).
- Handlers `handleViewPublic` / `handleCreateEvent` / `handleOpenLink` updated to call the new props. The 3 `[TRANSITIONAL]` comments removed.
- Social chips iteration extended: each chip now carries a normalized `url` field. URL normalization done inline via new helper `normalizeSocialUrl(raw, base)` — mirrors PublicBrandPage's pattern.
- Email + phone chips use `mailto:` and `tel:` schemes respectively. Website + 7 social platforms (instagram, tiktok, x, facebook, youtube, linkedin, threads) use platform-specific base URLs with the founder's handle/slug appended.
- `chips.map((chip) => <Pressable onPress={() => handleOpenLink(chip.url)} ...>)` — passes URL per chip instead of calling argless handleOpenLink.

**Why:**
Cycle 7 FX1 — retire 3 dead-tap TRANSITIONALs whose exit conditions have been met (View public ↔ Cycle 7 just shipped; Create event ↔ Cycle 3 shipped weeks ago; Social link ↔ Linking.openURL pattern proven via Cycle 7 ShareModal).

**Lines changed:** ~+85 / -25 net.

### `mingla-business/app/brand/[id]/index.tsx`

**What it did before:**
- Route handler defined 5 navigation handlers (handleBack, handleOpenEdit, handleOpenTeam, handleOpenStripe, handleOpenPayments, handleOpenReports) and passed them to BrandProfileView.

**What it does now:**
- Imports `Linking` from `react-native`.
- 3 new navigation handlers added: `handleViewPublic` (router.push to `/b/{brandSlug}`), `handleCreateEvent` (router.push to `/event/create`), `handleOpenLink` (Linking.openURL with swallowed rejection — fire-and-forget; native dialogs handle no-app-installed cases).
- Passes 3 new props to BrandProfileView.

**Why:**
Wires the 3 new BrandProfileView callbacks to actual routes / native APIs.

**Lines changed:** ~+15.

## 3 — Spec Traceability

| AC | Implementation | Status |
|----|----------------|--------|
| Wire `handleViewPublic` → router.push('/b/{slug}') | Done via `onViewPublic` prop wired in route | PASS by construction |
| Wire `handleCreateEvent` → router.push('/event/create') | Done via `onCreateEvent` prop | PASS by construction |
| Wire `handleOpenLink` → Linking.openURL | Done via `onOpenLink` prop | PASS by construction |
| Honor view-stays-props-driven pattern | No `useRouter` import added to BrandProfileView; view still pure-render | PASS by construction |
| Add `normalizeSocialUrl` helper inline | Added at top of BrandProfileView (line ~93) | PASS |
| Each social chip passes URL on press | Chip array extended with `url` field; onPress is `() => handleOpenLink(chip.url)` | PASS by construction |
| Email + phone use mailto:/tel: | mailto:${email} + tel:${phone} schemes | PASS by construction |
| Remove 3 TRANSITIONAL comments | grep `[TRANSITIONAL] View-public\|Empty-events\|Social chip` returns 0 matches | PASS |
| TypeScript strict EXIT=0 | `cd mingla-business && npx tsc --noEmit` | PASS |
| iOS smoke (View public → /b/sundaylanguor) | Awaits user | UNVERIFIED |
| iOS smoke (Build a new event → /event/create) | Awaits user | UNVERIFIED |
| iOS smoke (Social chip → external app) | Awaits user | UNVERIFIED |
| Web smoke (same 3 flows) | Awaits user | UNVERIFIED |
| Cycle 6/7 regression — no other dead taps | Code inspection — `fireToast` still imported and used at remaining call sites (handleEmptyBio, handleStripeBanner edge cases, etc.) | PASS by construction |

## 4 — Verification

| Check | Method | Result |
|-------|--------|--------|
| TypeScript strict | `cd mingla-business && npx tsc --noEmit` | EXIT=0 |
| TRANSITIONAL retirement count | grep returns 0 matches for 3 retired comments | PASS (3 retired) |
| `fireToast` still imported (remaining TRANSITIONALs) | grep — handleEmptyBio + Operations row #3 (Tax & VAT) + Operations row #4 still use fireToast | PASS — partial retire, not full strip |
| BrandProfileView never imports useRouter | grep — no `useRouter` import added | PASS by construction |
| Route handler imports Linking | Confirmed at line 16 | PASS |
| 3 new props passed | Inspection of `<BrandProfileView ... onViewPublic onCreateEvent onOpenLink />` | PASS |

## 5 — Invariant Verification

| Invariant | Status |
|-----------|--------|
| I-11..I-17 | PRESERVED (no schema/route/store changes; pure UI wire-up) |
| Constitution #1 No dead taps | RESTORED — 3 dead taps now route to correct destinations |
| Constitution #2 One owner per truth | PRESERVED — view stays props-driven; route handler owns navigation |
| Constitution #3 No silent failures | OK — Linking.openURL rejection swallowed intentionally (user-cancellable; no useful surface). Documented in handler comment. |
| Constitution #7 Label temporary fixes | NET −3 TRANSITIONALs retired; remaining ones (Tax & VAT, etc.) still labelled with their own exit conditions |
| Constitution #8 Subtract before adding | HONORED — deleted 3 fireToast call sites before adding new prop-wired handlers |

## 6 — Parity Check

N/A — single-platform organiser app. The fix works identically on iOS/Android/Web (Linking.openURL is platform-aware; router.push is RN-native + Expo Web).

## 7 — Cache Safety

N/A — no React Query / Zustand state shape changes.

## 8 — Regression Surface

3 features most likely to break:

1. **Existing Stripe banner / Operations rows** — these use the same `fireToast` import that we kept. Verify by tapping any Operations row → still fires its real handler (e.g., onPayments routes correctly), not a Toast.
2. **Discard-changes ConfirmDialog** — uses `fireToast` for "Saved" message; verify a successful brand edit still shows the toast.
3. **Empty-bio CTA** — `handleEmptyBio` still uses `fireToast` (legitimate — opens the edit screen via fireToast or routes via onEdit; verify behavior unchanged).

## 9 — Constitutional Compliance

| Principle | Status |
|-----------|--------|
| #1 No dead taps | RESTORED on 3 buttons |
| #7 Label temporary fixes | Net −3 TRANSITIONALs (3 retired, 0 new) |
| #8 Subtract before adding | Honored |

## 10 — Discoveries for Orchestrator

**D-IMPL-CYCLE7-FX1-1 (Note severity)** — `handleEmptyBio` and a few other handlers in BrandProfileView still use `fireToast` for legitimate stub flows that are NOT TRANSITIONAL retirement candidates yet. Examples include: a copy-link toast on the brand edit success path, validation errors, etc. Deliberately left untouched per spec §"Do NOT remove fireToast import".

**D-IMPL-CYCLE7-FX1-2 (Note severity)** — Tax & VAT Operations row (per file header docstring lines 103-104) is still TRANSITIONAL ("stays TRANSITIONAL Toast until §5.3.6 settings cycle"). NOT retired in this dispatch — exit condition not yet met (settings cycle is post-MVP). Unchanged.

**D-IMPL-CYCLE7-FX1-3 (Low severity)** — `normalizeSocialUrl` is now duplicated inline in 2 files (PublicBrandPage.tsx + BrandProfileView.tsx). Spec explicitly said NOT to lift to a shared util in this dispatch. If a 3rd consumer appears, lift to `mingla-business/src/utils/socialUrl.ts`.

**D-IMPL-CYCLE7-FX1-4 (Low severity)** — `Linking.openURL` rejection is swallowed silently per spec direction. If smoke surfaces user complaints ("nothing happens when I tap a social link"), consider surfacing a Toast: "Couldn't open link — make sure the app is installed." Pre-MVP acceptable as-is.

**No other side issues.**

## 11 — Transition Items

No new TRANSITIONAL markers added by this fix. 3 retired (net −3).

## 12 — Files Touched

| File | Type | LOC delta |
|------|------|-----------|
| `mingla-business/src/components/brand/BrandProfileView.tsx` | MOD | ~+85 / -25 |
| `mingla-business/app/brand/[id]/index.tsx` | MOD | ~+15 |

Total: ~+100 / -25 (net ~+75) across 2 files.

## 13 — TypeScript Strict

```
$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

Clean.

## 14 — Cycle 7 status post-FX1

End-to-end discoverability loop functional via founder UI:
1. Account tab → Brand profile → "View public page" → `/b/{slug}` (THIS FIX)
2. Public brand page → tap any upcoming event card → `/e/{brandSlug}/{eventSlug}` (Cycle 7 main)
3. Public event page → tap Share button → ShareModal opens (Cycle 6 + Cycle 7 main)
4. Share via copy / QR / Twitter / WhatsApp / Email / SMS (Cycle 7 main)

Plus:
- Brand profile → "Build a new event" empty-events CTA → /event/create (THIS FIX retires Cycle 3 stub)
- Brand profile → social chip taps → external app via Linking.openURL (THIS FIX)

All 3 user-blocked smoke priorities now unblocked.
