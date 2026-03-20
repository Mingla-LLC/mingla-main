# Implementor Prompt: Phase 1 Post-Test Fixes + Commit

## 2 High Fixes

### HIGH-001: City status "seeded" on total failure
In admin-seed-places, after seeding completes, only set city status to "seeded" if `totalNewInserted > 0`. If every category failed with zero places inserted, leave status as "seeding" (or set to "draft" with error). ~5 lines.

### HIGH-002: Hard cap formula mismatch
preview_cost checks search+photo cost against $70, but seed only checks search cost. Align the seed action to use the same formula as preview_cost (search + estimated photo cost). ~3 lines.

## 3 Medium Fixes (if quick)

- Fix FilterResult.passed type annotation
- Fix dryRun overcount of "new" places
- N+1 update pattern for duplicates — if a quick batch update is possible, do it; if not, flag as known perf issue for later

## Commit

```
feat: admin pool management Phase 1 — database, seeding edge function, admin-place-search fix

- New tables: seeding_cities, seeding_tiles, seeding_operations (with error_details JSONB)
- New columns on place_pool: city_id, country, seeding_category
- New RPCs: admin_edit_place, admin_city_place_stats, admin_city_card_stats
- New edge function admin-seed-places: generate_tiles (hex grid), preview_cost ($70 cap), seed (Nearby Search, selective upsert, structured error logging)
- Fixed admin-place-search: locationBias, businessStatus, timeoutFetch
- Country backfill on existing places
```

## README Lock-in

Add/update an "Admin Seeding Pipeline" section:

1. **Tile-based seeding** — cities broken into hex-grid tiles, each tile × category = one Nearby Search call
2. **$70 hard cap** — preview_cost gates on total estimated cost, admin must acknowledge to proceed over cap
3. **Post-fetch filters** — reject closed permanently, reject no photos, reject global excluded types. No-rating places allowed.
4. **Selective upsert** — re-seeding preserves admin-edited fields (price_tier, is_active). Only Google-sourced fields refresh.
5. **Structured error logging** — every tile failure logged with tile_id, category, HTTP status, response body in error_details JSONB
6. **City status flow** — draft → seeding → seeded → launched. Only transitions to "seeded" when places are actually inserted.
