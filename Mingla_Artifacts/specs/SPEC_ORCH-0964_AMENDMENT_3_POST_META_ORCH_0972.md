# SPEC AMENDMENT 3 — ORCH-0964 — post META-ORCH-0972 close (brand-kind decommission + data-driven tabs)

**Authored:** 2026-05-26 by Claude `mingla-orchestrator` (rectification pass)
**Supersedes:** specific sections of `SPEC_ORCH-0964_AMENDMENT_POST_0961_0962_0963.md` (Amendment 1) where this amendment is more specific.
**Companion to:** original SPEC + Amendment 1 + Amendment 2 (all binding alongside).
**Trigger:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs] CLOSED PASS Grade A 2026-05-26 (commit `2e018bdea` on `main`, PR #219). It superseded the ORCH-0963 kind-branched contract that Amendment 1 §1/§7 was carefully built to preserve.

---

## 1. What changed since Amendment 1 was written

META-ORCH-0972 shipped 4 connected sub-specs in one bundle and the impact lands directly on ORCH-0964's contract:

| Subject | Amendment 1 said | META-ORCH-0972 reality |
|---|---|---|
| `PublicBrandPage.tsx` IA | Kind-branched: `isTripBrand` constant → Upcoming/Past vs Trips/Past Trips | **Data-driven:** Upcoming / Events / Trips / Experiences / About — only non-empty buckets render. NO `isTripBrand`. |
| Primitives to move into `packages/brand-rendering/` | `TripMiniCard` + `NextEventTeaser` + `EventMiniCard` | Same 3 PLUS the new `<ExperienceMiniCard>` primitive (added by META-ORCH-0972 Sub-C) |
| Public-page service contract | `getPublicBrandBySlug` kind-dispatched + `fetchPublicBrandTrips` + `PublicTripCardRow` | `getPublicBrandBySlug` no longer kind-dispatched. NEW RPCs to consume: `pg_public_brand_upcoming(text, timestamptz, integer)` for chronologically-interleaved Upcoming tab + `pg_public_experiences_by_brand`. `pg_public_trips_by_brand` body rewritten — kind guard removed. |
| Invariants to preserve | `I-PUBLIC-BRAND-KIND-BRANCHED` (ORCH-0963) | **SUPERSEDED by META-ORCH-0972.** Replace with `I-BRAND-UNIVERSAL-AUTHORING` + `I-PUBLIC-PAGE-DATA-DRIVEN-TABS` + `I-HUB-TABS-DATA-DRIVEN` + `I-VENUE-CLAIM-OPTIONAL`. |
| `brands.kind` column reads | Read `kind` to branch IA | **FORBIDDEN.** CI gate `meta-orch-0972-no-brand-kind-reads.mjs` blocks any `b.kind` read in `mingla-business/src/` or `app/`. Column still physically exists; Stage 4 drop deferred to follow-up ORCH ≥1 release cycle later. |
| `mingla-business/src/components/persona/` files | (not addressed) | **DELETED:** `PersonaPickerCards.tsx`, `PersonaForkSheet.tsx`, `TripBrandWizard.tsx`. Any ORCH-0964 SPEC reference to these is stale. |
| Edge functions touched by META-ORCH-0972 | (not addressed) | `parse-restaurant-menu` 38→39, `parse-play-activities` 37→38, `agent-chat` 71→72, `agent-confirm-action` 66→67. ORCH-0964 must NOT touch these (out of scope + version conflict risk). |

## 2. Action items for the implementor (apply at next rebase)

### Action 1 — Rebase onto current `origin/main` first

Branch is 2 commits behind `main` as of 2026-05-26 19:00 local. Rebase MUST happen before resuming any work:

```bash
cd ~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]
git fetch origin main && git rebase origin/main
```

Expected conflicts: `Mingla_Artifacts/WORLD_MAP.md` (banner stacking). Resolve by keeping main's banners + adding ORCH-0964's INTAKE banner back on top.

After rebase, re-read `mingla-business/src/components/brand/PublicBrandPage.tsx` from the rebased tree — it no longer has `isTripBrand` and has a different tab-bar shape (data-driven tabs based on bucket counts).

### Action 2 — Update the package-extraction list (Amendment 2 §1.A)

When relocating `PublicBrandPage.tsx` into `packages/brand-rendering/`, ALSO move:
- `<ExperienceMiniCard>` (added by META-ORCH-0972 Sub-C) — verify exact path post-rebase, expected `mingla-business/src/components/brand/ExperienceMiniCard.tsx` or similar
- `useHubTabs.ts` data-driven tab visibility helper IF it's branch-shared between business and public surfaces — investigate at implementation; may stay in mingla-business if business-only

### Action 3 — Update theme-render targets (Amendment 1 §6)

Apply theme to the data-driven tabs, NOT to ORCH-0963's kind-branched variants:

- **Upcoming tab** — `theme.fontFamilyValue` on tab label + heading; chronologically-interleaved cards (events + trips + experiences) — each card type already themed via its primitive.
- **Events tab** — `EventMiniCard` themed (sticky CTA pill picks up `theme.color` background + `theme.foregroundColor` text).
- **Trips tab** — `TripMiniCard` themed. "Booking closed" badge stays its destructive-state color (do NOT theme — accessibility precedence preserved from Amendment 1).
- **Experiences tab** — `ExperienceMiniCard` themed. Investigation in implementation must verify whether experiences have their own destructive-state badges (sold out / cancelled / expired) — same accessibility carve-out applies.
- **About tab** — `theme.fontFamilyValue` on section headings; body stays system default.
- **Entrance animation** — STILL mounts once above the tabs on first session load. Doesn't replay per-tab-switch.

### Action 4 — Update invariants-to-preserve list (Amendment 1 §7)

**REMOVE** from preserve list:
- `I-PUBLIC-BRAND-KIND-BRANCHED` — SUPERSEDED by META-ORCH-0972.

**ADD** to preserve list:
- `I-BRAND-UNIVERSAL-AUTHORING` (ACTIVE post-META-ORCH-0972) — every brand can author events + trips + experiences. ORCH-0964 must not re-introduce any kind-based authoring gate.
- `I-PUBLIC-PAGE-DATA-DRIVEN-TABS` (ACTIVE) — `PublicBrandPage` tabs render based on bucket-count truth, not brand metadata. ORCH-0964 theming applies INSIDE tabs, never to tab visibility.
- `I-HUB-TABS-DATA-DRIVEN` (ACTIVE) — same rule for the business-app Hub tabs. ORCH-0964 doesn't touch Hub, but flag for awareness.
- `I-VENUE-CLAIM-OPTIONAL` (ACTIVE) — venue claim is an opt-in trust signal, not a feature gate. Confirms ORCH-0964 theme editing applies to ALL brands regardless of claim status.

**KEEP** in preserve list:
- `I-PROPOSED-BRAND-FIELD-MAP-COVERAGE` (ORCH-0962, ACTIVE) — the 3 views were rewritten by META-ORCH-0972 WITHOUT `b.kind` and the field-map gate still applies for non-kind columns; ORCH-0964's `theme_color / theme_font / theme_animation` additions still need to plumb end-to-end.

### Action 5 — Update view-migration SQL (Amendment 1 §3)

Amendment 1 §3 quoted view definitions assuming the post-ORCH-0962 column list including `b.kind`. **That's now stale** — META-ORCH-0972 Sub-C dropped `b.kind AS brand_kind` from `business_public_brands_view`, `business_public_events_view`, and `claimed_venues_public_view` (line 4 of CLOSE banner). When ORCH-0964's implementor adds `b.theme_color`, `b.theme_font`, `b.theme_animation` to these 3 views, they MUST read the META-ORCH-0972 view definitions on rebased `origin/main` and copy THOSE column lists verbatim, NOT the pre-META-ORCH-0972 versions Amendment 1 referenced.

### Action 6 — No edge function touches for META-ORCH-0972 functions

`parse-restaurant-menu` v39, `parse-play-activities` v38, `agent-chat` v72, `agent-confirm-action` v67 — ORCH-0964 has zero reason to touch any of these. Hard guard: DO NOT redeploy them with stale code. Each carries the Sub-D Q15 parser regate (temporary-category prepend to Gemini systemInstruction); a stale ORCH-0964 redeploy would silently regress that fix.

### Action 7 — Test-mod tag requirement holds for ANY test reshape

If ORCH-0964 implementation requires modifying tests created or modified by META-ORCH-0972 (e.g., the 13 test files cited under `[TEST-MOD-APPROVED META-ORCH-0972]` in the CLOSE banner), the CLOSE PR squash body MUST include `[TEST-MOD-APPROVED ORCH-0964]` per `.github/workflows/tests-append-only.yml` AND per `feedback_close_commit_precommit_checks.md`. ORCH-0964 is allowed to extend the tests when adding theme assertions, but never to weaken assertion strength.

## 3. ORCH-0978 awareness (REGISTERED-only, not a blocker)

I registered ORCH-0978 [Video upload polish + cross-surface cover-media expansion + Cloudinary lifecycle management] earlier this turn. It does NOT block ORCH-0964 because:
- ORCH-0978 touches media-picker behavior (image / GIF / video acceptance + lifecycle). ORCH-0964 touches theme-editor UI (color picker + font dropdown + animation dropdown).
- The two share NO file overlap. ORCH-0964's `ThemeEditorSection.tsx` is brand-new; ORCH-0978 will touch existing cover-media pickers that ORCH-0964 doesn't edit.
- ORCH-0978 worktree spawn is explicitly queued AFTER ORCH-0964 PR merges (per ORCH-0978 INTAKE banner) — no parallel-edit collision risk.

No action needed on ORCH-0964 implementor side. ORCH-0978 is just on the radar.

## 4. No other recent closes affect ORCH-0964

I walked the recent-closes list for completeness:
- **ORCH-0974** [Home mobile section lock] — touches `mingla-business/app/(tabs)/home.tsx` only. Zero overlap with ORCH-0964's public-page surface.
- **ORCH-0975** [Consumer notifications sheet] — touches `app-mobile/` consumer notifications. Zero overlap with ORCH-0964's event-sheet brand-tap or `/brand/[slug]` route.
- **ORCH-0973** [Home + Account top-bar mobile parity] — touches `mingla-business/app/(tabs)/` top-bar only. Zero overlap.
- **ORCH-0976** [Worktree cleanup safety] — backend tooling only. Zero overlap.
- **ORCH-0977** (active worktree in parallel session) — content unknown from WORLD_MAP banners; orchestrator will monitor and amend ORCH-0964 again if ORCH-0977 closes with overlapping scope before ORCH-0964 ships.
- **ORCH-0965** [Home dashboard intelligent KPIs] — touches `mingla-business/app/(tabs)/home.tsx`. Zero overlap.

## 5. Summary of binding contract as of 2026-05-26

ORCH-0964 implementor reads, in this order:

1. `SPEC_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` (base)
2. `SPEC_ORCH-0964_AMENDMENT_POST_0961_0962_0963.md` (Amendment 1 — view layer + kind-branched IA awareness — **§7 invariant list partially superseded by this amendment, see Action 4**)
3. `SPEC_ORCH-0964_AMENDMENT_2_CONSUMER_BRAND_SCREEN_AND_DEEP_LINKS.md` (Amendment 2 — consumer-app screen + Universal/App Links)
4. **THIS AMENDMENT 3** — META-ORCH-0972 absorptions

All four cumulative. Where conflict exists, the more-recent amendment wins.

---

**Amendment 3 ready.** Next rebase by Codex picks it up automatically; no need to interrupt their mid-build state.
