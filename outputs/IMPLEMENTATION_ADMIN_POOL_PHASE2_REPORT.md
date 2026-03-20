# Implementation Report: Admin Pool Management — Phase 2 (UI Pages)

**Date:** 2026-03-20
**Spec:** `outputs/FEATURE_ADMIN_POOL_MANAGEMENT_SPEC.md` §10-§11
**Prompt:** `outputs/IMPLEMENTOR_PROMPT_ADMIN_POOL_PHASE2.md`
**Status:** Complete — ready for testing

---

## 1. What Changed

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | ~620 | 6-tab place pool management (replaces PlacePoolBuilderPage) |
| `mingla-admin/src/pages/CardPoolManagementPage.jsx` | ~370 | 4-tab card pool management (new page) |

### Modified Files

| File | Change |
|------|--------|
| `mingla-admin/src/App.jsx` | Replaced PlacePoolBuilderPage → PlacePoolManagementPage, added CardPoolManagementPage, removed PhotoPoolManagementPage + CityLauncherPage imports |
| `mingla-admin/src/lib/constants.js` | Updated NAV_GROUPS: Content group now has "Place Pool" + "Card Pool" (was Places + Photos). Removed "City Launcher" from Launch Tools |

### Pages Killed (removed from routing)

| Page | Lines | Reason |
|------|-------|--------|
| PlacePoolBuilderPage.jsx | 1,433 | Replaced by PlacePoolManagementPage |
| CityLauncherPage.jsx | 472 | Absorbed into Place Pool → Seed & Import tab |
| PhotoPoolManagementPage.jsx | 1,299 | Absorbed into Place Pool → Photo Management tab |

**Note:** The old page files still exist on disk but are no longer imported or routed to. They can be deleted in a cleanup pass.

---

## 2. PlacePoolManagementPage — 6 Tabs

### City Selector (always visible)
- Dropdown of all seeding_cities, ordered by name
- Shows city name, country, and status badge
- "Add City" button opens modal
- Add City modal: text input with debounced search (calls admin-place-search), auto-populates lat/lng/country from selection, saves to seeding_cities, auto-generates tiles

### City Summary Bar (4 stat cards)
- Total Places (from admin_city_place_stats RPC)
- Photo Coverage % (with green/yellow/red coloring)
- Freshness % (stale = not refreshed in 7 days)
- Seeding Spend vs $70 cap

### Tab 1: Seed & Import (§10.4)
- Tile Grid summary with tile count, radius, coverage info, regenerate button
- 13 category pills (toggleable, color-coded)
- Cost Preview panel (auto-updates on category/tile change, $70 cap warning in red)
- Start Seeding button → calls admin-seed-places edge function
- Progress results: API calls, new/duplicate/rejected counts per category
- Expandable per-category details with inline error display
- Collapsible Ad-Hoc Search section (uses admin-place-search with locationBias)

### Tab 2: Map View (§10.5)
- Leaflet map with OpenStreetMap tiles
- City boundary: dashed gray circle (coverage_radius_km)
- Tile grid: blue circles showing each tile's coverage area
- Place pins: CircleMarkers color-coded by seeding category (13 colors)
- Pin click popup: name, category, rating, photo count, active/inactive badge
- Category filter pills to toggle which pins show

### Tab 3: Browse Pool (§10.6)
- Filters: category (13), status, photo status, price tier, name search
- DataTable with server-side pagination (20 per page)
- Columns: name (clickable), category badge, rating, price tier, photos count, status, edit action
- Edit Modal: name, price tier dropdown, is_active toggle
- Saves via admin_edit_place RPC (SECURITY DEFINER, cascades to cards)

### Tab 4: Photo Management (§10.7)
- Photo Health stat cards (with photos, without, coverage %)
- Missing Photos list (places with Google refs but no stored_photo_urls)
- Sorted by rating descending (highest ROI first)
- Per-row download button + batch download with cost estimate
- Triggers via admin_backfill_log + admin-refresh-places

### Tab 5: Stale Review (§10.8)
- Places not refreshed in 7 days, ordered by staleness
- City filter auto-applied from city selector
- Per-place refresh button (calls admin-refresh-places)
- DataTable with name, category, rating, last refresh date, failure count

