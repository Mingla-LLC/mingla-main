# Investigation — J-A7 (View Brand Profile, Founder View)

> **Mode:** Forensics INVESTIGATE (greenfield spec preparation)
> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A7
> **Codebase:** `mingla-business/`
> **Predecessor:** J-A6 audit `AUDIT_BIZ_CYCLE_2_J_A6_PREFLIGHT.md` (⚠ PASS WITH CARVE-OUTS)
> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_2_J_A7_BRAND_PROFILE.md`
> **Auditor turn:** 2026-04-29
> **Confidence:** **High** — designer handoff §5.3.3 read end-to-end; design-package screens-brand.jsx read line-by-line; current code state confirmed across 3 files; all 4 carve-outs from J-A6 audit cross-referenced

---

## 1. Symptom Summary

Greenfield spec preparation. No bug. The J-A7 surface (`/brand/:id/` — founder view of brand profile) does not yet exist in code. Cycle 2 needs a precise spec to drive implementation.

**Expected post-J-A7 state:**
- Tapping any brand row from Account tab navigates to `/brand/:id/`
- Profile screen renders read-only sections: identity, bio, contact, social, stats, recent events
- Edit CTA placeholder visible, fires Toast until J-A8 lands
- Mobile + web parity per DEC-071

**Current state:**
- `app/brand/` directory does not exist
- No dynamic Expo Router routes anywhere (`find mingla-business/app -name "[*]*"` empty)
- Account tab has NO brand-rows section yet — only sign-out + dev seed/wipe buttons
- `Brand` type lacks bio, contact, links fields
- Stub `STUB_BRANDS` (brandList.ts) lacks bio, contact, links data

---

## 2. Investigation Manifest

| File | Layer | Read end-to-end? | Findings |
|---|---|---|---|
| Dispatch `FORENSICS_BIZ_CYCLE_2_J_A7_BRAND_PROFILE.md` | Spec input | ✅ | scope + carve-out routing + forbidden zones |
| `AUDIT_BIZ_CYCLE_2_J_A6_PREFLIGHT.md` | Predecessor | ✅ | H-1 (ID format tolerance) explicit; H-4 deferred |
| `IMPLEMENTATION_CYCLE_1_ACCOUNT_ANCHOR.md` | Cycle 1 baseline | ✅ | Brand type schema, persist v2, BrandSwitcherSheet, current Account layout |
| `SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` | Roadmap | ✅ (§3.2 + journey table + component map) | J-A7 row line 82, Cycle 2 line 427, design-package mapping line 235 |
| `HANDOFF_BUSINESS_DESIGNER.md` §5.3.3 | Design ground truth | ✅ (line 1825-1830) | **Authoritative for J-A7** — hero + stats strip + Recent events + sticky shelf |
| `HANDOFF_BUSINESS_DESIGNER.md` §5.3.5 | Design ground truth (J-A8) | ✅ (line 1837-1842) | Editor scope — out of scope for J-A7 |
| `design-package/.../screens-brand.jsx` line 126-196 | Design package | ✅ | Confirms: this component is the EDITOR (§5.3.5), NOT the founder view (§5.3.3) |
| `mingla-business/src/store/currentBrandStore.ts` | State schema | ✅ | Brand type missing bio/contact/links |
| `mingla-business/src/store/brandList.ts` | Stub data | ✅ | STUB_BRANDS missing bio/contact/links |
| `mingla-business/app/(tabs)/account.tsx` | Entry point | ✅ | No brand-rows section — must be added in J-A7 |
| `mingla-business/app/_layout.tsx` | Root | ✅ | GestureHandlerRootView + SafeAreaProvider mounted at root — `/brand/[id]/` will inherit both |
| `mingla-business/app/(tabs)/_layout.tsx` | Tabs layout | ✅ | Floating BottomNav; non-tab routes won't show it (correct for J-A7) |
| `DECISION_LOG.md` | DEC entries | ✅ | DEC-071 (frontend-first), DEC-079 (kit closure), DEC-080 (TopSheet) |

`npx tsc --noEmit` exit 0.

---

## 3. Findings (classified)

### 🔴 Root Causes — None (greenfield spec)

### 🟠 Contributing Factors — None

### 🟡 Hidden Flaws (spec MUST address)

**H-A7-1 — Design package does NOT contain a J-A7 (founder-view) mockup**

- File: `Mingla_Artifacts/design-package/.../screens-brand.jsx:126`
- Component name: `BrandProfileScreen`
- Title shown: `"Brand profile"` but section comment line 125: `// ===== BRAND PROFILE EDITOR =====`
- Header: `<TopBar leftKind="back" onBack={onBack} title="Brand profile" right={<button ...>Save</button>}/>`
- The "Save" button + chevR-arrowed FieldRow + "Edit photo" pencil button (line 146-151) prove this is the EDITOR (§5.3.5 / J-A8), NOT the founder view (§5.3.3 / J-A7)
- **Authoritative source for J-A7 is the designer handoff §5.3.3 text** (lines 1825-1830 of `HANDOFF_BUSINESS_DESIGNER.md`), which describes:
  - Hero glass card elevated: brand photo + name + bio + contact + social chips
  - Stats strip: total events, total attendees, GMV (only with finance access — for J-A7 founder always has access)
  - Recent events list
  - Sticky bottom shelf: "Edit brand" + "View public page"
  - States: default · empty bio (inline CTA) · stripe-not-connected banner
  - Edge: long bio → expandable "Read more"
