# Cycle 1 — Sign-in → Home → brand creation

**Phase:** Phase 2 — Core Wedge
**Estimated effort:** ~28 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/`

## Scope

After auth, the user lands on Home. Tapping the brand chip in the topbar opens BrandSwitcherSheet → "Create new brand" sheet → captures display name + slug + creates a Brand object in Zustand. After creation, brand is set as current and home re-renders with brand context.

## What shipped

- AuthGate routing post-OAuth → Home tab
- Home screen with Topbar (brand chip + + IconChrome)
- BrandSwitcherSheet (used across Home / Events / Account tabs)
- Brand creation flow (sheet, validation, Zustand persist)
- `currentBrandStore` and `brandList` Zustand stores

## References

- Implementation reports: see `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_*_J_A1*.md` and similar
- BUSINESS_PRD §2.1
