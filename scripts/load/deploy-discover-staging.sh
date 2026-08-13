#!/usr/bin/env bash
# Historical ORCH-426 production deployment helper. Despite this legacy filename,
# this script targets Mingla production only and must pass the production-authority
# guard before it links, migrates, or deploys.
# Requires: supabase CLI and SUPABASE_ACCESS_TOKEN.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=...
#   ./scripts/load/deploy-discover-staging.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROJECT_REF="${SUPABASE_PROJECT_REF:-gqnoajqerqhnvulmnyvv}"

node "$ROOT/scripts/ops/verify-production-supabase-authority.mjs" \
  --mode=offline \
  --target-ref "$PROJECT_REF"

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"

supabase link --project-ref "$PROJECT_REF" --yes
supabase db push --yes
supabase functions deploy discover-merged-events --project-ref "$PROJECT_REF" --yes

echo ":: deployed discover-merged-events + migrations 20260612000000 + 20260613000000"
