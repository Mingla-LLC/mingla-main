# FORENSICS INVESTIGATE — ORCH-0964 [Public-page customization: theme color + preset fonts + entrance animations]

**Dispatched:** 2026-05-25 by Claude `mingla-orchestrator`
**Skill:** Claude `mingla-forensics` (INVESTIGATE mode — no fixes proposed)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]`
**Branch:** `ORCH-0964-public-page-theme-customization`
**Severity:** S2-medium / `missing-feature` + `ux`

---

## Goal

Establish full ground-truth for a brand-owner-controllable theme system that renders identically on **buyer-web public brand/event pages**, **consumer iOS**, and **consumer Android**. Investigate the current state of every layer (docs / schema / code / runtime / data) so SPEC can write a precise contract without re-discovery. NO fixes, NO design proposals — investigation only.

## Decisions locked at INTAKE (do NOT re-litigate)

1. **Surfaces in scope:** buyer-web (`/b/[brandSlug]`, `/e/[brandSlug]/[eventSlug]`) + consumer iOS + consumer Android.
2. **Surfaces explicitly NOT in scope:** business-app preview (no live preview), checkout buyer-web (`/checkout/*` stays Mingla-neutral for payment trust), admin-web, all other event/brand listings outside the public render path.
3. **Theme scope rule:** per-brand default + optional per-event override. Resolver chain: `event.theme ?? brand.theme ?? mingla.default`.
4. **Animation tech:** Lottie JSON assets bundled per enum value (`none` | `confetti` | `balloons` | `sparkles`). `lottie-react-native` on mobile, `lottie-web` (or `@lottiefiles/react-lottie-player`) on buyer-web Next.js.
5. **Color shape:** single hex per scope (no gradients yet, no multi-color palettes — keep schema narrow).
6. **Font shape:** enum-bounded whitelist of ~6–10 presets (no arbitrary upload — licensing + bundle-size).

## Inputs to ingest (Phase 0 mandatory)

- `Mingla_Artifacts/WORLD_MAP.md` — ORCH-0964 banner (top of file).
- Sibling in-flight ORCHs that materially intersect this investigation:
  - **ORCH-0962** [Brand-edit → public-brand field rendering audit] — worktree `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/`. Its investigation establishes ground-truth of what brand fields exist write-side vs render-side. ORCH-0964 SPEC consumes ORCH-0962's findings. If ORCH-0962 investigation report exists (`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0962_*.md` in that worktree), cite it directly and don't re-walk those fields.
  - **ORCH-0961** [Public-page close/nav parity] — overlapping public-page surface; do NOT touch nav/close UX.
  - **ORCH-0963** [Public brand page events-vs-trip] — overlapping render path; do NOT touch the events-vs-trip listing logic.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — check for any existing theme-related, color-related, font-related invariants.
- `feedback_brand_kind_immutable_post_create.md` (memory) — brand kind constrains which surfaces apply.
- `feedback_rn_color_formats.md` (memory) — RN inline-style colors must be hex/rgb/hsl/hwb only; brand theme MUST emit hex (no oklch).

## Investigation scope (5-truth-layer for each of the 3 surfaces)

### Layer 1 — Docs
- Search PRODUCT_DOCUMENT.md, README, prior specs for any prior theme / branding decisions.
- Check `Mingla_Artifacts/DECISION_LOG.md` for any color/font/animation precedent.

### Layer 2 — Schema
- Current `brands` table columns: walk every column; flag any existing color/theme/brand_color/primary_color/font/animation columns (live or deprecated).
- Current `events` table columns: same walk.
- Existing JSONB blobs that could already hold theme data (`brands.metadata`, `events.theme.*`, `brands.theme.*`).
- RLS policies on brands + events: confirm owner-write paths exist for the columns we'll add.

### Layer 3 — Code (each surface)

**Buyer-web (Next.js, `mingla-business/`):**
- `mingla-business/app/b/[brandSlug]/page.tsx` (or `index.tsx`) — current public brand render path. Identify the component tree, where colors/fonts are currently sourced (Tailwind tokens? CSS vars? hardcoded?), and where Lottie can mount without breaking SSR/hydration.
- `mingla-business/app/e/[brandSlug]/[eventSlug]/page.tsx` — public event render path. Same walk.
- Confirm `/checkout/*` is structurally isolated from the themed render tree (no shared layout that would accidentally inherit the theme).
- Existing Tailwind config: are there design tokens to extend or fork?

**Consumer iOS + Android (React Native, `app-mobile/`):**
- Identify EVERY component that renders event or brand context to a consumer user. The dispatch description says "event/brand views inside consumer app" — this is ambiguous. Possible sites: event detail sheet/screen, brand detail screen, swiper card chrome, search result row, recommendation card. Walk the navigation graph and list every candidate render site with file path. SPEC will pick which ones get themed.
- Current color sources: design tokens? Hardcoded? Theme context?
- Lottie status: is `lottie-react-native` already a dependency? If not, document that adding it is a native-module change (requires `eas build`, not just OTA — flag for SPEC).

### Layer 4 — Runtime
- Current public brand page: load `/b/<a-real-brand-slug>` on dev buyer-web, screenshot, document current font + color render.
- Current consumer event view: open on iOS sim, screenshot.
- (Android emulator screenshot if straightforward; otherwise note "source-level parity, sim parity deferred to TEST".)

### Layer 5 — Data
- Sample 5–10 production brands (read-only SQL via Management API per `feedback_supabase_mcp_workaround.md`): do any already have informal theme data stored in JSONB blobs that a migration would need to migrate?

## Open questions for SPEC (collect evidence to answer, but DO NOT answer)

- **Q-a:** Which 6–10 fonts? Investigate web-safe + RN-bundled fonts that work cross-platform. Candidates to evaluate (not commit): Inter, Playfair Display, Lora, Montserrat, Poppins, Bebas Neue, Space Grotesk, DM Serif Display, Fraunces, Merriweather. For each: web availability (Google Fonts / system), RN bundling cost, license cleanliness for commercial use, weight options.
- **Q-b:** Exact consumer-app theming surface. Enumerate every candidate from the Layer 3 walk; recommend a minimal-blast-radius set in the investigation report (e.g., "event detail screen only" vs "event detail + swiper card chrome").
- **Q-c:** WCAG AA contrast floor. Investigate existing accessibility guards in the codebase. What text overlays the theme color? (Page headers? CTA buttons? Body copy?) Each overlay needs a contrast guarantee.
- **Q-d:** Confirm checkout exclusion. Trace whether `/checkout/*` could accidentally inherit a themed layout via shared Next.js layout files.
- **Q-e:** Lottie bundle cost. Estimate kB for 4 animations × both bundle targets (web + RN). Flag if it pushes either bundle past a meaningful threshold.

## Hard guards (DO NOT)

- Do NOT propose fixes, write code, or draft SPEC contracts — investigation only.
- Do NOT touch ORCH-0961 (nav/close) or ORCH-0963 (events-vs-trip listing) scope.
- Do NOT re-walk what ORCH-0962 has already proven; cite its report instead.
- Do NOT modify the `/checkout/*` surface in any future SPEC; this investigation only needs to PROVE the isolation, not change anything.
- Do NOT recommend a JSONB-only schema for theme storage without explicitly noting the trade-off against typed columns (we've been burned before — see `SCOPE_EXPANSION_ORCH-0950_DASHBOARD_COHERENCE.md` JSONB blob wholesale-wipe).
- Do NOT introduce arbitrary user-uploaded fonts at any point (decision-locked at INTAKE).

## Expected output

Write the investigation report to:

```
Mingla_Artifacts/reports/INVESTIGATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md
```

(inside this worktree). Required sections:

1. **Phase 0 ingest summary** — what you read and what you skipped because ORCH-0962 already covered it.
2. **Layer-by-layer findings** (5 layers × 3 surfaces — a matrix).
3. **Schema evidence** — every existing column/JSONB key that could conflict or be repurposed.
4. **Consumer-app render-site enumeration** — Q-b evidence.
5. **Font candidate evaluation table** — Q-a evidence.
6. **WCAG contrast surfaces** — Q-c evidence.
7. **Checkout-isolation proof** — Q-d evidence.
8. **Lottie bundle-cost estimates** — Q-e evidence.
9. **Open-question summary** — for SPEC to answer with operator input.
10. **Cross-ORCH coordination notes** — what ORCH-0964 needs from ORCH-0962 to start SPEC.

## Downstream routing

After investigation report returns to orchestrator:
- Orchestrator REVIEW.
- If APPROVED → Claude `mingla-forensics` SPEC mode (with operator input on Q-a font list + Q-b consumer-app theming surface).
- SPEC output: `Mingla_Artifacts/specs/SPEC_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`.
- Then Codex `implementor-mingla` IMPLEMENT (DB migration + 3-surface render engine + edit UI).
- Then Claude `mingla-tester` TEST (4-device parity: buyer-web Chromium + iOS sim + Android emu + operator's physical iPhone if available).
- Then Claude `mingla-orchestrator` CLOSE.

## Working tree

`~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/` on branch `ORCH-0964-public-page-theme-customization`.

All scoped reports + prompts + specs land under that worktree's `Mingla_Artifacts/`.