- **Spec mitigation:** spec section 4 must derive the J-A7 layout from §5.3.3 text, not from the design-package component. Implementor builds a NEW component; does NOT port the editor.

**H-A7-2 — Brand type lacks fields required by J-A7**

- File: `mingla-business/src/store/currentBrandStore.ts:45-53`
- Current Brand fields: `id, displayName, slug, photo?, role, stats {events, followers, rev}, currentLiveEvent`
- Missing: `bio?, tagline?, contact? {email?, phone?}, links? {website?, instagram?, custom?}`
- Missing stat: `attendees` (§5.3.3 "total attendees")
- §5.3.3 requires bio + contact + social to render — without these the screen is empty
- **Spec mitigation:** extend `Brand` type with optional bio + tagline + contact + links + stats.attendees. Bump Zustand persist v2 → v3 with migration that preserves existing data and defaults new fields to undefined/null. Update STUB_BRANDS (brandList.ts) to populate the new fields.

**H-A7-3 — Account tab has no brand-rows section (entry point missing)**

- File: `mingla-business/app/(tabs)/account.tsx:115-174`
- Current Account layout: TopBar + GlassCard (sign out + dev styleguide) + dev card (seed/wipe buttons)
- Roadmap line 82: J-A7 entry is "Account → tap brand row → /brand/:id/"
- No brand-rows section exists today
- **Spec mitigation:** spec must add a "Your brands" section to account.tsx — list of brand rows (avatar + name + sub-text) → tap navigates to `/brand/${brand.id}/`. Empty state when `brands.length === 0`. Place above the dev card.

**H-A7-4 — Edit CTA navigates to non-existent route**

- §5.3.3 requires sticky shelf with "Edit brand" → `/brand/:id/edit` (J-A8)
- J-A8 is OUT OF SCOPE for this dispatch — the route file `app/brand/[id]/edit.tsx` won't exist post-J-A7
- Tapping Edit pre-J-A8 must NOT navigate to a 404
- **Spec mitigation:** Edit CTA fires `[TRANSITIONAL]` Toast "Editing lands in J-A8" until the J-A8 dispatch ships. Same pattern for "View public page" (Cycle 3+ destination), Payments/Team/Tax/Reports rows (J-A9–A12 destinations).

**H-A7-5 — ID format heterogeneity (carry-over from J-A6 audit H-1)**

- Stub IDs: `lm/tll/sl/hr` (2-3 char, no prefix)
- User-created IDs: `b_<ts36>` (prefix + base36 timestamp)
- `/brand/:id/` lookup uses `useBrandList().find(b => b.id === id)` — format-agnostic by design
- **Spec mitigation:** spec MUST verify route resolver works for both formats (test case T-A7-08). Spec says: do NOT add format normalization; the lookup is intentionally format-agnostic so future ID schemes (UUID, etc.) work without spec change.

### 🔵 Observations

