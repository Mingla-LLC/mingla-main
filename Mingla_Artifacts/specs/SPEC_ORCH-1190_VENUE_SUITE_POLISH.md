# SPEC — ORCH-1190: Venue Suite Polish Batch (8 items)

**Date:** 2026-06-21 · **Driver:** Seth (device + web testing of META-ORCH-1186) · **Conductor:** mingla-orchestrator
**Worktree:** `~/Desktop/mingla-orchs/1190-[venue-polish]` · **Branch:** `1190-venue-polish`
**Affected Surfaces:** Business iOS + Business Android + Business Web (`mingla-business` venue suite). NOT buyer-web/consumer/admin (management-only UI).

Polish batch found after META-ORCH-1186 shipped. Mix of 1186 work (#2 service periods, #7 blast entry) and pre-existing venue suite (ORCH-1148/1184: full-width, toggles, smart-capacity, blackout scope, mobile table card).

## The 8 items (Seth, verbatim intent)

1. **Full-width parity.** Reservations, Waitlist, Menu, and Settings modules do NOT fill the full workspace width like Overview/Tables do (the ORCH-1184 desktop full-width treatment). Make all venue-suite modules use the same full-width workspace container.
2. **Service periods = read-only defaults + redirect to Settings.** Under Availability → Service periods, the periods now correctly show the defaults derived from `brand_hours` (Leg 1), BUT tapping a period opens an edit/add affordance, implying the user edits hours there. Change: clearly present service periods as READ-ONLY "pulled from your opening hours" with a clear affordance that routes the user to the Settings hours editor to change them (no inline edit/add of hours in Availability). Keep any genuinely reservation-specific overrides honest, but hours editing happens only in Settings (single-owner, I-PROPOSED-1186-HOURS-SINGLE-OWNER).
3. **Toggle handle color off-brand.** The reservation toggles render with a GREEN/teal handle (visible in Settings). Restyle toggles to Mingla brand (orange/brand token, neutral off-state) — no green. Fix the shared toggle/switch component used across the venue suite.
4. **Smart capacity rules → accordion.** The "Smart capacity rules" control (Tables page) should be a clearly-affordanced accordion/dropdown (chevron, expand/collapse) matching the Home page To-do toggle pattern, so users know it expands.
5. **Remove copy:** delete the line "More rules are coming. These are the 3 we honour today." (smart capacity rules area).
6. **Remove "Blackout scope" section from the Tables page.** Blackout scope (whole venue / zone / single table) should be set in the Availability → Blackout dates section when adding a blackout — NOT a standalone section on Tables. Move/keep the scope selector inside the add-blackout flow in Availability; delete the Tables-page Blackout-scope block.
7. **Move blast entry from Settings → Overview top button.** Remove the entire "Reach your guests / Message your ticket buyers / … / Message your guests" section from Settings (the ORCH-1186-D Leg 4 placement). Instead add a "Message your guests" BUTTON at the TOP of the Overview page. Same reuse-only behavior (deep-links the existing composer with `brand:{brandId}` audience). I-PROPOSED-1186-D-BLAST-REUSE-ONLY still holds (just relocated).
8. **Mobile table card layout broken.** On mobile (Tables page), an added table card ("Test Table · 2 seats · parties 1–2 · Indoor · Standard") renders cramped/vertical (one character per line). Fix the table card to lay out correctly on narrow widths (proper width, wrapping, no 1-char-per-line).

## Guards
- Reuse existing components; no new design system. Android opaque-glass policy holds.
- #2 must NOT reintroduce a second hours owner (I-PROPOSED-1186-HOURS-SINGLE-OWNER).
- #7 must stay reuse-only (I-PROPOSED-1186-D-BLAST-REUSE-ONLY) — no new composer/send code.
- Manager-plus gating preserved on mutations.
- Each behavioral change (esp. #2, #7) gets a regression test with fails-on-revert; pure-visual items (#3, #5, #8 layout) get at least a render/snapshot assertion where practical.

## Pipeline
INTAKE (this) → IMPLEMENT (single pass, shared venue-suite files) → orchestrator REVIEW → Seth device QA → CLOSE.
