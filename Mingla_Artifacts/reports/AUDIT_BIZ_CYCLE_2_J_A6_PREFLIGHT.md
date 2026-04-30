# Audit — Cycle 2 Pre-Flight: J-A6 (Create Additional Brand)

> **Mode:** Forensics INVESTIGATE (no spec, no code)
> **Issue ID:** ORCH-BIZ-CYCLE-2-PREFLIGHT-J-A6
> **Codebase:** `mingla-business/`
> **Predecessor:** Cycle 1 shipped at `d3fc820e`
> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_2_J_A6_AUDIT.md`
> **Auditor turn:** 2026-04-29
> **Confidence:** **High** — full code-trace performed, all 8 manifest files read end-to-end, tsc clean

---

## 1. Verdict

**⚠ PASS WITH CARVE-OUTS** — J-A6 (Create *additional* brand via BrandSwitcherSheet) is end-to-end functional on iOS, Android, and web at the code-trace level. No 🔴 root causes blocking Cycle 2. Two 🟡 hidden flaws and four 🔵 observations to fold into the J-A7 dispatch.

---

## 2. Symptom Summary (none — proactive audit)

This is a pre-Cycle-2 sanity check, not a bug investigation. Cycle 1's BrandSwitcherSheet was built dual-mode (switch + create) and the implementation report claimed AC#2 (J-A4) and AC#4 (J-A5) PASS at code-trace level. J-A6 (Create additional brand — the "+ Create new brand" footer flow when brands already exist) was not separately verified. This audit confirms whether J-A6 is genuinely shippable or whether implementor cleanup is needed before J-A7 forensics dispatch.

---

## 3. Investigation Manifest

| File | Layer | Read end-to-end? | Notes |
|---|---|---|---|
| `Mingla_Artifacts/reports/IMPLEMENTATION_CYCLE_1_ACCOUNT_ANCHOR.md` | Doc | ✅ | Cycle 1's claimed scope + 4 prior discoveries (D-IMPL-38 to 41) |
| `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | Component | ✅ | 332 lines |
| `mingla-business/src/store/brandList.ts` | State stub | ✅ | 60 lines |
| `mingla-business/src/store/currentBrandStore.ts` | State (Zustand persist) | ✅ | 102 lines |
| `mingla-business/src/components/ui/TopBar.tsx` | Component | ✅ | 263 lines, `onBrandTap` prop verified |
| `mingla-business/app/(tabs)/home.tsx` | Screen | ✅ | 573 lines |
| `mingla-business/app/(tabs)/account.tsx` | Screen | ✅ | 251 lines |
| `mingla-business/src/components/ui/TopSheet.tsx` | Primitive (DEC-080) | ✅ | 391 lines |
| `mingla-business/app/(tabs)/_layout.tsx` | Layout | ✅ | 80 lines |

`npx tsc --noEmit` exit 0.

---

## 4. End-to-End Flow Trace (J-A6 specific path)

Brands already populated (e.g., after "Seed 4 stub brands" or after first-create from J-A4). User wants to create *another* brand.

