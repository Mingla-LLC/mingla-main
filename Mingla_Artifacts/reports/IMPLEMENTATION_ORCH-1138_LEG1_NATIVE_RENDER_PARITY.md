# IMPLEMENTATION — ORCH-1138 Leg-1 [public trip page — NATIVE-render parity fixes]

**Status:** implemented; BUG-2 resolver runtime-verified + BUG-1 root cause proven against live DB; RT-6 green with fails-on-revert proven. Native on-device render NOT re-verified this session (would have required hijacking a parallel session's Metro on :8081 / a ~30-min CNG native rebuild) — see §9. NOT deployed / merged / closed.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`.
**Baseline HEAD:** `4cacdacff`. **New commit:** `7edf9090d`.
**Binding design:** `Mingla_Artifacts/design/ORCH-1138/DIRECTION_A_V2_FULL_RESPONSIVE.html` (meta-chip row + Leaving-from→Destination block). SPEC: `SPEC_ORCH-1138_LEG1_FOUNDATION_AND_TRIP.md` (+ new amendment A-3).

---

## 1. Summary

Two things were still wrong on the business iOS dev build after the R2 pass (correct on react-native-web): (1) the "seats left · max" chip, the destination "📍" chip, and the destination half of the "Leaving from → Destination" route block did not render; (2) text that should be bold rendered at regular/medium weight. Both are now fixed for native AND web. The R2 pass mis-diagnosed both (it called BUG-1 "correct rule-9 hiding" and BUG-2 "fixed by loading the font") because it reasoned from source only; a live-DB read disproved the first and RN-native font semantics disproved the second.

---

## 2. ROOT CAUSES (file:line)

### BUG-1 — `mingla-business/src/hooks/usePublicTripBySlug.ts` (pre-fix lines 274-277 + 297)
The public trip hook mapped `businessTrip.destinationLocationText` and `businessTrip.capacity` **only** from the `events.theme.business_trip` JSON mirror. That mirror is **NULL** for trips authored via the canonical columns. Proven against the live DB row "The DC Adventure" (id `060d0483-50db-48d1-840b-73d9fc59356a`):
- `theme.business_trip.destinationLocationText` = **null**, `.capacity` = **null**
- `events.destination_text` = "Washington, District of Columbia, United States", `ticket_types[0].quantity_total` = **102**

The authenticated path's `readBusinessTrip` (`tripsService.ts:448` destination, `:461` capacity) already reads canonical-first; the public hook did **not** — except `departureLocationText` (pre-fix line 287 already read `event.departure_text` first), which is exactly why departure rendered while destination + capacity (+ the destination route leg) hid via the rule-9 null-guard. This is a shared hook with no `.web` variant → the SAME render path on web; the older web evidence was captured against a data state where the mirror happened to be populated. NOT a native-vs-web *render* divergence — a data-mapping gap that the fix corrects on both platforms.

### BUG-2 — `packages/event-rendering/designTokens.ts:127` (`FONT_FAMILY_MAP`) consumed by `TripPreview.tsx` styles
`FONT_FAMILY_MAP` loads exactly one **non-bold** variant per theme font (e.g. `inter → "Inter_500Medium"`). `TripPreview`/route set `fontFamily: <medium family>` and rely on the StyleSheet's `fontWeight: "900"`/`"800"` for bold. On iOS/Android **a loaded custom font does not respond to `fontWeight`** — the text renders at the loaded weight (medium). react-native-web synthesizes bold from CSS `font-weight`, so the web looked correct — the precise reason this was native-only. (Note: the prompt's premise that `PublicEventPage.tsx` already renders bold via font-family-per-weight is INACCURATE — the event page uses the identical `fontFamilyValue` + `fontWeight` pattern and therefore has the same latent native issue; there was no existing per-weight resolver to mirror, so one was built.)

---

## 3. FIXES

### BUG-1 (in §12 allowlist — the hook)
`businessTrip.destinationLocationText` ← `events.destination_text` (canonical) first, `theme.business_trip.destinationLocationText` fallback. `businessTrip.capacity` ← `ticket_types[0].quantity_total` (canonical, mirrors `readBusinessTrip`) first, `theme.business_trip.capacity` fallback. No new query (both already fetched).

