# Implementation Report — Cycle 2 · J-A8 Polish (Bio + Country Picker + Multi-Platform Social Icons)

> **Initiative:** Mingla Business Frontend Journey Build (DEC-071 frontend-first)
> **Cycle:** ORCH-BIZ-CYCLE-2-J-A8-POLISH
> **Codebase:** `mingla-business/`
> **Predecessor:** J-A8 implementor PASS (`00c0c89f`)
> **Implementor turn:** 2026-04-29
> **Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_2_J_A8_POLISH.md`
> **Spec:** `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_2_J_A8_POLISH.md`
> **Status:** implemented, partially verified (code-trace + tsc clean across all 6 files; founder runtime smoke pending)

---

## 1. Summary

J-A8 polish package shipped 3 founder-smoke-surfaced items as a single bundled cycle:

- **P-1** Bio textarea: replaced clipped Input usage with new inline `InlineTextArea` (~70 lines) inside BrandEditView. Visual style matches Input's container; minHeight 120px; focus animation 1px→1.5px to `accent.warm`. No kit primitive change (DEC-079 preserved).
- **P-2** Country picker: replaced 12-entry `PHONE_COUNTRIES` with 220-entry full ISO 3166-1 list. Added inline search bar (`PickerSearchInput`) that filters by name (case-insensitive substring) or dial code (startsWith with optional `+` prefix). Empty-state "No matches" copy. Reset on picker close. `[TRANSITIONAL]` marker retired.
- **P-3** Multi-platform social: schema v4→v5 (6 new optional `BrandLinks` fields — tiktok, x, facebook, youtube, linkedin, threads). 8 new SVG icon glyphs added to `Icon.tsx` per **DEC-082** carve-out (additive expansion). Stub data updated with mixed-coverage handles. BrandEditView Social section grew from 2 Inputs to 8. BrandProfileView hero rewritten — old `contactCol` + `linksRow` blocks deleted, replaced with unified `socialsRow` showing icon-only chips ordered email→phone→website→instagram→tiktok→x→facebook→youtube→linkedin→threads, each rendered ONLY when its field is non-empty, entire row hidden when all 10 fields are empty.

**6 files modified, 0 new files.** Sequential discipline preserved: schema → stubs → tsc → icons → tsc → Input → tsc → BrandEditView → tsc → BrandProfileView → tsc.

---

## 2. Old → New Receipts

### `mingla-business/src/store/currentBrandStore.ts` (MODIFIED)

**What it did before:** `BrandLinks { website?, instagram?, custom? }`. Persist key `...currentBrand.v4`. Migration handled v1 reset, v2→v3 attendees upgrade, v3→v4 passthrough.

**What it does now:** `BrandLinks` extended with 6 new optional fields (tiktok, x, facebook, youtube, linkedin, threads) with JSDoc comments marking v5 origin. Bumped persist key to `v5`, `version: 5`. Migration extended with v4→v5 passthrough comment. Header schema-version history extended with v5 entry.

**Why:** spec §3.1 — `BrandLinks` gap H-A8-3a; matches handoff §5.3.5 multi-platform intent.

**Lines:** +18, -3. Net +15.

### `mingla-business/src/store/brandList.ts` (MODIFIED)

**What it did before:** 4 STUB_BRANDS each with website + instagram only (and `custom: []`).

**What it does now:** mixed-coverage handles per spec §3.2:
- **Lonely Moth** — all 8 platforms (full coverage)
- **The Long Lunch** — 3 platforms (website + instagram + tiktok)
- **Sunday Languor** — 6 platforms (+ tiktok, x, youtube, threads)
- **Hidden Rooms** — unchanged (2 platforms — website + instagram)

Header comment extended with v5 schema reference + smoke-coverage rationale.

**Why:** spec §3.2 — visual smoke needs different chip counts to verify hide-empty logic.

**Lines:** +13, -1. Net +12.

### `mingla-business/src/components/ui/Icon.tsx` (MODIFIED — DEC-082 additive carve-out)

**What it did before:** 69 IconName entries + 69 RENDERER functions.

**What it does now:** 77 entries total — 8 new appended after `inbox`: phone, instagram, tiktok, x, facebook, youtube, linkedin, threads. Each carries verbatim Lucide-derived SVG path data per spec §3.3:
- `phone` — single-path Lucide handset
- `instagram` — multi-element (rounded square + lens circle + corner dot, takes color param)
- `tiktok` — Tabler-style "d" with note flag
- `x` — Phosphor-style sharp X serif
- `facebook` — Lucide "f" mark
- `youtube` — multi-element (rounded rect + play triangle)
- `linkedin` — multi-element ("n" path + "i" stem rect + "i" dot circle)
- `threads` — composed approximation (D-FORENSICS-A8P-1 — designer-review-pending)

Comment block above the new entries documents DEC-082 origin + designer-review note for Threads.

**Why:** spec §3.3 — H-A8-3b, kit lacked these glyphs. DEC-082 carve-out (additive expansion of closed Cycle 0a kit).

**Lines:** +44 net.

### `mingla-business/src/components/ui/Input.tsx` (MODIFIED)

**What it did before:**
- `PHONE_COUNTRIES` const had 12 hardcoded entries with `[TRANSITIONAL]` header pointing to "Cycle 3+ should swap to libphonenumber-js + a full international list."
- `DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES[0]` (relied on first entry being GB).
- Picker Sheet rendered raw map of all 12 entries; no search.

**What it does now:**
- `PHONE_COUNTRIES` replaced with 220-entry alphabetically-sorted ISO 3166-1 list. Header comment updated to reflect "Phone validation lives at backend B1+; this list is just for chip presentation." `[TRANSITIONAL]` marker REMOVED.
- `DEFAULT_PHONE_COUNTRY` uses explicit `PHONE_COUNTRIES.find((c) => c.iso === "GB")` lookup with fallback to `[0]` — preserves GB-default after alphabetical sort breaks the previous "first-entry-is-GB" assumption.
- Added `pickerSearch` state, `filteredCountries` `useMemo` (case-insensitive substring on name + startsWith on dialCode with implicit `+` tolerance), `useEffect` to reset search on picker close.
- New internal `PickerSearchInput` component (~50 lines) — composed inline (does NOT recursively use the main Input component to avoid edge cases). Renders search-icon-prefixed TextInput matching Input's container visual style (border, focus animation, bg, padding).
- Picker Sheet now renders `<PickerSearchInput />` above the ScrollView, then conditionally renders "No matches" Text when `filteredCountries.length === 0`, then maps over filtered list.
- 2 new styles: `pickerSearchWrap` (padding around search input), `pickerEmpty` (centered tertiary text for empty filter result).

**Why:** spec §3.4 — H-A8 P-2 root cause; retires `[TRANSITIONAL]` marker.

**Lines:** +280 (full country list dominant) net.

### `mingla-business/src/components/brand/BrandEditView.tsx` (MODIFIED)

**What it did before:**
- Bio rendered via `<Input variant="text" multiline numberOfLines={4} textAlignVertical="top" />` — clipped to Input primitive's 48px container.
- Social section had 2 Inputs (website with leadingIcon=`link`, instagram with leadingIcon=`user`).

**What it does now:**
- Added new `InlineTextArea` component (~70 lines) before `BrandEditViewProps` per spec §3.5.1. Same pattern as the existing `InlineToggle`. JSDoc explains DEC-079 rationale + reusable pattern note.
- Added `TextInput` to react-native imports.
- Bio rendered via `<InlineTextArea ... />` — `minHeight: 120`, multi-line, focus animation matches Input.
- Social section grew from 2 to **8** Inputs in spec order: website (leadingIcon=`globe` per D-FORENSICS-A8P-4), instagram (leadingIcon=`instagram`), tiktok, x, facebook, youtube, linkedin, threads — each with respective new platform glyph as leadingIcon.

**Why:** spec §3.5 — P-1 (bio) + P-3d (Social section expansion). leadingIcon swap from `link`→`globe` per D-FORENSICS-A8P-4 (semantically clearer for "website").

**Lines:** +95, -10. Net +85.

### `mingla-business/src/components/brand/BrandProfileView.tsx` (MODIFIED)

**What it did before:**
- Hero card rendered `hasContact` block: contactCol View with email row (envelope icon + text) + phone row (`bell` icon as proxy + text)
- Hero card rendered `hasLinks` block: linksRow View with Pill chips containing text labels for website + instagram
- Styles `contactCol`, `contactRow`, `contactText`, `linksRow` defined

**What it does now:**
- Both blocks DELETED. Replaced with single IIFE-built `socialsRow` per spec §3.6.2:
  - Builds `chips: Array<{key, icon, aria}>` array conditionally — pushes only when corresponding `brand.contact.*` or `brand.links.*` field is a non-empty string
  - 10 possible chips in spec order: email → phone → website → instagram → tiktok → x → facebook → youtube → linkedin → threads
  - Returns `null` when `chips.length === 0` (entire row hidden — clean look)
  - Renders flex-wrap row of 36×36 Pressable chips with `accent.tint` bg + `accent.border` border + 18px Icon in `accent.warm` color
  - Each chip's onPress = existing `handleOpenLink` callback (D-IMPL-A7-5 TRANSITIONAL Toast preserved)
- Removed `hasContact` and `hasLinks` derivations — no longer used (the chips IIFE has its own per-field guards)
- Deleted styles: `contactCol`, `contactRow`, `contactText`, `linksRow`
- Added styles: `socialsRow`, `socialChip`

**Why:** spec §3.6 — P-3c root cause; user request "icons on the brand profile when added... clean look."

**Lines:** +50, -45. Net +5 (rewrite, not net add).

---

## 3. Spec Traceability — AC verification matrix

| AC | Criterion | Status | Code-trace evidence |
|---|---|---|---|
| 1 | Bio TextArea ≥120px tall | ✅ CODE PASS · ⏳ DEVICE | `InlineTextArea` defaults `minHeight: 120`; container style applies it |
| 2 | Bio accepts/renders multi-line | ✅ CODE PASS · ⏳ DEVICE | TextInput passes `multiline` + `textAlignVertical="top"` |
| 3 | Bio focus border animation | ✅ CODE PASS · ⏳ DEVICE | Local `focused` state flips borderWidth 1→1.5 + color to `accent.warm` |
| 4 | Picker shows 220+ countries | ✅ CODE PASS · ⏳ DEVICE | `PHONE_COUNTRIES` array length verified 220 entries |
| 5 | Picker has search bar | ✅ CODE PASS · ⏳ DEVICE | `PickerSearchInput` rendered inside Sheet above ScrollView |
| 6 | Search filters list | ✅ CODE PASS · ⏳ DEVICE | `filteredCountries` useMemo: name.toLowerCase().includes() OR dialCode.toLowerCase().startsWith() |
| 7 | "No matches" empty state | ✅ CODE PASS · ⏳ DEVICE | `{filteredCountries.length === 0 ? <Text>No matches</Text> : null}` |
| 8 | Search clears on picker close | ✅ CODE PASS · ⏳ DEVICE | useEffect resets `pickerSearch` to "" when `pickerOpen === false` |
| 9 | PHONE_COUNTRIES TRANSITIONAL marker REMOVED | ✅ PASS | grep verified — no `[TRANSITIONAL]` in Input.tsx |
| 10 | GB still default | ✅ CODE PASS · ⏳ DEVICE | `DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES.find(c => c.iso === "GB") ?? PHONE_COUNTRIES[0]` |
| 11 | Icon set has 8 new entries | ✅ PASS | IconName union extended; RENDERERS map extended; verified by tsc + grep |
| 12 | Brand schema v4→v5 | ✅ CODE PASS · ⏳ DEVICE | BrandLinks 6 new fields; persistOptions name + version bumped; migration extended |
| 13 | Edit form has 8 social Inputs | ✅ CODE PASS · ⏳ DEVICE | BrandEditView Social section verified 8 Input blocks |
| 14 | Profile shows icon chips for non-empty fields | ✅ CODE PASS · ⏳ DEVICE | socialsRow IIFE pushes chips conditionally per field |
| 15 | Empty fields hide chips | ✅ CODE PASS · ⏳ DEVICE | guard `typeof X === "string" && X.length > 0` per chip |
| 16 | All empty → row hidden | ✅ CODE PASS · ⏳ DEVICE | IIFE returns `null` when `chips.length === 0` |
| 17 | Each chip TRANSITIONAL Toast | ✅ CODE PASS · ⏳ DEVICE | onPress=handleOpenLink (existing D-IMPL-A7-5 Toast preserved) |
| 18 | Render order email→phone→...→threads | ✅ CODE PASS · ⏳ DEVICE | IIFE pushes chips in spec-defined order |
| 19 | Stub mixed coverage | ✅ CODE PASS · ⏳ DEVICE | brandList.ts: LM=8, TLL=3, SL=6, HR=2 |
| 20 | tsc clean | ✅ PASS | `npx tsc --noEmit` exits 0 (verified after every step + final) |
| 21 | No new files in src/components/ui/ | ✅ PASS | No new files created in `src/components/ui/`; PickerSearchInput is internal-to-file; InlineTextArea is local to BrandEditView |
| 22 | Persist v4→v5 cold-launch safe | ⏳ UNVERIFIED — founder runtime | Migration is passthrough; existing v4 brands hydrate with new fields undefined; tsc clean confirms type contract |
| 23 | Web parity | ⏳ UNVERIFIED — founder runtime | No Platform.OS branches added; existing platform handling preserved |

**Summary:** 21/23 ACs code-trace PASS. 2/23 (AC#22 persist runtime, AC#23 web parity runtime) require founder smoke.

---

## 4. Invariant Verification

| ID | Status | Evidence |
|---|---|---|
| I-1 | ✅ Preserved | `designSystem.ts` not touched |
| I-3 | ⏳ iOS/Android: code-trace pass; web: ⏳ founder smoke | No Platform.OS branches added |
| I-4 | ✅ Preserved | grep: zero `app-mobile/` strings in any modified file |
| I-6 | ✅ Preserved | tsc strict clean across all 6 files |
| I-7 | ✅ Preserved | PHONE_COUNTRIES `[TRANSITIONAL]` REMOVED; D-IMPL-A7-5 social-tap TRANSITIONAL PRESERVED (handleOpenLink still fires Toast) |
| I-8 | ✅ Preserved | No backend, migrations, RPCs, RLS touched |
| I-9 | ✅ Preserved | No animation timings touched (TextArea + Toggle use no animation; ConfirmDialog inherits Cycle 0a) |
| I-10 | ✅ Preserved | No new currency rendering introduced |
| I-11 | ✅ Preserved | Format-agnostic ID resolver unchanged |
| I-12 | ✅ Preserved | Host-bg cascade unchanged on edit + view routes |
| **DEC-082** (NEW — proposed) | ✅ Established | Icon.tsx gains 8 additive icons; no breaking changes to existing 69 glyphs; comment block at the new section documents the carve-out |
| DEC-079 | ✅ Preserved | No new files in `src/components/ui/`; PickerSearchInput + InlineTextArea are local compositions |
| DEC-071 | ✅ Preserved | No backend code anywhere |
| DEC-080 | ✅ Preserved | TopSheet primitive untouched |
| DEC-081 | ✅ Preserved | grep: zero `mingla-web/` references |

---

## 5. Constitutional Compliance

| # | Principle | Compliance |
|---|---|---|
| 1 | No dead taps | ✅ — every chip + Pressable has handler; toggle flips; search filters live |
| 2 | One owner per truth | ✅ — currentBrandStore remains single brand-state authority |
| 3 | No silent failures | ✅ — all UI feedback via Toast or visible state |
| 4 | One query key per entity | N/A — no React Query in J-A8 polish |
| 5 | Server state stays server-side | ✅ — Zustand still client-only |
| 6 | Logout clears everything | ⚠ partial — D-IMPL-38 inherited; B1-deferred |
| 7 | Label temporary fixes | ✅ — PHONE_COUNTRIES TRANSITIONAL retired; D-IMPL-A7-5 social TRANSITIONAL preserved |
| 8 | Subtract before adding | ✅ — contactCol + linksRow + obsolete styles DELETED before socialsRow added |
| 9 | No fabricated data | ✅ — stub data clearly labeled; no new fabricated numbers |
| 10 | Currency-aware UI | ✅ — no currency surface in J-A8 polish |
| 11 | One auth instance | ✅ — AuthContext untouched |
| 12 | Validate at the right time | ✅ — chip render guards per-field; search filter computed on-demand via useMemo |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | ✅ — v4→v5 migration is cold-launch safe (passthrough) |

---

## 6. TRANSITIONAL marker grep

**P-2 retirement verified:**
```
$ grep "TRANSITIONAL" Input.tsx
(no matches)
```
PHONE_COUNTRIES `[TRANSITIONAL]` marker REMOVED ✅

**D-IMPL-A7-5 preservation verified:**
```
$ grep "handleOpenLink|Opening links" BrandProfileView.tsx
178: const handleOpenLink = useCallback...
179:   fireToast("Opening links lands in a later cycle.");
306:   onPress={handleOpenLink}
```
Social-tap deferral PRESERVED — chips still fire Toast ✅

**New TRANSITIONAL markers added in J-A8 polish:**
- BrandEditView.tsx — `[TRANSITIONAL] simulated async delay` (carryover from J-A8 baseline, untouched)
- BrandEditView.tsx — `[TRANSITIONAL] photo upload` (carryover, untouched)
- BrandProfileView.tsx — `handleOpenLink` Toast handler unchanged (D-IMPL-A7-5)
- Icon.tsx — Threads glyph documented as designer-review-pending (D-FORENSICS-A8P-1) but not labeled `[TRANSITIONAL]` (it's a refinement candidate, not a blocking placeholder)

---

## 7. Cache Safety

Persist key bumped `mingla-business.currentBrand.v4` → `v5`. Migration:
- v1 → reset to empty (unchanged)
- v2 → upgradeV2BrandToV3 (unchanged)
- v3 → v4: passthrough — adds nothing, `displayAttendeeCount` starts undefined
- v4 → v5: passthrough — adds nothing, 6 new `links.*` fields start undefined
- v5+ → passthrough

A device with v4-persisted state (J-A8 tester device) will cold-launch into v5 without crash. New `links.tiktok/x/facebook/youtube/linkedin/threads` fields are undefined for existing brands → render-time guards skip those chips → user sees no new chips until they fill the fields via edit.

After "Wipe brands" + "Seed 4 stub brands", the new mixed-coverage stubs populate platform handles → chips appear per stub.

No React Query keys (no backend in J-A8 polish).

---

## 8. Parity Check (mobile + web)

| Surface | iOS | Android | Web (compile) | Web (runtime) |
|---|---|---|---|---|
| Bio TextArea | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Country picker (220 entries + search) | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Social section 8 Inputs in edit | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Profile socialsRow with hide-empty | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Persist v4→v5 cold-launch | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |

8 new icon glyphs render via existing `react-native-svg` SVG rendering — should work identically across all 3 platforms (no platform-specific glyph code).

---

## 9. Regression Surface (3-5 features most likely to break)

1. **Cycle 1 BrandSwitcherSheet phone variant elsewhere** — `Input` phone variant is used elsewhere (verify by grep — currently only in BrandEditView Contact section + may be in Cycle 0a auth flow). Country chip default behavior changed from `PHONE_COUNTRIES[0]` to explicit `find(GB)` lookup — should yield identical result. **Low.**
2. **J-A7 view existing chips** — old contactCol + linksRow rendering deleted. Verify on Sunday Languor and Lonely Moth that the new socialsRow shows correct icons in correct order. **Medium.**
3. **J-A8 BrandEditView Save state machine** — Input field count grew from 2→8 in Social section but state machine + isDirty dirty-check via JSON.stringify still applies (deep compares draft object). **Low.**
4. **Cycle 1 Home tab live-event hero** — code path identical; only Brand schema additions are optional links fields ignored by Home. **Low.**
5. **Country picker performance with 220 entries** — `filteredCountries` is `useMemo`-ed, ScrollView renders all visible entries. iOS may lag without virtualization. If perf issue surfaces, future optimization candidate is FlatList. **Medium-low.**

---

## 10. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-IMPL-A8P-1 | `PickerSearchInput` is a parallel implementation of Input's container/border/focus pattern — duplicates ~50 lines. Could be DRY'd if a `useInputContainer()` hook were extracted (DEC-079 closure-friendly). Future cleanup candidate; current implementation is correct and matches kit visual. | Info | Track for future kit refactor |
| D-IMPL-A8P-2 | The 220-entry `PHONE_COUNTRIES` const inflates Input.tsx by ~250 lines. D-FORENSICS-A8P-2 already noted this. Could extract to `src/constants/countries.ts` in a future cleanup. | Info | Track |
| D-IMPL-A8P-3 | `Threads` icon glyph is the most uncertain visual — composed approximation per D-FORENSICS-A8P-1. Designer review recommended post-implementation; if needed, swap path data via single-line follow-up. | Info | Designer review |
| D-IMPL-A8P-4 | Country picker scrollview renders all 220 entries without virtualization. May lag on slower Android devices. If smoke surfaces lag, swap ScrollView → FlatList in a follow-up. Currently acceptable for cycle 2 polish scope. | Info | Watch-point for smoke |
| D-IMPL-A8P-5 | The `PickerSearchInput`'s ScrollView wraps the country list with `keyboardShouldPersistTaps="handled"` — added during implementation per RN best-practice for tap-while-keyboard-open scenarios (memory pattern from app-mobile lessons). Not in spec but defensive. | Info | None — defensive add |

**No new high-severity issues.** D-IMPL-A8-1 (empty-bio CTA stale Toast) NOT addressed — out of scope per spec §1.2; recommend as separate micro-fix.

---

## 11. Transition Items

| Marker | Site | Exit condition |
|---|---|---|
| Persist key `...currentBrand.v5` | `currentBrandStore.ts:101` | When backend lands (B1), store becomes thin (active brand ID only); likely v6 |
| `handleOpenLink` Toast (D-IMPL-A7-5) | `BrandProfileView.tsx:178-180` | Cycle 3+ wires `Linking.openURL` for real link opening |

---

## 12. Founder smoke instructions

```
SETUP:
  cd mingla-business && npx expo start --dev-client
  Open on iPhone, Android device, AND web browser.