**O-A7-1 — Long-bio "Read more" expansion** (§5.3.3 edge case)
- Required per design but adds component complexity
- Recommendation: ship in J-A7 if straightforward (1 paragraph cap with "Read more" toggle); defer if it requires layout measurement gymnastics. Spec offers both paths.

**O-A7-2 — Stripe-not-connected banner** (§5.3.3 state)
- Required per design, but Cycle 2 has no Stripe connection state yet (J-A10 lands the shell)
- Recommendation: render the banner unconditionally as `[TRANSITIONAL]` until J-A10 introduces the `'not_connected' | 'onboarding' | 'active' | 'restricted'` state field on Brand. Banner says "Connect Stripe to sell tickets" + inert tap (Toast).

**O-A7-3 — "Recent events" list is per §5.3.3** but actual events don't exist until Cycle 3 (event creator)
- Recommendation: render `[TRANSITIONAL]` stub rows (similar pattern to Home tab's STUB_UPCOMING_ROWS in home.tsx:66-83). Different copy: "Recent events" not "Upcoming". Empty-state text: "No events yet — events you create will show here."

**O-A7-4 — `useCurrentBrand` auto-set on view-by-id** — open question
- When user navigates `/brand/:id/`, does `currentBrand` auto-update to that brand?
- Pro: keeps TopBar chip (Home tab) consistent if user navigates back via tabs
- Con: surprising side-effect — viewing != selecting
- Recommendation: do NOT auto-set. The profile screen is a "look at any brand" surface, not a switch action. The brand chip continues to show whatever was active before navigation. Spec it explicitly as design intent.

**O-A7-5 — Deep-link cold launch on web** (DEC-071 mobile+web parity)
- User pastes `/brand/lm/` URL into browser → Expo Router web mounts the route directly
- BrandProfileScreen reads `useBrandList()` → list is empty if Zustand has not hydrated yet OR user has no seeded brands
- Recommendation: render "Brand not found" state when `useBrandList().find(...) === undefined`. Spec test case T-A7-08 covers this.

---

## 4. Five-Layer Cross-Check

| Layer | Truth |
|---|---|
| **Docs (designer handoff §5.3.3)** | Founder-view scope: hero + stats + recent events + sticky shelf |
| **Docs (roadmap §3.2 + journey table)** | J-A7 = View brand profile, route `/brand/:id/`, source `BrandProfileScreen` |
| **Schema** | N/A (no backend per DEC-071) |
| **Code (current)** | Brand type + STUB_BRANDS lack required fields; route file + Account brand-rows entry don't exist yet |
| **Runtime** | N/A (greenfield) |
| **Data** | AsyncStorage persist v2 — must migrate to v3 with new optional fields |

**Layer agreement:** docs (handoff §5.3.3) and roadmap agree on J-A7 = founder-view profile screen. Design-package component is mismapped to J-A7 in some readings; investigation H-A7-1 corrects this.

---

## 5. Blast Radius

J-A7 ships a new route `/brand/[id]/` and adds a brand-rows section to Account. Post-J-A7 the dependency chain is:

| Surface | Depends on J-A7 |
|---|---|
| J-A8 (`/brand/[id]/edit`) | Edit CTA wires from J-A7 sticky shelf |
| J-A9 (`/brand/[id]/team`) | Team row in Operations section navigates here |
| J-A10–A11 (`/brand/[id]/payments` + `/payments/onboard`) | Payments row in Operations section + stripe-not-connected banner CTA |
| J-A12 (`/brand/[id]/payments/reports`) | Finance reports row in Operations section |
| Brand type schema (v3) | All future cycles read the new fields |

**Other surfaces touched (out of scope, no changes):**
- Home tab — unchanged
- BrandSwitcherSheet — unchanged (J-A6 audit confirmed)
- TopBar — unchanged (`leftKind="back"` already supported via Cycle 0a)

---

## 6. Invariant Check (preview — full list in spec)

| ID | Risk |
|---|---|
| I-1 | designSystem.ts not modified — easy to preserve |
| I-3 | iOS / Android / web execute — Expo Router dynamic routes work on all 3 |
| I-4 | No `app-mobile/` imports — no risk |
| I-6 | tsc strict — must add explicit return types on new component |
| I-7 | Label transitionals — Edit CTA Toast, Stripe banner, Recent events stub all need `[TRANSITIONAL]` markers with B1/Cycle-3+ exit |
| I-9 | No animation timings — TopBar back-arrow nav is instant; profile screen has no entrance anim required |
| DEC-071 | Frontend-first — Brand type extension is client-only |
| DEC-079 | Kit closure preserved — verify all sections compose from existing 24 + TopSheet primitive |
| DEC-080 | No TopSheet usage — J-A7 is a route, not an overlay |

---

## 7. Fix Strategy (direction only — spec carries detail)

1. **Extend Brand type** (currentBrandStore.ts) with optional bio, tagline, contact, links, stats.attendees. Bump persist v2 → v3 with safe migration.
2. **Extend STUB_BRANDS** (brandList.ts) with realistic stub data for the 4 brands so J-A7 renders meaningful content immediately after "Seed 4 stub brands".
3. **Add brand-rows section** to Account tab — between sign-out card and dev card. Each row is a Pressable that navigates to `/brand/${id}/`.
4. **Create new route** `app/brand/[id]/index.tsx` — uses `useLocalSearchParams<{id: string}>()` + `useBrandList().find(...)`. Renders BrandProfileView component.
5. **Build BrandProfileView component** at `src/components/brand/BrandProfileView.tsx` — composed from Cycle 0a kit primitives. Sections: hero → stats strip → about → contact → social → operations → recent events → sticky shelf.
6. **Sticky shelf**: "Edit brand" + "View public page". Both fire `[TRANSITIONAL]` Toast — Edit→J-A8, Public→Cycle-3+.
7. **Operations section**: Payments / Team / Tax / Reports rows — all fire `[TRANSITIONAL]` Toast.
8. **Stripe banner**: Render unconditionally with `[TRANSITIONAL]` marker — replaced by real state in J-A10.
9. **Recent events stub**: 3 hardcoded rows per brand or empty-state — `[TRANSITIONAL]` Cycle-3 exit.
10. **Brand-not-found state**: when route param doesn't match any brand in list, show GlassCard with "Brand not found" + back button.

---

## 8. Regression Prevention

- **Format-agnostic ID resolver**: `useBrandList().find(b => b.id === routeParam)` is the canonical pattern. Spec adds a code comment + test (T-A7-08) verifying both stub and `b_*` IDs resolve.
- **Persist version migration discipline**: every Brand schema change MUST bump persist version + write migration. Spec adds a TRANSITIONAL header in currentBrandStore.ts referencing the change.
- **TRANSITIONAL marker discipline**: every inert CTA + stub data site labeled with exit condition (J-A8 / J-A10 / Cycle-3 / B1). Implementor's grep verifies coverage.

---

## 9. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-INV-A7-1 | Design package screens-brand.jsx:126 component is mismapped to J-A7 in roadmap line 235; it's actually J-A8 (editor). Roadmap line 235 should read `BrandProfileScreen edit-mode → J-A8` only. Authoritative J-A7 source is handoff §5.3.3 text. | Info | Roadmap correction in next SYNC |
| D-INV-A7-2 | Brand type schema needs v2 → v3 bump for J-A7. Future cycles (J-A8 will use the same fields) benefit from landing this in J-A7. | Info | Folded into spec |
| D-INV-A7-3 | "View public page" CTA reference in §5.3.3 implies a `/brand/:id/preview` route (§5.3.4). Out of scope here, but should be tracked as J-A7-adjacent. | Info | Track in roadmap notes |
| D-INV-A7-4 | §5.3.6 Brand settings (`/brand/:id/settings`) and §5.3.12 Audit log (`/brand/:id/audit`) are NOT in any current Cycle 2 journey table. Status uncertain. | Info | Roadmap audit pass needed; out of scope for J-A7 |

---

## 10. Confidence

**HIGH.** Designer handoff §5.3.3 read end-to-end; design-package component verified as editor (J-A8), not founder view (J-A7); all 4 J-A6 audit carve-outs cross-referenced; current code state confirmed (no `app/brand/`, no dynamic routes, no Account brand-rows); Brand schema gap quantified per-field. Runtime verification deferred (greenfield — there's no runtime to check).

---

## 11. Hand-off

Spec follows in `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A7_BRAND_PROFILE.md`. Both files referenced in chat reply for orchestrator REVIEW.

---

**End of J-A7 investigation.**