```
1. User taps brand chip in TopBar (Home or Account tab)
   → TopBar.tsx:136 Pressable.onPress = handleBrandTap
   → handleBrandTap (line 107) checks onBrandTap !== undefined → fires it (line 112)
   → onBrandTap = handleOpenSwitcher from home.tsx:100 (or account.tsx:77)
   → setSheetVisible(true)

2. BrandSwitcherSheet receives visible=true
   → TopSheet mounts (TopSheet.tsx:131 setMounted(true))
   → Scrim fades in (220ms), panel translates from -panelHeight to 0 (280ms ease-out)

3. BrandSwitcherSheet useEffect fires (line 93-99)
   → brands.length > 0 → setMode("switch")
   → setDisplayName("Lonely Moth")  ← see 🟡 H-2 below
   → setSubmitting(false)

4. User sees switch view (line 130-185)
   → header: "Switch brand"
   → ScrollView with brand rows (line 140-174) — each shows avatar initial + name +
     "{events} events · {followers} followers" + check icon if active
   → footer pinned: Button label="Create a new brand" leadingIcon="plus"

5. User taps footer button
   → handleSwitchToCreate (line 119) → setMode("create")
   → No re-mount; just internal state flip

6. Create mode renders (line 187-227)
   → header: back-arrow Pressable (visible because brands.length > 0) + "Create a new brand" title
   → formArea: helper text + Input(displayName, "Brand name", clearable)
   → footer pinned: Button label="Create brand" disabled when !canSubmit||submitting

7. User edits name → "My New Brand"
   → onChangeText → setDisplayName("My New Brand")
   → trimmedName = "My New Brand"
   → canSubmit = trimmedName.length > 0 → true

8. User taps "Create brand" submit
   → handleSubmit (line 109)
   → Guards: !canSubmit||submitting → both false, proceeds
   → setSubmitting(true)
   → buildBrand("My New Brand"):
       id = `b_${Date.now().toString(36)}`     ← e.g., "b_lwhq2k1m"
       displayName = "My New Brand"
       slug = slugify("My New Brand") = "mynewbrand"
       role = "owner"
       stats = {events:0, followers:0, rev:0}
       currentLiveEvent = null
   → setBrands([...brands, newBrand])  ← appends to Zustand store
   → setCurrentBrand(newBrand)         ← makes new brand active
   → onBrandCreated?.(newBrand)        ← parent fires Toast "My New Brand is ready"
   → onClose()                         ← sheet closes (TopSheet exit anim 240ms)

9. Home/Account re-renders via Zustand selectors
   → TopBar chip label = "My New Brand"
   → Home isEmpty = false (brands.length > 0 && currentBrand !== null)
   → liveEvent = null (new brand has no currentLiveEvent)
   → Renders KpiTile "Last 7 days £0" + KPI grid (Active 0 / Followers 0)
   → Upcoming section shows the 2 STUB_UPCOMING_ROWS (no live event prepended)
   → Build CTA renders

10. Persist middleware writes new state to AsyncStorage under key
    "mingla-business.currentBrand.v2" — survives reload
```

**End-to-end PASS at code-trace level** for the J-A6 path.

---

## 5. Verbatim Q&A (per dispatch §4)

### Q1: Does the create form actually create a brand?

**YES.** Line-by-line trace in §4 step 8 confirms `setBrands([...brands, newBrand])` and `setCurrentBrand(newBrand)` both fire. The new brand is appended to the persisted Zustand store and immediately activated. Verified at `BrandSwitcherSheet.tsx:109-117`.

### Q2: Is the new brand assigned a stable, unique ID?

**YES, but with format heterogeneity.** New brand IDs are `b_${Date.now().toString(36)}` (line 69). Each timestamp is millisecond-unique within a single device runtime, so practical collision is impossible. Format: e.g., `b_lwhq2k1m`.

🟡 **H-1: ID format mismatch with stub data.** `STUB_BRANDS` (`brandList.ts:15-52`) use 2-3 char IDs (`lm`, `tll`, `sl`, `hr`) hardcoded for AC#3 hero figure. User-created brands use `b_<ts36>` format. J-A7's `/brand/:id/` route must resolve BOTH formats. Route param resolvers don't care about format, so this is cosmetic-only — but the J-A7 dispatch should explicitly confirm route resolver tolerance for both shapes (or normalize stub IDs to `b_*` format if visual consistency desired).

### Q3: Does the newly-created brand become active immediately?

**YES.** `setCurrentBrand(newBrand)` runs synchronously between `setBrands(...)` and `onClose()` (`BrandSwitcherSheet.tsx:113-116`). Zustand state updates are synchronous, so on next render cycle, `useCurrentBrand()` returns the new brand. TopBar chip and Home content reflow immediately. No race condition.

### Q4: What fields does the create form capture today?

**Only `displayName`.** All other Brand fields are derived or defaulted at create time:

| Field | Source | Note |
|---|---|---|
| `id` | `b_${Date.now().toString(36)}` | Auto-generated |
| `displayName` | Input field | User input (required, non-empty) |
| `slug` | `slugify(displayName)` | Auto-derived |
| `photo?` | undefined | Not captured |
| `role` | `"owner"` (hardcoded) | All user-created brands are owner-role |
| `stats` | `{0, 0, 0}` | Empty starting state |
| `currentLiveEvent` | `null` | New brand has no live event |

