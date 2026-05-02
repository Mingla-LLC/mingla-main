# Implementation — ORCH-BIZ-CYCLE-7-FX3 — Restore brand cover band + retarget close-X

**Status:** implemented, partially verified
**Verification:** tsc PASS · grep PASS · runtime UNVERIFIED (awaits user smoke iOS+Web)
**Scope:** 1 file MOD · ~+18/-9 LOC delta · 0 schema bumps · 0 new deps · 0 new TRANSITIONALs
**Spec:** [Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-7-FX3.md](Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-7-FX3.md)
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-7-FX3.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-7-FX3.md)

---

## 1 — Mission

Brand cover band on `/b/{slug}` rendered as black canvas on iOS+Android (oklch silently
rejected by RN normalize-colors) and dimmed into near-black on web (55% dark overlay
on top of valid color). Same bug at event mini-card cover thumbs. Plus close-X
overshooting back to Account tab. Surgical 6-edit fix.

---

## 2 — Old → New Receipts

### `mingla-business/src/components/brand/PublicBrandPage.tsx`

**Edit 1 — Hero band cover color (was line 232)**
- Before: `{ backgroundColor: \`oklch(0.45 0.16 ${brand.coverHue})\` }`
- After: `{ backgroundColor: \`hsl(${brand.coverHue}, 60%, 45%)\` }`
- Plus inline comment block updated to reference FX3 lesson (was: "Uses oklch for color richness; older browsers gracefully degrade…").
- Why: AC#1-#6 — RN normalize-colors only accepts hex/rgb/hsl/hwb. oklch silently fails on iOS+Android.
- Lines: ~+3 / -3

**Edit 2 — Event mini-card cover thumb (was line 671)**
- Before: `{ backgroundColor: \`oklch(0.45 0.16 ${event.coverHue})\` }`
- After: `{ backgroundColor: \`hsl(${event.coverHue}, 60%, 45%)\` }`
- Why: AC#7 — same bug, second site. Forensics RC-2.
- Lines: ~+1 / -1

**Edit 3 — heroFade overlay 0.55 → 0.30**
- Before: `backgroundColor: "rgba(12, 14, 18, 0.55)"`
- After: `backgroundColor: "rgba(12, 14, 18, 0.30)"` + comment teaching the FX3 lesson
- Why: AC#6, AC#8 — at α=0.55 the overlay dimmed even valid web oklch into near-black. At α=0.30 the cover hue reads clearly while a subtle bottom-fade is preserved.
- Lines: ~+3 / -1

**Edit 4 — heroGradient static fallback restored**
- Before: empty rule body (just position) with comment about Safari ≤15 + oklch
- After: `backgroundColor: "rgba(255, 255, 255, 0.04)"` + comment teaching RN color-format constraint
- Why: AC#9, CF-2 — defensive fallback if inline color fails for any reason. Subtraction-before-addition: old comment + style removed before new restored.
- Lines: ~+5 / -2

**Edit 5 — handleClose retargeted**
- Before: `router.replace("/(tabs)/account" as never)` with deps `[router]`
- After: `router.replace(\`/brand/${brand.id}\` as never)` with deps `[router, brand.id]` + comment explaining the routing intent
- Why: AC#10, AC#11, CF-3 — founder lands on their brand profile (where they can Edit/Team/Stripe), not all the way at Account. Native back from there returns to Account.
- Lines: ~+4 / -1

**Edit 6 — Header docstring "Platform notes" added**
- Before: docstring ended at "Per Cycle 7 spec §1-§11 (forensics) + §12 (orchestrator addendum)."
- After: appended a "Platform notes (color formats — Cycle 7 FX3 lesson)" section explaining RN normalize-colors limitation + recommendation to mirror EventCover hsl(hue, 60%, 45%) pattern.
- Why: AC#12 prevention surface — make the lesson grep-findable for future devs.
- Lines: ~+10 / -0

**Total file delta:** ~+26 / -8 (net ~+18) — within spec estimate of 10-15 LOC core change + ~10 LOC docstring.

---

## 3 — Spec Traceability

