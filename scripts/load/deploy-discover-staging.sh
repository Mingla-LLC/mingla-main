#!/usr/bin/env bash
# Deploy ORCH-426 discover scale fixes to Mingla-dev (G2).
# Requires: supabase CLI, SUPABASE_ACCESS_TOKEN, linked project gqnoajqerqhnvulmnyvv
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=...
#   ./scripts/load/deploy-discover-staging.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"

supabase link --project-ref gqnoajqerqhnvulmnyvv --yes
supabase db push --yes
supabase functions deploy discover-merged-events --yes

echo ":: deployed discover-merged-events + migrations 20260612000000 + 20260613000000"