P-1 Bio textarea:
1. Account → Wipe brands → Seed 4 stub brands. Open Sunday Languor → Edit.
2. Bio field is at least 120px tall (~4 lines visible). Type 3 paragraphs
   with line breaks — all visible, no clipping.
3. Tap bio field → border thickens (1px → 1.5px) with warm color.

P-2 Country picker:
4. Edit screen → tap phone country chip.
5. Picker Sheet shows 220 countries scrolling alphabetically.
6. Search bar visible at top. Type "ja" → "Jamaica" + "Japan" appear.
7. Type "+91" → "India" appears.
8. Type "xyz" → "No matches" empty state.
9. Close picker, reopen — search empty.
10. Default selected is United Kingdom (🇬🇧 +44).

P-3 Multi-platform social — Edit form:
11. Edit screen, scroll to Social Links section. 8 Inputs visible:
    Website (globe icon), Instagram, TikTok, X, Facebook, YouTube, LinkedIn,
    Threads. Each shows its platform's icon as leadingIcon.

P-3 Multi-platform social — Profile view:
12. Lonely Moth profile: 10 chips render in hero (email + phone + website +
    7 social platforms). Order: email, phone, website, instagram, tiktok,
    x, facebook, youtube, linkedin, threads.
13. The Long Lunch profile: 5 chips (email, phone, website, instagram, tiktok).
14. Sunday Languor profile: 8 chips (email, phone, website, instagram,
    tiktok, x, youtube, threads).
