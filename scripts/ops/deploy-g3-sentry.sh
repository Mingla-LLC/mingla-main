#!/usr/bin/env bash
# #426 G3 — deploy Sentry secrets to staging + production Supabase projects.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=...
#   export SENTRY_DSN="https://<key>@o4511136062701568.ingest.us.sentry.io/<project>"
#   ./scripts/ops/deploy-g3-sentry.sh [project-ref]
#
# Default project-ref: gqnoajqerqhnvulmnyvv — this is the LIVE PRODUCTION backend
# (labelled "Mingla-dev" in the dashboard but it is where the live apps point).
# Edge errors captured here are real production errors, so SENTRY_ENVIRONMENT
# defaults to "production". Override by exporting SENTRY_ENVIRONMENT before running.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROJECT_REF="${1:-gqnoajqerqhnvulmnyvv}"
SENTRY_ENVIRONMENT="${SENTRY_ENVIRONMENT:-production}"

node "$ROOT/scripts/ops/verify-production-supabase-authority.mjs" \
  --mode=offline \
  --target-ref "$PROJECT_REF"

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
: "${SENTRY_DSN:?Set SENTRY_DSN (mingla-business edge project DSN)}"

supabase link --project-ref "$PROJECT_REF" --yes
supabase secrets set "SENTRY_DSN=$SENTRY_DSN" "SENTRY_ENVIRONMENT=$SENTRY_ENVIRONMENT"

echo ":: G3 Sentry edge secrets set on $PROJECT_REF (environment=$SENTRY_ENVIRONMENT)"
echo ":: Next: set EXPO_PUBLIC_SENTRY_DSN in EAS for mingla-business (preview + production)"
echo ":: See docs/evidence/g3-sentry/README.md"
