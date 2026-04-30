# Investigation — J-A8 Polish Package (Bio + Country Picker + Multi-Platform Social Icons)

> **Mode:** Forensics INVESTIGATE (3 polish items from founder smoke)
> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A8-POLISH
> **Codebase:** `mingla-business/`
> **Predecessor:** J-A8 implementor PASS (founder smoke confirmed all 22 ACs)
> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_2_J_A8_POLISH.md`
> **Auditor turn:** 2026-04-29
> **Confidence:** **High** — root causes traced for all 3 items; implementor-ready data composed (250-country list + 8 SVG glyphs)

---

## 1. Symptom Summary

Three polish items surfaced during founder smoke of the J-A8 brand edit feature. All cosmetic-grade defects but all visible in production-quality UX:

**P-1 — Bio textarea clipped to one visible line**
- Expected: ~120px-tall multi-line text area for the brand bio field
- Actual: bio text gets clipped to the kit Input's fixed 48px container; only one line visible at a time

**P-2 — Country picker shows only 12 countries**
- Expected: full international country list (all ISO 3166-1 nations) with search
- Actual: hardcoded 12-country list (UK + Western Europe + English-speaking markets) with no search

**P-3 — Contact + social rendered as text rows; only 2 social platforms supported**
- Expected: icon-only chips for any contact/social field that's filled in; hidden when empty; supports all major platforms (Instagram, TikTok, X, Facebook, YouTube, LinkedIn, Threads)
- Actual: J-A7 hero shows email + phone as text rows (with envelope and `bell`-as-phone-proxy icons), social shown as Pill chips with text labels; schema only carries website + instagram

---

## 2. Investigation Manifest

| File | Layer | Read | Notes |
|---|---|---|---|
| Dispatch `FORENSICS_BIZ_CYCLE_2_J_A8_POLISH.md` | Spec input | ✅ | Scope locked to 8 platforms + 3 polish items + bundled cycle |
| `SPEC_ORCH-BIZ-CYCLE-2-J-A8_BRAND_EDIT.md` | J-A8 spec | ✅ (session) | Bio Input call site + Social section with website + instagram only |
| `IMPLEMENTATION_BIZ_CYCLE_2_J_A8_BRAND_EDIT.md` | J-A8 baseline | ✅ (session) | 6-file footprint, schema v3→v4, D-IMPL-A8-1 deferred |
| `SPEC_ORCH-BIZ-CYCLE-2-J-A7_BRAND_PROFILE.md` | J-A7 view spec | ✅ (session) | Hero contactCol + linksRow render rules |
| `IMPLEMENTATION_BIZ_CYCLE_2_J_A7_BRAND_PROFILE.md` | J-A7 baseline | ✅ (session) | D-IMPL-A7-5 social-tap TRANSITIONAL — preserve |
| `HANDOFF_BUSINESS_DESIGNER.md` §5.3.5 line 1839 | Authoritative source | ✅ | "Social links (multi-select platforms with URL inputs)" — confirms expansion is in original design intent |
| `mingla-business/src/components/ui/Input.tsx` | P-1 + P-2 root cause | ✅ | Container `HEIGHT = 48` constant (line 182); PHONE_COUNTRIES 12-entry hardcoded list (lines 65-82) with explicit `[TRANSITIONAL]` Cycle 3+ marker |
| `mingla-business/src/components/ui/Icon.tsx` | P-3 icon set | ✅ | 69 existing line-style glyphs at 24×24 viewBox, strokeWidth 1.75; pattern: `<Path d="..." />` for stroked, `fill={color}` for solid |
| `mingla-business/src/components/brand/BrandEditView.tsx` | P-1 + P-3 edit changes | ✅ (session) | Bio Input at ~line 312; Social section with 2 Inputs at ~line 360 |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | P-3 view rewrite | ✅ (session) | contactCol (lines ~263-278) + linksRow (lines ~281-301) currently render text rows + Pill chips |
| `mingla-business/src/store/currentBrandStore.ts` | P-3 schema | ✅ | BrandLinks type at lines 39-46: website + instagram + custom only |
| `mingla-business/src/store/brandList.ts` | P-3 stubs | ✅ (session) | All 4 stubs have website + instagram; need 6 additional platform handles |
| `DECISION_LOG.md` | DEC entries | ✅ | DEC-079 kit closure with carve-out family; precedent: DEC-080 TopSheet, J-A8's I-12 host-bg |

`npx tsc --noEmit` baseline clean (verified post-J-A8 commit).

---

## 3. Findings (classified)

### 🔴 Root Causes — None (no broken code; 3 polish/feature gaps)

### 🟡 Hidden Flaws (spec MUST address)

**P-1 — Input primitive has fixed 48px height**
- File: `mingla-business/src/components/ui/Input.tsx:182`
- Exact code: `const HEIGHT = 48;` and line 411 `height: HEIGHT` on container, line 427 `height: "100%"` on TextInput
- What it does: clamps the entire Input container — even when `multiline` is passed through, the visible area is constrained to 48px. Multi-line bio text wraps internally but is clipped.
- What it should do: support a multi-line variant OR (recommended) use a separate multi-line input pattern.
- Why fight the kit fix is wrong: modifying the Input primitive's HEIGHT is a primitive change with cascading effects on every other Input call site (2 in J-A8 alone, more in J-A7 + Cycle 0a). DEC-079 closure prefers local composition.
- **Spec mitigation:** inline `TextArea` component inside `BrandEditView` (~30 lines). Visual style matches Input container (1px idle border `rgba(255,255,255,0.12)`, focus 1.5px `accent.warm`, background `rgba(255,255,255,0.04)`, radius `radiusTokens.sm`, padding 14 horizontal, paddingTop/Bottom 12). Fixed `minHeight: 120`. Reusable pattern documented for future multi-line fields.

**P-2 — Hardcoded 12-country list (already TRANSITIONAL-marked)**
- File: `mingla-business/src/components/ui/Input.tsx:65-82`
- Exact code: `export const PHONE_COUNTRIES: readonly PhoneCountry[] = [ {GB...}, {US...}, ... 12 entries ]` with header comment lines 65-68: `// [TRANSITIONAL] 12-country hardcoded list for Cycle 0a (UK launch + Western Europe + English-speaking markets). Cycle 3+ should swap to libphonenumber-js + a full international list when Mingla expands.`
- What it does: country picker shows only 12 entries; no search; users in non-listed countries (e.g., India, Brazil, Japan, all of Africa, all of Asia ex Western markets, all of South America) can't pick their dial code.
- What it should do: present complete ISO 3166-1 list (~250 entries) with search bar at top of picker Sheet.
- **Spec mitigation:** replace the 12-entry array with the full 249-entry list (alphabetical by name). Add `<Input variant="search">` at top of picker Sheet that filters list as user types (case-insensitive contains on `name` OR startsWith on `dialCode`). No external dependency needed (no phone-number validation; just country chip rendering). Retires the `[TRANSITIONAL]` marker.
- Note on libphonenumber-js: the original TRANSITIONAL marker mentioned this library, but it's only needed for E.164 validation/parsing — NOT for chip presentation. Static array suffices for the picker UX.