15. Hidden Rooms profile: 4 chips (email, website, instagram only — phone
    not in stub).
16. Open Edit on Lonely Moth → clear the X handle → Save → reopen profile.
    X chip is gone; other 9 chips intact.
17. Create a new brand via switcher → open profile. NO chips render →
    entire socialsRow hidden, no empty space.
18. Tap any chip on a brand profile → Toast "Opening links lands in a later
    cycle." (D-IMPL-A7-5 deferral preserved).

Web smoke:
19. Sign in to web. Account → Sunday Languor → Edit. URL: /brand/sl/edit.
20. Bio textarea works on web (multi-line, focus animation).
21. Country picker on web shows full list with search filter.
22. Profile view shows icon chips identically to mobile.

Persist migration smoke:
23. If you have device with J-A8 (v4) state, cold-launch this build (v5).
    App opens without crash. Brands intact. Existing brands have no new
    platform fields filled (no chips for those platforms until edited).
    After Wipe + Seed → new stubs render correct chip counts.

REGRESSION CHECKS:
- PHONE_COUNTRIES TRANSITIONAL marker absent (grep confirms) ✅
- D-IMPL-A7-5 social-tap TRANSITIONAL preserved (Toast still fires) ✅
- J-A8 Save → Saved Toast → navigate-back still works
- J-A7 sticky-shelf "Edit brand" navigation still works
- Account "Your brands" rows still navigate to view (J-A7)
- Sign-out → /welcome (Cycle 0a behavior preserved)
- Home tab live-event hero (Sunday Languor) still works
- BrandSwitcherSheet phone-input call sites (if any in Cycle 0a auth) still
  work with explicit GB lookup (no behavior change vs PHONE_COUNTRIES[0])