🔵 **O-1: Minimum-fields create pattern is intentional.** Roadmap §3.2 (line 233-235) defines J-A8 (`/brand/:id/edit`) as the place where photo, bio, contact, social, custom links land. J-A6's lean form is the correct create-then-edit pattern. Not a defect.

### Q5: Does the flow work identically on web?

**YES code-trace; runtime smoke needed.** Audit specifics:

| Concern | Verified at | Status |
|---|---|---|
| TopSheet web Escape key | `TopSheet.tsx:188-210` | ✅ explicit handler |
| BlurView fallback when CSS backdrop-filter unsupported | `TopSheet.tsx:74-84` + `298-311` | ✅ `FALLBACK_BACKGROUND` solid color |
| Reanimated v4 web compatibility | All animations use `withTiming` + `useSharedValue` | ✅ standard web-compatible API |
| Gesture-handler web (swipe-up dismiss) | `TopSheet.tsx:230-249` Gesture.Pan | ✅ web-supported in v2 |
| Zustand persist on web | metro.config.js zustand→CJS shim (WEB3 fix) | ✅ persist works |
| Dimensions.get("window") on web | `TopSheet.tsx:116` | ⚠ see H-2 below |
| Platform.OS branches in J-A6 path | None found in BrandSwitcherSheet, brandList, currentBrandStore, or the Home/Account create-trigger paths | ✅ no platform forks |

🟡 **H-2: TopSheet captures viewport height once at mount.** `Dimensions.get("window").height` is read at component-mount time (`TopSheet.tsx:116`). On web window-resize while sheet is open, panel height won't update. Mobile devices don't resize mid-overlay so this is web-only. Low impact for J-A6 because the sheet typically closes on scrim-tap or submit before user resizes. Worth flagging for J-A7+ if longer-lived overlays appear.

### Q6: Is the persisted state intact across reload?

**YES.** v2 schema with v1→v2 migrate that resets to empty (`currentBrandStore.ts:73-81`). `partialize` writes both `currentBrand` and `brands` to AsyncStorage under `mingla-business.currentBrand.v2`. Cold-launch hydrates correctly. Verified by reading the persist config end-to-end.

🟡 **H-3 (already known as D-IMPL-38): Sign-out does NOT clear the brand store.** `account.tsx:56-71` `handleSignOut` calls `await signOut()` + `router.replace("/")` but does NOT call `useCurrentBrandStore.reset()`. After sign-out → sign-in (different user), previous user's brand state persists. Constitutional principle #6 violation. Cycle 1 report flagged this and explicitly deferred to B1 backend cycle (when brand list moves to React Query and a unified sign-out clear pattern lands). NOT a J-A7 blocker — multi-user testing on a single device is the only way to surface it, and Cycle 2 stays single-user.

### Q7: TRANSITIONAL / TODO / FIXME markers in the J-A6 surface?

Grep across `mingla-business/src/components/brand/` and `mingla-business/src/store/`:

- `brandList.ts:4` — `[TRANSITIONAL] stub data — replaces real backend.` Exit: B1.
- `currentBrandStore.ts:10` — `[TRANSITIONAL] phase before B1`. Exit: B1.
- `currentBrandStore.ts:13` — `[TRANSITIONAL] markers in brandList.ts`. Exit: B1.
- `BrandSwitcherSheet.tsx` — **0 markers**. Production-shape code.

No `TODO`, `FIXME`, `XXX`, or `HACK` strings anywhere in the J-A6 surface. Clean.

---

## 6. Findings (classified)

### 🟡 Hidden Flaws (J-A7 dispatch should address)

**H-1 — ID format heterogeneity** (`BrandSwitcherSheet.tsx:69` vs `brandList.ts:17/26/33/45`)
- Current: stub IDs are `lm/tll/sl/hr`; user-created IDs are `b_<ts36>`
- Future risk: J-A7's `/brand/:id/` route resolver must accept both
- Mitigation in J-A7 spec: confirm route resolver is format-agnostic OR normalize stub IDs at seed time
- Severity: cosmetic / spec-clarification

