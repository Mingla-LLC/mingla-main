#!/usr/bin/env bash
#
# ORCH-1392 — SECURITY DEFINER anon-grant CI gate (live effective-privilege probe).
#
# Enforces I-PROPOSED-1392-NO-UNALLOWLISTED-ANON-DEFINER: no non-trigger
# SECURITY DEFINER function in schema `public` may be anon-EXECUTE-able unless
# its identity signature is present in the allowlist. INVESTIGATION_ORCH-1392
# F-6 PROVED a source-regex is unreliable (misses TRUNCATE/REFRESH/net.http_post/
# aliased-UPDATE; false-flags helper-gated fns) — so the source of truth MUST be
# the live has_function_privilege('anon', ...) ACL, not a migration grep.
#
# Connects via standard PG* env (defaults match the CI Postgres service:
# localhost:5432 postgres/postgres postgres). Run AFTER migrations apply.
#
# Exit 0 = every anon-exec definer fn is allowlisted. Exit 1 = at least one
# anon-exec definer fn is NOT allowlisted (a reverted REVOKE, or a new leaky fn).
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

# Resolve the allowlist relative to the repo root (this script lives in scripts/ci/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ALLOWLIST="${ALLOWLIST:-${REPO_ROOT}/supabase/security/anon_executable_definer_allowlist.txt}"

if [ ! -f "$ALLOWLIST" ]; then
  echo "FATAL: allowlist not found at $ALLOWLIST" >&2
  exit 2
fi

# --- 1. Canonical probe: the authoritative anon-exec definer enumeration -------
PROBE_SQL="SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname = 'public'
  AND p.prorettype <> 'pg_catalog.trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY 1;"

probe_out="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tA -c "$PROBE_SQL")"

# --- 2. Allowlist: strip # comments + blank lines + trailing whitespace --------
allow_out="$(grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$ALLOWLIST" | sed 's/[[:space:]]*$//')"

# --- 3. Diff: probed signatures not present in the allowlist = violations ------
violations=()
while IFS= read -r sig; do
  [ -z "$sig" ] && continue
  if ! grep -qxF "$sig" <<<"$allow_out"; then
    violations+=("$sig")
  fi
done <<<"$probe_out"

# --- 4. Verdict ----------------------------------------------------------------
if [ "${#violations[@]}" -gt 0 ]; then
  echo "SECURITY DEFINER anon-grant gate FAILED: ${#violations[@]} unallowlisted anon-executable definer function(s):"
  for sig in "${violations[@]}"; do
    echo "  - public.${sig} is EXECUTE-able by anon but not allowlisted."
  done
  echo ""
  echo "Add an explicit 'REVOKE EXECUTE ON FUNCTION public.<sig> FROM PUBLIC, anon;' migration,"
  echo "OR (if intentionally public) add the signature to"
  echo "  supabase/security/anon_executable_definer_allowlist.txt"
  echo "with a justification comment."
  exit 1
fi

probe_count="$(grep -cvE '^[[:space:]]*$' <<<"$probe_out" || true)"
echo "OK: ${probe_count} anon-executable definer functions, all allowlisted."

# --- 5. Reverse-drift (warn-only): stale allowlist lines not in the probe ------
while IFS= read -r sig; do
  [ -z "$sig" ] && continue
  if ! grep -qxF "$sig" <<<"$probe_out"; then
    echo "WARN: allowlist entry not present in probe (stale line — fn dropped/renamed?): $sig"
  fi
done <<<"$allow_out"

exit 0