If anything fails, report which AC + which platform.
```

---

## 13. Working method actually followed

1. ✅ Pre-flight reads — spec + investigation + dispatch + Cycle 2 J-A8 baseline + handoff §5.3.5/§5.3.6 + Icon.tsx + Input.tsx (all in context from session)
2. ✅ Schema bump v4→v5 (currentBrandStore.ts) + migration extension + JSDoc + header history
3. ✅ tsc check — clean
4. ✅ Stub data — brandList.ts (mixed coverage per spec)
5. ✅ tsc check — clean
6. ✅ Icon set — Icon.tsx (8 new IconName entries + 8 new RENDERER functions, Lucide-derived path data verbatim from spec)
7. ✅ tsc check — clean
8. ✅ Input.tsx — replace PHONE_COUNTRIES + DEFAULT_PHONE_COUNTRY explicit GB lookup + add picker search bar + PickerSearchInput component + 2 new styles
9. ✅ tsc check — clean
10. ✅ BrandEditView.tsx — InlineTextArea component + replace bio Input + extend Social section to 8 Inputs (with platform icons + globe for website)
11. ✅ tsc check — clean
12. ✅ BrandProfileView.tsx — delete contactCol + linksRow render blocks + obsolete styles + hasContact/hasLinks derivations; add socialsRow IIFE + socialChip styles
13. ✅ tsc check — clean (final)
14. ✅ TRANSITIONAL grep — PHONE_COUNTRIES marker REMOVED + D-IMPL-A7-5 PRESERVED
15. ✅ Report written
16. ⏳ Founder device + web smoke — pending

---

## 14. Layman summary (for orchestrator chat reply)

When this lands and is verified, the founder will:
- Edit brand → bio is properly tall with line breaks accepted
- Edit brand → tap country chip on phone field → see all 220 countries with a search bar that filters as you type
- Edit brand → Social Links section has 8 fields (website, Instagram, TikTok, X, Facebook, YouTube, LinkedIn, Threads), each with the platform's icon
- View profile → contact + social shown as a clean horizontal row of icon-only chips
- Empty fields = no chip → cleaner profile, no awkward empty rows
- Tap any chip → Toast "Opening links lands in a later cycle." (real URL opening still deferred to Cycle 3+)

Brand schema v4→v5 with safe passthrough migration. Icon set gains 8 new platform glyphs via DEC-082 additive carve-out.

---

## 15. Hand-off

Per locked sequential rule, **stopping here**. tsc clean across all 6 files; 21/23 ACs PASS at code-trace level; AC#22 (persist migration runtime) + AC#23 (web parity runtime) require founder smoke.

D-IMPL-A8-1 (empty-bio CTA stale Toast) and D-IMPL-A8P-1..5 are info-grade follow-ups, not blocking. D-IMPL-38 inherited from Cycle 1 still B1-deferred.

Hand back to `/mingla-orchestrator` for review + founder smoke instruction execution + AGENT_HANDOFFS update.

---

**End of J-A8 polish implementation report.**
