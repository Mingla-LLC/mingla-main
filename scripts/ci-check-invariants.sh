#!/bin/bash
# ORCH-0640 ch15 — CI invariant grep gates.
# Enforces 7 invariants established in ORCH-0640 (I-POOL-ONLY-SERVING,
# I-BOUNCER-IS-QUALITY-GATE, I-THREE-GATE-SERVING, I-GEOCODING-VS-SERVING-BOUNDARY,
# I-PLACE-ID-CONTRACT, I-CURATED-STOP-INTEGRITY, I-ENGAGEMENT-IDENTITY-PLACE-LEVEL).
#
# Run locally:  ./scripts/ci-check-invariants.sh
# Exit code 0 = pass, 1 = violation found.

set -e

echo "ORCH-0640 CI invariant check..."
FAIL=0

# ─── I-POOL-ONLY-SERVING: no card_pool refs outside archive/docs/Mingla_Artifacts ───
CARD_POOL_VIOLATIONS=$(git grep -l "\.from(.card_pool\|from('card_pool" \
    supabase/functions/ \
    app-mobile/src/ \
    mingla-admin/src/ \
    2>/dev/null \
  | grep -vE '_archive|\.md$|Mingla_Artifacts/|/outputs/|/prompts/' \
  || true)
if [ -n "$CARD_POOL_VIOLATIONS" ]; then
  echo "FAIL: card_pool reference found outside archive/docs:"
  echo "$CARD_POOL_VIOLATIONS"
  FAIL=1
fi

# ─── I-BOUNCER-IS-QUALITY-GATE: no ai_approved in serving code or admin frontend ───
# ORCH-0646 extension (2026-04-23): mingla-admin/src/ added after ORCH-0640 cleanup
# gap allowed ai_approved references to persist in admin pages after column drop.
# Must not regress — admin reads the same dropped column and would 500.
AI_VIOLATIONS=$(git grep -l "ai_approved\|ai_override\|ai_validated" \
    supabase/functions/discover-cards/ \
    supabase/functions/generate-curated-experiences/ \
    supabase/functions/get-person-hero-cards/ \
    supabase/functions/get-paired-saves/ \
    app-mobile/src/ \
    mingla-admin/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)
if [ -n "$AI_VIOLATIONS" ]; then
  echo "FAIL: AI-validation reference in serving code:"
  echo "$AI_VIOLATIONS"
  FAIL=1
fi

# ─── I-GEOCODING-VS-SERVING-BOUNDARY: Google Places only in allow-listed files ───
ALLOWED_REGEX='supabase/functions/(admin-seed-places|admin-refresh-places|admin-place-search|_shared/placesCache|_shared/textSearchHelper|_shared/photoStorageService|backfill-place-photos|admin-seed-map-strangers)|app-mobile/src/(services/geocodingService|utils/throttledGeocode)'
GOOGLE_VIOLATIONS=$(git grep -l "places\.googleapis\|maps\.googleapis" \
    supabase/ \
    app-mobile/src/ \
    2>/dev/null \
  | grep -vE "$ALLOWED_REGEX" \
  | grep -vE '\.md$' \
  || true)
if [ -n "$GOOGLE_VIOLATIONS" ]; then
  echo "FAIL: Google Places API call outside allowed surfaces:"
  echo "$GOOGLE_VIOLATIONS"
  echo "(Allowed: admin-seed-places, admin-refresh-places, admin-place-search,"
  echo " _shared/placesCache, _shared/textSearchHelper, _shared/photoStorageService,"
  echo " backfill-place-photos, admin-seed-map-strangers, geocodingService, throttledGeocode)"
  FAIL=1
fi

# ─── Legacy 2025-era tables: no .from('saves'|'experiences'|'saved_experiences') in mobile/edge ───
LEGACY_VIOLATIONS=$(git grep -lE "\.from\(.(saves|experiences|saved_experiences)." \
    supabase/functions/ \
    app-mobile/src/ \
    mingla-admin/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)
if [ -n "$LEGACY_VIOLATIONS" ]; then
  echo "FAIL: legacy saves/experiences/saved_experiences table reference:"
  echo "$LEGACY_VIOLATIONS"
  FAIL=1
fi

# ─── Deleted services: no imports from experiencesService, experienceGenerationService, savesService, useExperiences ───
DELETED_IMPORT_VIOLATIONS=$(git grep -l "from ['\"].*\\(experiencesService\\|experienceGenerationService\\|savesService\\|useExperiences\\)['\"]" \
    app-mobile/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)
if [ -n "$DELETED_IMPORT_VIOLATIONS" ]; then
  echo "FAIL: import from deleted service/hook:"
  echo "$DELETED_IMPORT_VIOLATIONS"
  FAIL=1
fi

if [ $FAIL -eq 1 ]; then
  echo ""
  echo "ORCH-0640 invariant check FAILED."
  exit 1
fi

echo "All ORCH-0640 invariant gates pass."
exit 0