| AC | Implementation | Status |
|----|---------------|--------|
| AC#1 — iOS LM cover orange (hsl 25) | Edit 1 — hsl pattern proven by EventCover.tsx | UNVERIFIED — needs iOS smoke |
| AC#2 — iOS SL cover blue (hsl 220) | Edit 1 — same | UNVERIFIED — needs iOS smoke |
| AC#3 — iOS TLL cover magenta (hsl 320) | Edit 1 — same | UNVERIFIED — needs iOS smoke |
| AC#4 — iOS HR cover purple-pink (hsl 290) | Edit 1 — same | UNVERIFIED — needs iOS smoke |
| AC#5 — Android same 4 brands | Edit 1 — RN normalize-colors identical Android | UNVERIFIED — needs Android smoke |
| AC#6 — Web Chrome 4 brands hue visible (not black) | Edit 1 + Edit 3 (overlay 0.55→0.30) | UNVERIFIED — needs web smoke |
| AC#7 — Event mini-card hue thumbs iOS+Android+Web | Edit 2 | UNVERIFIED — needs smoke |
| AC#8 — heroFade still produces subtle bottom-fade | Edit 3 — α=0.30 preserves fade, opacity math: visible_lightness ≈ 0.34 (vs 0.23 at 0.55) | PASS by construction |
| AC#9 — heroGradient fallback shows faint tint if inline fails | Edit 4 — `rgba(255,255,255,0.04)` static color | PASS by construction |
| AC#10 — close X → /brand/{id} | Edit 5 — `router.replace(\`/brand/${brand.id}\`)` | UNVERIFIED — needs smoke |
| AC#11 — from /brand/{id} back → /(tabs)/account | Existing route stack behavior — unchanged | UNVERIFIED — needs smoke |
| AC#12 — grep oklch in src returns 0 inline-style hits | `grep -rn "oklch(" mingla-business/src` returns only EventCover.tsx docstring lines 6, 9 | PASS |
| AC#13 — TypeScript strict EXIT=0 | `cd mingla-business && npx tsc --noEmit` | PASS |
| AC#14 — NO regression on Cycle 6 PublicEventPage | Untouched — orthogonal file | PASS by construction |
| AC#15 — NO regression on BrandEditView cover preview | Uses EventCover primitive (untouched) | PASS by construction |
| AC#16 — NO regression on CreatorStep4Cover | Untouched — orthogonal file | PASS by construction |

---

## 4 — Verification Output

### grep oklch
```
$ grep -rn "oklch(" mingla-business/src
mingla-business/src/components/ui/EventCover.tsx:6: * The web reference uses CSS `repeating-linear-gradient` with `oklch()`
mingla-business/src/components/ui/EventCover.tsx:9: * with `oklch(0.55 0.18 hue)` and `oklch(0.50 0.16 hue)` approximated to
```
Both hits are in EventCover.tsx **docstring/comments** — not active inline-style usage. AC#12 explicitly permits this ("Docstring/comment references…are fine").

### tsc
```
$ cd mingla-business && npx tsc --noEmit
EXIT=0
```
Clean.

---

## 5 — Invariant Verification

| Invariant | Status |
|-----------|--------|
| I-11 format-agnostic ID | PRESERVED (no event ID/format changes) |
| I-12 host-bg cascade | PRESERVED (untouched) |
| I-13 overlay-portal contract | PRESERVED (untouched) |
| I-14 date-display single source | PRESERVED (untouched) |
| I-15 ticket-display single source | PRESERVED (untouched) |
| I-16 live-event ownership separation | PRESERVED (founder navigation now lands on owned brand profile, no ownership crossover) |
| I-17 brand-slug stability | PRESERVED (no slug logic touched) |
| Constitution #1 No dead taps | RESTORED — cover band now visibly renders; close-X now lands somewhere meaningful |
| Constitution #2 One owner per truth | PRESERVED — coverHue still owned by Brand schema |
| Constitution #8 Subtract before adding | HONORED — old comments + old style values removed BEFORE new ones added |
| Constitution #9 No fabricated data | PRESERVED — real founder-chosen hue renders, no faking |

---

## 6 — Cache Safety

No query keys, no Zustand state, no AsyncStorage paths touched. Pure rendering + nav-target change. Existing v11 brands hydrate identically.

---

## 7 — Regression Surface

5 features most likely to break (tester should manually verify):