**P-3a — Schema gap: BrandLinks lacks 6 social platforms**
- File: `mingla-business/src/store/currentBrandStore.ts:39-46`
- Exact code: `export interface BrandLinks { website?: string; instagram?: string; custom?: BrandCustomLink[]; }`
- What it does: edit form can only capture website + instagram; J-A7 view can only render those 2 fields as social
- What it should do: support TikTok, X, Facebook, YouTube, LinkedIn, Threads as first-class fields per handoff §5.3.5 "Social links (multi-select platforms with URL inputs)"
- **Spec mitigation:** extend BrandLinks with 6 new optional string fields. Bump persist v4→v5 with passthrough migration. Same pattern as J-A7's v2→v3 and J-A8's v3→v4.

**P-3b — Icon set lacks 8 needed glyphs**
- File: `mingla-business/src/components/ui/Icon.tsx`
- Missing glyphs: `phone, instagram, tiktok, x, facebook, youtube, linkedin, threads`
- What it does: J-A7 currently uses `bell` as phone proxy (semantically wrong); social links render as text Pills (not icons)
- What it should do: kit provides each glyph as a line-style 24×24 SVG matching the existing 69-glyph aesthetic
- **Spec mitigation:** add 8 new IconName entries + RENDERER functions to Icon.tsx. Lucide-style line paths sourced for line consistency (instagram + Tabler-style for tiktok/x). DEC-079 carve-out — additive icon expansion, no breaking changes to existing 69 glyphs. Propose **DEC-082** to log the precedent.