### BUG-2 (new weight-aware resolver + on-demand bold load)
- `packages/event-rendering/themePalette.ts` (allowlist, NEW file) — added `FONT_FAMILY_BOLD_MAP` (slug → `*_700Bold` loaded family; the 3 single-weight display faces `dm_serif_display`/`bebas_neue`/`anton` fall back to their base family since no bold variant is published) + `boldFontFamily(theme)` resolver.
- `packages/event-rendering/index.ts` (allowlist) — exported both.
- `mingla-business/src/theme/themeFonts.ts` (**out-of-allowlist — authorized by SPEC amendment A-3**) — registered the 11 `*_700Bold` dynamic-`import()` load thunks so `useThemeFont`/`loadThemeFont` can register the bold face on demand (same ORCH-1083 boot-budget deferral; `useThemeFont.ts` unchanged — it already loads any registered family). Without this, `useThemeFont(boldFamily)` is a no-op and native keeps the system fallback.
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (allowlist) — `const boldFamily = boldFontFamily(theme); useThemeFont(boldFamily);` (additive — the medium `useThemeFont(theme.fontFamilyValue)` is preserved verbatim) + threaded `boldFamily` to the payment amount, desktop reserve CTA, and `TripReserveBar`.
- `mingla-business/src/components/trip/TripPreview.tsx` (allowlist) — `const boldFamily = boldFontFamily(theme)`; every bold element now sets `fontFamily: boldFamily`: title, hero title, all 7 section headings, brand name, day titles (via DayByDay), the 4 meta-chip VALUES (MetaChip gained a `fontFamily` prop), the route place VALUES. (The medium `theme.fontFamilyValue` is no longer referenced on this page — the mockup renders the brand face only at bold weights; small-caps eyebrows/labels stay on the system font per DIRECTION_A_V2.)

Verified each bold thunk's named export exists in the installed package (e.g. `Inter_700Bold`, `PlayfairDisplay_700Bold`, … all 11 present); `FONT_FAMILY_BOLD_MAP` values match exactly.

---

## 4. SPEC success-criteria coverage

| SC | Status | Evidence (commit `7edf9090d`) |
|---|---|---|
| BUG-1 chips+route render given data (web+native) | ✓ source + DB-proven | hook reads canonical destination/capacity; render path unchanged. Native-render UNVERIFIED on device (§9). |
| BUG-1 per-field hide when absent (rule 9) | ✓ | canonical-first then theme-fallback then `null`; chip/leg still gated on `!= null`. |
| BUG-2 bold renders on native | ✓ runtime resolver / UNVERIFIED on device | `boldFontFamily("inter") === "Inter_700Bold" !== FONT_FAMILY_MAP.inter`; bold face registered + loaded. |
| native AND web both correct | ✓ (web automatic — shared code; native by RN reasoning) | no `.web` fork; rn-web honors the weighted family too. |
| protected callers byte-identical (no palette) | ✓ | LEGACY path untouched; never calls `boldFontFamily`; RT-2 4/4 green. |
| no new dep / no schema / no edge | ✓ | bold packages already deps; zero migration/edge/RLS. |

---

## 5. Files changed (vs `4cacdacff`)

| File | In allowlist | Δ |
|---|---|---|
| `mingla-business/src/hooks/usePublicTripBySlug.ts` | yes | +25 / −6 |
| `packages/event-rendering/themePalette.ts` | yes (NEW) | +54 |
| `packages/event-rendering/index.ts` | yes | +5 |
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | yes | +15 / −3 |
| `mingla-business/src/components/trip/TripPreview.tsx` | yes | +66 / −19 |
| `mingla-business/src/theme/themeFonts.ts` | **no — A-3** | +41 |
| `mingla-business/src/components/trip/__tests__/tripNativeRenderParity.orch1138.test.ts` | yes (NEW test) | +173 |
| `Mingla_Artifacts/specs/SPEC_ORCH-1138_LEG1_FOUNDATION_AND_TRIP.md` | doc (A-3) | +16 |

## 6. Data-model changes — NONE. ## 7. Edge functions — NONE.

---

## 8. Regression test — fails-on-revert PROVEN