1. **BrandEditView cover preview** — uses EventCover primitive, untouched. Verify live preview still updates as founder taps swatches.
2. **CreatorStep4Cover (event creator wizard)** — untouched. Verify cover swatch step still works.
3. **Cycle 6 PublicEventPage** — orthogonal file. Verify share modal mount, founder close X, web SEO Head all still work.
4. **Founder brand profile route `/brand/{id}`** — must accept the new redirect target without errors. Verify the page loads and founder can tap Edit / Team / Stripe pills.
5. **Cold start (AsyncStorage clear)** — clear, reload, re-seed brands, re-open SL → cover renders blue cleanly. Validates migration → render full path.

---

## 8 — Constitutional Compliance Quick-Scan

- #1 No dead taps — cover band restored from invisible-black to visible color. Close-X now actionable target.
- #2 One owner per truth — preserved.
- #3 No silent failures — N/A (no error paths touched).
- #6 Logout clears — N/A (no auth state touched).
- #7 TRANSITIONAL labels — none added; OG image placeholder unchanged.
- #8 Subtract before add — honored on every edit.
- #9 No fabricated data — preserved.
- #14 Persisted-state startup — preserved (no schema/migration change).

---

## 9 — Discoveries for Orchestrator

**D-IMPL-CYCLE7-FX3-1 (Note severity)** — `EventCover.tsx` lines 6 and 9 contain `oklch()` references in the **header docstring** explaining the original web pattern that was approximated to RN. These are doc-only and harmless, but if a future dev grep-finds "oklch" looking for the bug, they'll land on docstring text. Consider editing those comment lines to add a "(web only — not used in RN render)" note. **Not blocking, low effort, low value.**

**D-IMPL-CYCLE7-FX3-2 (Note severity)** — Memory rule candidate: `feedback_rn_color_formats.md` codifying the RN-supported color functions (hex/rgb/rgba/hsl/hsla/hwb only). The header docstring + heroGradient inline comment now teach the lesson at the call site, but a project-level memory entry would protect adjacent code (e.g., kit primitives, future event-page redesigns). Orchestrator decision.

**D-IMPL-CYCLE7-FX3-3 (Note severity)** — `useBrandList()` currently returns ALL stub brands regardless of user (per existing comment lines 95-97 in PublicBrandPage). This means `ownsThisBrand` resolves to "isSignedIn" today. Not a bug (well-documented forward-compat for B-cycle backend wire-up), but worth flagging that the new close-X target `/brand/${brand.id}` will work for any signed-in user across any brand they don't actually own — once real ownership filtering ships, this naturally tightens. **No action needed in this dispatch.**

**D-IMPL-CYCLE7-FX3-4 (Note severity)** — The heroGradient docstring/comment update places the RN color-format lesson at the inline style level. The header docstring also got a "Platform notes (color formats)" section. Two protective surfaces, both grep-findable on "oklch" or "normalize-colors". This is intentional belt-and-suspenders.

**No other side issues.**

---

## 10 — Files Touched

| File | Type | LOC delta |
|------|------|-----------|
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | MOD | ~+26 / -8 |

Total: 1 file, ~+26 / -8 (net ~+18).

---

## 11 — TypeScript Strict

```
$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

Clean.

---

## 12 — Bundling

This fix bundles into the Cycle 6 + Cycle 7 main + FX1 + FX2 + FX3 commit. No separate
commit needed. Orchestrator handles the bundled commit message at CLOSE protocol after
smoke pass.

---

## 13 — What user should smoke (test first)

1. **Web Chrome (highest priority — fastest signal):**
   - Open `/b/lonelymoth`, `/b/sundaylanguor`, `/b/thelonglunch`, `/b/hiddenrooms`
   - Confirm cover bands render orange/blue/magenta/purple-pink (NOT a black canvas)
   - Tap close X → land on `/brand/{id}` (NOT `/(tabs)/account`)
   - Open Upcoming/Past tabs → mini-card cover thumbs render their hue
2. **iOS sim (for AC#1-#5 and AC#7 verification):**
   - Same 4 brand pages — covers render their hue (this is the BIG one — proves oklch→hsl fixed iOS)
   - Mini-card thumbs render hue
   - Close X → `/brand/{id}` then native back → Account tab
3. **Regression sanity:**
   - BrandEditView → BRAND COVER section live preview still updates as you tap swatches
   - Event creator wizard step 4 cover swatches still work
   - Publish event end-to-end on SL → still routes to `/e/sundaylanguor/{slug}`