**P-3c — J-A7 view contactCol + linksRow render text rows, not icons**
- File: `mingla-business/src/components/brand/BrandProfileView.tsx:263-301` (approximate)
- Current: contactCol renders email/phone as `<Icon><Text>` rows; linksRow renders website/instagram as Pill chips with text labels
- Should render: single `socialsRow` flex-wrap row of icon-only 36×36 Pressable chips. Hide chip when corresponding field is empty. Hide entire row when all 8 fields are empty (clean look).
- **Spec mitigation:** delete contactCol + linksRow blocks; add unified socialsRow renderer. Tap behavior preserved (TRANSITIONAL Toast per D-IMPL-A7-5). Ordered: email, phone, website, instagram, tiktok, x, facebook, youtube, linkedin, threads.

**P-3d — Edit form Social section has 2 Inputs; needs 8 (website + 7 platforms)**
- File: `mingla-business/src/components/brand/BrandEditView.tsx` (Social section)
- Current: 2 Inputs (website + instagram)
- Should have: 8 Inputs (website, instagram, tiktok, x, facebook, youtube, linkedin, threads), each with leadingIcon=respective new glyph
- **Spec mitigation:** extend Social section to stack all 8 Inputs in order. Order matches view render order. Same dirty-state/Save patterns from J-A8 baseline.

### 🔵 Observations

**O-A8P-1 — D-IMPL-A8-1 (empty-bio CTA stale Toast) remains separate concern**
- The empty-bio inline CTA on J-A7 still fires Toast "Editing lands in J-A8." (now stale post-J-A8).
- Out of scope for this polish package — separate dispatch (or fold into a future Cycle-2 cleanup).
- Note: with TextArea now in BrandEditView, the "lands in J-A8" Toast becomes even more confusingly stale because J-A8 ships AND the bio is now editable correctly.

**O-A8P-2 — Threads logo not as standardized as Meta/TikTok**
- Threads launched in 2023; line-glyph standardization across icon sets is less mature
- Spec uses a recognizable "@"-derived line glyph; designer should review post-implementation if perfectionist
- Tracked as D-FORENSICS-A8P-1 below

**O-A8P-3 — Country search uses kit's `Input variant="search"` — no kit primitive change**
- The kit already has `search` variant (with magnifying-glass auto-icon). Reusing it inside the picker Sheet is purely additive composition.

**O-A8P-4 — Custom links UI still deferred**
- BrandLinks.custom field stays in schema (carries from J-A7 v3). UI for multi-add custom links remains deferred (§5.3.6 settings cycle or future polish).

---

## 4. Five-Layer Cross-Check

| Layer | Truth |
|---|---|
| **Docs (handoff §5.3.5)** | "Social links (multi-select platforms with URL inputs)" — confirms multi-platform is in original design intent |
| **Docs (Input.tsx header comments lines 65-68)** | `[TRANSITIONAL]` explicit; full international list deferred |
| **Code (current)** | 2 social fields, 12 countries, bio clamped to 48px |
| **Schema** | N/A frontend-first (Brand.links is client-side stub) |
| **Runtime** | J-A8 ships and works for the limited surface; smoke confirmed |
| **Data** | AsyncStorage v4 — must migrate to v5 for new fields |

**Layers agree.** The polish items are scope expansions, not contradictions. Original design intent (handoff §5.3.5) is BROADER than current code; this dispatch closes the gap.

---

## 5. Blast Radius

6 files modified, 0 new files:

| File | Change |
|---|---|
| `src/store/currentBrandStore.ts` | BrandLinks v4→v5 (6 new optional fields) + migration |
| `src/store/brandList.ts` | 4 stubs gain handles for the 6 new platforms (mixed coverage) |
| `src/components/ui/Icon.tsx` | 8 new IconName entries + 8 new RENDERER functions |
| `src/components/ui/Input.tsx` | PHONE_COUNTRIES 12→249 entries + picker Sheet search bar |
| `src/components/brand/BrandEditView.tsx` | Inline TextArea component (replaces bio Input usage) + 6 new social Inputs |
| `src/components/brand/BrandProfileView.tsx` | Delete contactCol + linksRow; add unified socialsRow with icon-only chips |

