#!/usr/bin/env bash
# #426 G3 — deploy Sentry secrets to staging + production Supabase projects.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=...
#   export SENTRY_DSN="https://<key>@o4511136062701568.ingest.us.sentry.io/<project>"
#   ./scripts/ops/deploy-g3-sentry.sh [project-ref]
#
# Default project-ref: gqnoajqerqhnvulmnyvv (Mingla-dev / G2 staging)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROJECT_REF="${1:-gqnoajqerqhnvulmnyvv}"

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
: "${SENTRY_DSN:?Set SENTRY_DSN (mingla-business edge project DSN)}"

supabase link --project-ref "$PROJECT_REF" --yes
supabase secrets set "SENTRY_DSN=$SENTRY_DSN" "SENTRY_ENVIRONMENT=staging"

echo ":: G3 Sentry edge secrets set on $PROJECT_REF"
echo ":: Next: set EXPO_PUBLIC_SENTRY_DSN in EAS for mingla-business (preview + production)"
echo ":: See docs/evidence/g3-sentry/README.md"
