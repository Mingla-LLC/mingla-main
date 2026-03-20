# Implementor Prompt: Category System Migration (13 Categories)

## Spec

Read the full spec at `outputs/FEATURE_CATEGORY_MIGRATION_SPEC.md`. This touches 8 edge functions, SQL, and 4+ mobile files. The data backfill is the highest-risk piece.

## CRITICAL: Deployment Order

**Data migration FIRST, code changes SECOND.** The SQL query_pool_cards matches categories by exact string. If we rename in code before backfilling the database, card serving breaks silently.

1. **Step 1: SQL data backfill migration** — update all existing card_pool and place_pool rows with new category names/slugs. Fix picnic/picnic_park inconsistency. Add new categories. This must run and be verified BEFORE any code deploys.

2. **Step 2: Backend edge function updates** — all 8 edge functions updated to use 13 categories from seedingCategories.ts

3. **Step 3: SQL function update** — query_pool_cards updated for new category names if needed

4. **Step 4: Mobile updates** — PreferencesSheet, category pills, icons, etc.

## What to Change

### Data Migration (FIRST)
- Backfill card_pool.category and place_pool categories with new names
- Fix picnic vs picnic_park slug inconsistency across all data
- Ensure all existing data uses consistent slugs before code changes
- Add verification queries to confirm zero orphaned categories

### Backend (8 edge functions)
- All must import categories from `seedingCategories.ts` (already exists from curated overhaul)
- Replace any hardcoded category lists with shared imports
- Ensure Groceries cards excluded from regular discover-cards results (hidden category)
- Fix the 3 edge functions with picnic slug inconsistency

### SQL
- query_pool_cards — verify category matching works with new names
- Any RPCs that filter by category

### Mobile (4+ files)
- 12 visible categories (not Groceries)
- Add Live Performance and Flowers as new visible categories
- Remove "Groceries & Flowers" (split into Flowers visible + Groceries hidden)
- Update category names if changed (Nature → Nature & Views, Picnic → Picnic Park)
- New icons for Live Performance and Flowers

## Key Rules

- Groceries is HIDDEN — never shown to users, never in preferences, never in category pills
- Groceries cards exist in card_pool for curated picnic stops
- Data migration must be verified before code deploys
- All category references come from seedingCategories.ts — single source of truth

## After Implementation

Report back with: data migration results (row counts updated), files changed, and confirmation against spec success criteria. Flag any categories that had zero existing data (new categories with no places/cards yet).