**No new files. No existing kit primitive removed. No schema breaking changes.**

---

## 6. Invariant Check (full list in spec)

| ID | Risk |
|---|---|
| I-1 | designSystem.ts not modified |
| I-3 | iOS/Android/web all execute |
| I-6 | tsc strict — explicit return types, no `any` |
| I-7 | Retire P-2 PHONE_COUNTRIES TRANSITIONAL; preserve D-IMPL-A7-5 social-tap TRANSITIONAL |
| I-9 | No animation timings touched |
| I-11 | Format-agnostic ID resolver unchanged |
| I-12 | Host-bg cascade unchanged |
| DEC-079 | Kit closure preserved — 8 new Icons are additive (DEC-082 proposed); TextArea is local composition; PHONE_COUNTRIES is data extension |

**Proposed new decision DEC-082:** Icon set additive expansion. Continues DEC-079 carve-out family. Rule: icon additions stay additive within `Icon.tsx`, no breaking changes to existing glyphs, no behavioral changes. Future similar additions follow the same path without separate orchestrator approval.

---

## 7. Fix Strategy (direction only — spec carries detail)

1. Schema v4→v5 with 6 new social fields
2. Stub data extension (4 brands × 6 platforms — mix coverage for testing)
3. Add 8 SVG glyphs to Icon.tsx (Lucide-derived line paths)
4. Replace PHONE_COUNTRIES 12→249 + add search input in picker Sheet
5. BrandEditView: inline TextArea component + 6 new social Inputs
6. BrandProfileView: delete contactCol + linksRow, add unified socialsRow with icon chips and empty-field hiding

---

## 8. Regression Prevention

- TextArea inline pattern documented in BrandEditView for reuse (J-A9 invite note? J-A12 finance description?)
- Icon expansion pattern formalized via DEC-082 → future additions (when 5+ new icons land elsewhere) follow same precedent
- PHONE_COUNTRIES list documented as "client-side static data — phone validation lives at backend B1+"

---

## 9. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-FORENSICS-A8P-1 | Threads icon glyph less standardized than Instagram/TikTok in open icon sets. Spec uses an "@"-derived line shape. Designer should review post-implementation; if needed, swap path data in a single-line follow-up. | Info | Track for designer review |
| D-FORENSICS-A8P-2 | Country list of 249 entries inflates Input.tsx by ~250 lines of static data. Could extract to `src/constants/countries.ts` for cleanliness. Spec keeps inline (Cycle 0a kit pattern co-locates data with primitives). Future refactor candidate. | Info | None — track for future cleanup |
| D-FORENSICS-A8P-3 | D-IMPL-A8-1 (empty-bio CTA stale Toast) NOT addressed by this polish package. Becomes more visibly stale post-J-A8 ship. Recommend adding to a future micro-fix slice OR explicitly closing as "acceptable transitional copy". | Info | Track separately |
| D-FORENSICS-A8P-4 | The `link` icon used for "website" in current J-A7 hero is a chain-link visual. The new spec uses `globe` (already in kit at line 310-315) for website chip — semantically clearer for "website" vs "any link". Implementor swap. | Info | None — fold into spec |
| D-FORENSICS-A8P-5 | Phone variant Input keyboard auto-suggestion: `autoComplete: "tel"` is already set in VARIANT_BEHAVIOUR. No change needed. | Info | None |

---

## 10. Confidence

**HIGH.** All 3 polish items have proven root causes with file:line evidence. SVG glyph paths sourced from Lucide (MIT-licensed, widely-used line-icon family) match existing kit aesthetic. Country list complete to 249 entries (full ISO 3166-1). Schema migration follows established v3→v4 pattern from J-A8. Founder smoke gated by visual verification of icon glyphs (designer-review-grade polish if needed — D-FORENSICS-A8P-1).

---

## 11. Hand-off

Spec follows in `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_2_J_A8_POLISH.md` with complete inline data:
- Full 249-entry country list
- 8 SVG path data blocks (verbatim copy)
- Schema v5 diff
- BrandEditView TextArea + social inputs spec
- BrandProfileView socialsRow rewrite spec
- 4 stub brand updates with multi-platform handles

---

**End of J-A8 polish investigation.**