**H-2 — TopSheet viewport-height capture once at mount** (`TopSheet.tsx:116`)
- Current: `Dimensions.get("window").height` evaluated once
- Future risk: web window-resize while overlay open → panel height stale
- Mitigation: subscribe to `Dimensions.addEventListener("change", ...)` if/when long-lived web overlays appear
- Severity: low (J-A6 sheets are short-lived)

**H-3 — Sign-out leaves brand store populated** (`account.tsx:56-71`, see also Cycle 1 D-IMPL-38)
- Current: signOut clears Supabase session but Zustand brand store persists across users
- Future risk: multi-user device testing leaks brand identity
- Mitigation: deferred to B1 per Cycle 1 — when brand list moves to React Query, unified clear pattern applies
- Severity: medium constitutional (#6) but deferred-accepted

**H-4 — Form prefill "Lonely Moth" in additional-create context** (`BrandSwitcherSheet.tsx:90, 96`)
- Current: every create-mode open prefills displayName to literal string "Lonely Moth"
- Sensible for first-brand UX (J-A4 empty state) where the prefill primes the user to type
- For J-A6 (additional brand), user already has brands — seeing an unrelated stub name prefilled is awkward UX, especially if "Lonely Moth" is already in their brand list
- Mitigation: switch to empty-string prefill when `brands.length > 0` (single conditional)
- Severity: minor UX polish

### 🔵 Observations (no action required)

**O-1 — `useBlurOnWeb` naming-as-hook but isn't a hook** (`TopSheet.tsx:81-84`)
- Function name suggests React hook but it's a plain pure function returning a boolean
- Currently safe (no Rules-of-Hooks violation) but lint tools may false-positive
- Worth renaming to `getBlurOnWeb` in a future polish pass

**O-2 — `useBlurOnWeb` called after early return** (`TopSheet.tsx:255` then `259`)
- `if (!mounted) return null;` then `useBlurOnWeb()`
- Safe today because it's not actually a hook (see O-1)
- If a reviewer assumes it IS a hook, they'd flag a Rules-of-Hooks violation

**O-3 — Slug collision risk** (`BrandSwitcherSheet.tsx:62-66`)
- Two brands with identical names → identical slugs (IDs still unique)
- Currently slug is internal-only (URLs use `:id`, not `:slug` per roadmap §2.3)
- If a future feature uses slug as public identifier (share link `mingla.com/sl`), collision matters

**O-4 — TopBar Toast fallback at line 119-123 is dead code** (`TopBar.tsx:115-123`, also Cycle 1 D-IMPL-41)
- All Cycle 1 consumers pass `onBrandTap` so the Toast fallback never fires
- Strings ("Brand creation lands in Cycle 1." / "Brand switcher lands in Cycle 2.") are stale — Cycle 1 has shipped
- Harmless dead branch; defer cleanup

---

## 7. Five-Layer Cross-Check

| Layer | Truth |
|---|---|
| **Docs** | Cycle 1 implementation report claims AC#2/#4 PASS code-trace; J-A6 not separately enumerated but BrandSwitcherSheet's dual-mode design covers it. Roadmap §3.1 line 81 defines J-A6 explicitly. |
| **Schema** | N/A — no backend per DEC-071 |
| **Code** | BrandSwitcherSheet implements dual-mode switch+create with footer flip; create handler appends + activates atomically; Zustand persist v2 stores both lists. Code matches docs. |
| **Runtime** | Code-trace PASS; founder runtime smoke pending (not blocking — Cycle 1 already verified iOS/Android/web bundle compile per its report) |
| **Data** | AsyncStorage key `mingla-business.currentBrand.v2` holds `{currentBrand: Brand|null, brands: Brand[]}`. Migration from v1 cleanly resets to empty. |

**Layers agree.** No contradictions surface.

---

## 8. Blast Radius

J-A6 functionality consumed by:

| Consumer | File | Behavior |
|---|---|---|
| TopBar chip tap | `TopBar.tsx:136` | Triggers sheet open via `onBrandTap` |
| Home tab create button | `home.tsx:308` | Hosts BrandSwitcherSheet, surfaces Toast |
| Account tab brand chip | `account.tsx:118` | Hosts BrandSwitcherSheet (parallel to Home) |
| Dev "Seed 4 stub brands" | `account.tsx:96-102` | Bypasses sheet, populates store directly (test-only) |
| Dev "Wipe brands" | `account.tsx:104-107` | Clears store (test-only) |

**No other surfaces depend on J-A6.** Cycle 2 J-A7 (View profile) and J-A8 (Edit profile) will read brand objects by ID — they will need the brand list and currentBrand to be populated, which J-A6 satisfies.

---

## 9. Invariant Check

| ID | Status | Notes |
|---|---|---|
| I-1 | ✅ | `designSystem.ts` not modified |
| I-2 | ⚠ | Auth flow correct, but D-IMPL-38 (sign-out leaves brand state) is a partial constitutional #6 violation. Deferred-accepted to B1. |
| I-3 | ✅ | iOS/Android/web all execute (web bundle compiles per Cycle 0b/WEB3) |
| I-4 | ✅ | No `app-mobile/` imports |
| I-5 | ✅ | Producer model intact (no consumer-app feature in J-A6) |
| I-6 | ✅ | tsc clean (verified live) |
| I-7 | ✅ | All 3 transitional markers labeled with B1 exit |
| I-8 | ✅ | No Supabase, migrations, RLS, or RPCs touched |
| I-9 | ✅ | TopSheet animation timings unchanged from Cycle 1 lock-in |
| I-10 | ✅ | All £ formatting via `Intl.NumberFormat("en-GB")` |
| DEC-071 | ✅ | Frontend-first; no backend in J-A6 |
| DEC-079 | ✅ | TopBar `onBrandTap` carve-out preserved |
| DEC-080 | ✅ | TopSheet primitive carve-out preserved |
| DEC-081 | ✅ | No `mingla-web/` references |

---

## 10. Recommendations for J-A7 Dispatch

The J-A7 forensics dispatch (View brand profile `/brand/:id/`) should explicitly:

1. **Confirm route resolver tolerates both ID formats** (H-1 mitigation) — `lm/tll/sl/hr` short stubs AND `b_<ts36>` user-created. This is essentially "read the brand from `useBrandList().find(b => b.id === routeParam)`" which is format-agnostic, but spec it.

2. **Define the empty/error states** — what renders when `routeParam` doesn't match any brand in the list (e.g., user pasted a deep link from another device)?

3. **Specify how a brand becomes "current"** — does navigating to `/brand/:id/` auto-set that brand as `currentBrand`? Or does the profile screen render any brand by ID without changing current state?

4. **Optional UX polish — fold H-4 form-prefill cleanup into J-A6 cleanup pass** OR explicitly defer to a Cycle-2 wrap-up polish slice.

D-IMPL-38 (H-3) remains B1-deferred. H-2 (TopSheet viewport capture) is observation-only for J-A7 but worth flagging if J-A7 introduces longer-lived overlays.

---

## 11. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-AUDIT-J-A6-1 | Form prefill "Lonely Moth" feels off in additional-create context (H-4) | Low | Optional polish — fold into a Cycle-2 wrap-up slice OR ship as-is and address in M13 hardening |
| D-AUDIT-J-A6-2 | TopSheet captures viewport height once (H-2) | Low | Web-only edge case; track in case longer overlays appear |
| D-AUDIT-J-A6-3 | `useBlurOnWeb` naming hygiene (O-1) | Info | Rename to `getBlurOnWeb` in a future polish pass |
| D-AUDIT-J-A6-4 | TopBar Toast fallback dead code (O-4) | Info | Defer cleanup; harmless |

No new high-severity discoveries. D-IMPL-38 already known.

---

## 12. Confidence

**HIGH.** Full code-trace performed across 8 files; flow verified end-to-end step-by-step; tsc clean; no platform forks in the J-A6 path; persist migration verified. Runtime smoke deferred (Cycle 1 already verified iOS+Android device + web bundle compile).

---

## 13. Hand-off

Ready for orchestrator to dispatch J-A7 forensics. Recommend folding H-1 (ID format) and H-4 (form prefill) into J-A7 dispatch as explicit scope items. H-2/H-3/O-* tracked for visibility but not blocking.

---

**End of J-A6 pre-Cycle-2 audit.**