**RT-6** `mingla-business/src/components/trip/__tests__/tripNativeRenderParity.orch1138.test.ts` — 8 tests (8 passed). BUG-2 is RUNTIME-tested (the resolver is a pure function); BUG-1 is source-pinned canonical-first (the hook can't mount under ts-jest — mirrors the RT-5 style) + DB-proven.

**fails-on-revert verified at `7edf9090d`** by TRUE line-deletion of BOTH fixes simultaneously:
- reverted `boldFontFamily` to return `theme.fontFamilyValue` → `✕ BUG-2: boldFontFamily returns the 700Bold family` FAILED.
- reverted the hook's destination mapping to theme-only → `✕ BUG-1: reads destination from the CANONICAL column first` FAILED.
- Result: 2 failed / 6 passed. Restored both → 8/8 PASS.

Append-only: one NEW test file; zero existing tests modified (`tests-append-only` satisfied).

## 9. Smoke / runtime

- **RT-6 + RT-1/RT-2/RT-3 + RT-5 + isolation:** 26/26 PASS together (incl. protected-caller byte-identity RT-2).
- **Full `src/components/trip/__tests__/`:** 483 passed / 27 failed. The 27 are the documented pre-existing baseline (EditPublishedTripScreen, PaymentPlanEditor, IntakeTypePicker, TripCreatorWizard.cover, TripPublishStripeBanner, TripVisualParity[+adversarial], tr2RewordPolish). Stash-baseline of the two route-reading suites = 9/9 failing both before AND after my change → **ZERO new failures**.
- **tsc:** zero errors in any of my 7 changed files (315 unrelated pre-existing repo errors unchanged).
- **strict-grep:** package-isolation PASS; tr2-safearea exit 0 (route allow-comment unchanged); comms-ledger-stanza exit 0.
- **NATIVE ON-DEVICE: NOT re-verified.** The only booted sim's dev build + the running Metro (:8081) both point at the ANCHOR (`~/Desktop/mingla-main/mingla-business`) — a parallel session. Hijacking that Metro or starting a competing one would clobber that session (session-hygiene). A clean CNG native rebuild (~30 min, no `ios/` prebuild in this worktree) was not warranted for a pure-JS change whose correctness is covered by the runtime resolver test + the proven on-demand font-load mechanism. Correctness rests on RN-native reasoning (loaded-font-ignores-fontWeight; the existing `useThemeFont` load path is already device-proven for the medium family in R2) + the DB-proven data fix.

## 10. Known issues / deferred

- The medium `theme.fontFamilyValue` is now unreferenced on the trip page (all themed text is bold per the mockup); it is still LOADED (`useThemeFont(theme.fontFamilyValue)` preserved for RT-5 + any future medium use). Intentional, not dead code.
- **Cross-page latent bug (Discoveries #1):** `PublicEventPage.tsx` + `PublicBrandPage.tsx` use the SAME `fontFamilyValue` + `fontWeight` pattern → they likely render non-bold on native too. NOT fixed here (out of this leg's allowlist / scope). `boldFontFamily` is exported and ready for those legs.

## 11. Operator action required

- **No migration, no edge deploy.** Pure-JS/RN render change.
- **Route to mingla-tester** for the device-render confirmation this session could not do safely: on the business iOS dev build, open a `/t/{brandSlug}/{tripSlug}` for a canonical-authored trip (e.g. "The DC Adventure") and confirm (a) the seats chip + destination chip + the full Leaving-from→Destination block now render, and (b) the title/headings/chip values/price/CTA render BOLD. Then per memory: re-OTA (`eas update`, per-platform) after Seth's PASS.

## 12. Discoveries for Orchestrator

1. **`PublicEventPage.tsx` + `PublicBrandPage.tsx` share BUG-2's pattern** (medium family + `fontWeight`) → bold likely fails on native there too. Register a follow-on to apply `boldFontFamily` to those pages (the resolver is already shared/exported).
2. **The R2 pass's source-only verdicts were wrong on BOTH bugs** — BUG-1 was called "correct rule-9 hiding" and BUG-2 "fixed by the medium font load." The forensics-must-drive-runtime principle held: a 30-second live-DB read + RN-native font semantics overturned both. Light data probe was decisive.
3. **`theme.business_trip` JSON mirror is a stale denormalization** — for canonical-authored trips it's null while the real `events.*` columns + ticket rows carry truth. Any other public surface reading the mirror directly (not via `readBusinessTrip`) risks the same hidden-field bug; worth an audit.