### Tab 6: Stats & Analytics (§10.9)
- Category breakdown: horizontal bar chart (inline, CSS-based) for all 13 categories
- Seeding History table from seeding_operations
- Expandable error_details for operations with failures
- Total spend tracker with $70 cap indicator

---

## 3. CardPoolManagementPage — 4 Tabs

### Tab 1: Launch Readiness (§11.2)
- Circular readiness gauge (SVG, animated)
- 7-step checklist with pass/warn/fail icons:
  1. City defined + tiles generated
  2. Places seeded ≥50
  3. Photos ≥80% coverage
  4. Single cards generated
  5. Curated cards ≥10
  6. Category coverage ≥8/13
  7. Spend ≤ $70
- Per-category traffic lights (green ≥5 cards, yellow 1-4, red 0)
- All 13 categories shown including Groceries (marked "hidden")
- "Launch City" button (enabled only when all critical items pass)

### Tab 2: Generate Cards (§11.3)
- Generate Single Cards button (calls generate-single-cards)
- Generate Curated Experiences button (calls generate-curated-experiences)
- Category-specific generation dropdown
- Results display

### Tab 3: Browse Cards (§11.4)
- Filters: card type (single/curated), category (13), status, name search
- DataTable with pagination
- Columns: title, type badge, category, thumbnail, status, deactivate/reactivate
- Uses place_pool inner join for city filtering

### Tab 4: Gap Analysis (§11.5)
- Places Without Cards: active places with photos but no corresponding card
- Category Gaps: places seeded vs cards generated per category, with "missing" badges
- Cross-City Comparison when "All Cities" selected

---

## 4. Routing & Navigation

**Before:**
- Content group: Moderation, Places, Photos
- Launch Tools group: City Launcher, Database Tools
- 15 page routes

**After:**
- Content group: Moderation, Place Pool, Card Pool
- Launch Tools group: Database Tools (only)
- 13 page routes (removed 3, added 1 net new)

---

## 5. Design Patterns Used

- **Tabs** component from `components/ui/Tabs.jsx`
- **DataTable** with server-side pagination, sorting, empty states
- **SectionCard** + **StatCard** for consistent section layout
- **Modal** with **ModalBody** + **ModalFooter** for edit/add dialogs
- **Badge** for status indicators
- **Button** with loading states, icon support
- **Framer Motion** for page transitions (inherited from App.jsx)
- **Leaflet** for map (MapContainer, TileLayer, CircleMarker, Circle, Popup)
- **mountedRef** pattern for preventing stale state updates
- **CSS custom properties** from globals.css throughout
- **Toast** notifications for all success/error feedback

---

## 6. Verification

- Build passes: `vite build` succeeds with zero errors
- All imports verified: every component export matches import signature
- Page registry updated: old pages removed, new pages registered
- Sidebar updated: Content group has Place Pool + Card Pool
- Leaflet CSS static import (consistent with PlacePoolBuilderPage pattern)

---

## 7. Known Limitations

1. **Old page files not deleted** — PlacePoolBuilderPage.jsx, CityLauncherPage.jsx, PhotoPoolManagementPage.jsx still exist on disk but are unreachable. Delete in cleanup pass.
2. **Map loads up to 2000 places** — sufficient for current city sizes, but may need virtual markers for very large cities
3. **Photo download triggers via admin_backfill_log** — depends on admin-refresh-places to pick up the entry, which is the existing pattern
4. **Browse Cards join** — uses place_pool inner join for city filtering, so cards without a place_pool link won't show under a city filter

---

## 8. Files Inventory

| File | Action |
|------|--------|
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Created (~620 lines) |
| `mingla-admin/src/pages/CardPoolManagementPage.jsx` | Created (~370 lines) |
| `mingla-admin/src/App.jsx` | Modified (page registry + imports) |
| `mingla-admin/src/lib/constants.js` | Modified (NAV_GROUPS) |

---

## 9. Handoff to Tester

Both pages are fully wired to the Phase 1 backend. Key areas to test:
- Add a city, verify tiles generate, cost preview works, seeding executes
- Map view shows tiles + pins + boundary after seeding
- Browse Pool pagination, filters, and edit modal
- Launch Readiness checklist accuracy vs actual data
- Card generation calls correct edge functions
- Gap Analysis accurately identifies places without cards
- Sidebar navigation shows Place Pool + Card Pool, old pages gone
