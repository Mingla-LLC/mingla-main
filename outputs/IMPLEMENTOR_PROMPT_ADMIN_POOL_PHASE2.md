# Implementor Prompt: Admin Pool Management — Phase 2 (UI Pages)

## Spec

Read the full spec at `outputs/FEATURE_ADMIN_POOL_MANAGEMENT_SPEC.md`, sections §10 (Place Pool Management) and §11 (Card Pool Management). The backend (Phase 1) is already deployed — tables, RPCs, and edge functions all exist.

## Admin Stack Reminder

React 19, Vite, JSX (no TypeScript), Tailwind v4, Framer Motion, Recharts, Leaflet. State via React Context. Direct Supabase JS client calls.

## What to Build

### Page 1: PlacePoolManagementPage.jsx

Replace PlacePoolBuilderPage.jsx. 6 tabs:

**City Selector (always visible at top)**
- Dropdown of seeding_cities + "Add City" button
- Add City: Google Places Autocomplete for city validation (no manual lat/lng)
- City Summary Bar: 4 stat cards (Total Places, Photo Coverage %, Freshness %, Seeding Spend vs $70 cap)
- Data from `admin_city_place_stats` RPC

**Tab 1: Seed & Import (§10.4)**
- Tile Grid Summary table
- 13 category pills (toggleable, show seeded count per category)
- Cost Preview Panel (auto-updates, $70 cap warning in red)
- "Start Seeding" button → calls admin-seed-places with action: "seed"
- Progress display with live counters + inline error details
- Collapsible Ad-Hoc Search section at bottom (uses admin-place-search)

**Tab 2: Map View (§10.5)**
- Leaflet map with tile grid overlay (circles)
- Tile status coloring: gray=unseeded, light blue=partial, green=fully seeded, red outline=errors
- Place pins color-coded by category (13 colors)
- Pin click popup: name, category, rating, photo count, status
- Category filter pills to toggle which pins show
- City boundary dashed circle
- Coverage gap detection (tiles with <5 places highlighted)

**Tab 3: Browse Pool (§10.6)**
- Filters: city, category (13), status, photo status, price tier, rating slider, name search
- Table: name, category, rating, photos, price tier, status, actions
- Edit modal: name, price tier, is_active (saves via admin_edit_place RPC)
- Server-side pagination (20 per page)

**Tab 4: Photo Management (§10.7)**
- Photo Health Summary stat cards
- Missing Photos Table with filters: tile, category, min rating
- Sort: by rating DESC or by impression count DESC
- Per-row "Download" button + "Batch Download" with scope/limit/cost estimate
- Progress display with per-place error details

**Tab 5: Stale Review (§10.8)**
- Existing stale review functionality + city filter auto-applied
- Uses admin_list_stale_places RPC (add p_city_id parameter or client-side filter)

**Tab 6: Stats & Analytics (§10.9)**
- Aggregate stats via admin_city_place_stats RPC (bar chart by category, price tier distribution, photo coverage)
- Seeding History table from seeding_operations (with expandable error_details)
- Quality Metrics (avg rating by category, dead inventory, top performing)

### Page 2: CardPoolManagementPage.jsx

New page. 4 tabs:

**Tab 1: City Launch Readiness (§11.2)**
- 7-step checklist (city defined, places seeded ≥50, photos ≥80%, single cards, curated cards ≥10, category coverage ≥8/13, spend ≤$70)
- Per-category traffic lights (green ≥5 cards, yellow 1-4, red 0) — all 13 categories including Groceries (marked hidden)
- Overall readiness gauge
- "Launch City" button (enabled when critical items green)

**Tab 2: Generate Cards (§11.3)**
- "Generate Single Cards" button → calls generate-single-cards
- "Generate Curated Experiences" button → calls generate-curated-experiences
- Category-specific generation dropdown (fill gaps)
- Progress display

**Tab 3: Browse Cards (§11.4)**
- Filters: city, card type (single/curated), category (13), status, photo status, name search
- Table with card details
- Deactivate/reactivate actions

**Tab 4: Gap Analysis (§11.5)**
- Places Without Cards table + "Generate Card" per row + bulk generate
- Category Gaps: places seeded vs cards generated per category
- Cross-City Comparison when "All Cities" selected

### Page Registration

Update App.jsx (or router):
- Remove: placepool → PlacePoolBuilderPage, citylauncher → CityLauncherPage, photopool → PhotoPoolManagementPage
- Add: placepool → PlacePoolManagementPage, cardpool → CardPoolManagementPage
- Sidebar: "Place Pool" and "Card Pool" as two entries

## Design Guidelines

- Aesthetic and user-friendly — this is a tool the admin will live in daily
- Use existing UI components from mingla-admin/src/components/ui/ (Button, SectionCard, etc.)
- Consistent with existing admin dashboard style (CSS custom properties from globals.css)
- Framer Motion for tab transitions and progress animations
- Recharts for charts/graphs
- Leaflet for map (already used in admin for other features)
- Responsive but desktop-first

## Key Rules

- All stats via server-side RPCs — zero client-side fetch-all
- Groceries shown in readiness/stats but marked as "hidden from users"
- $70 cap visible everywhere spend is shown
- Error details shown inline, not behind generic badges
- Google Places Autocomplete for city validation

## After Implementation

Report back with: files created/modified, line counts per page, tab count confirmation, and screenshots or descriptions of key UI states (seeding progress, map view, readiness checklist).
