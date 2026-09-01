#!/usr/bin/env bash

set -euo pipefail

MODE="${1:-preflight}"
if [[ "$MODE" != "preflight" && "$MODE" != "deploy" && "$MODE" != "readback" ]]; then
  echo "usage: $0 [preflight|deploy|readback]" >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PROJECT_REF="gqnoajqerqhnvulmnyvv"
SUPABASE_BIN="${SUPABASE_BIN:-supabase}"

FUNCTIONS=(
  brand-site-control
  brand-site-cms-callback
  brand-site-runtime-resolve
  brand-site-attribution
)

node "${SCRIPT_DIR}/verify-production-supabase-authority.mjs" \
  --mode=offline \
  --target-ref "$PROJECT_REF"

for function_name in "${FUNCTIONS[@]}"; do
  test -f "${REPO_ROOT}/supabase/functions/${function_name}/index.ts" || {
    echo "missing allowlisted source: ${function_name}" >&2
    exit 1
  }
done

node - "$REPO_ROOT/supabase/config.toml" <<'NODE'
const fs = require("node:fs");
const config = fs.readFileSync(process.argv[2], "utf8");
const expected = new Map([
  ["brand-site-control", true],
  ["brand-site-cms-callback", false],
  ["brand-site-runtime-resolve", false],
  ["brand-site-attribution", false],
]);
for (const [name, verifyJwt] of expected) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = config.match(
    new RegExp(`\\[functions\\.${escaped}\\]\\s*\\nverify_jwt\\s*=\\s*(true|false)`),
  );
  if (!match || (match[1] === "true") !== verifyJwt) {
    throw new Error(`${name}: verify_jwt must be exactly ${verifyJwt}`);
  }
}
NODE

function_rows() {
  "$SUPABASE_BIN" functions list --project-ref "$PROJECT_REF" --output json
}

validate_readback() {
  local require_all="$1"
  local rows="$2"
  SITES_FUNCTIONS_JSON="$rows" node - "$require_all" <<'NODE'
const rows = JSON.parse(process.env.SITES_FUNCTIONS_JSON || "[]");
const requireAll = process.argv[2] === "true";
const expected = new Map([
  ["brand-site-control", true],
  ["brand-site-cms-callback", false],
  ["brand-site-runtime-resolve", false],
  ["brand-site-attribution", false],
]);
for (const [name, verifyJwt] of expected) {
  const matches = rows.filter((row) => row.slug === name || row.name === name);
  if (matches.length === 0 && !requireAll) {
    console.log(`${name}: not deployed`);
    continue;
  }
  if (matches.length !== 1) throw new Error(`${name}: readback count ${matches.length}`);
  const row = matches[0];
  if (row.status !== "ACTIVE" || row.verify_jwt !== verifyJwt ||
      !Number.isSafeInteger(row.version) || row.version < 1 ||
      typeof row.ezbr_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.ezbr_sha256)) {
    throw new Error(`${name}: unsafe readback`);
  }
  console.log(`${name}: ACTIVE version=${row.version} verify_jwt=${row.verify_jwt} bundle_sha256=${row.ezbr_sha256}`);
}
NODE
}

readback() {
  local require_all="$1"
  validate_readback "$require_all" "$(function_rows)"
}

if [[ "$MODE" == "preflight" ]]; then
  readback false
  echo "Sites Edge preflight PASS: exact four-function allowlist; no deployment performed."
  exit 0
fi

if [[ "$MODE" == "readback" ]]; then
  readback true
  echo "Sites Edge readback PASS."
  exit 0
fi

before_rows="$(function_rows)"
validate_readback false "$before_rows"

for function_name in "${FUNCTIONS[@]}"; do
  args=(
    functions deploy "$function_name"
    --project-ref "$PROJECT_REF"
    --use-api
  )
  if [[ "$function_name" != "brand-site-control" ]]; then
    args+=(--no-verify-jwt)
  fi
  if ! deploy_output="$($SUPABASE_BIN "${args[@]}" 2>&1)"; then
    printf '%s\n' "$deploy_output" >&2
    exit 1
  fi
  printf '%s\n' "$deploy_output"
done

after_rows="$(function_rows)"
validate_readback true "$after_rows"
SITES_FUNCTIONS_BEFORE_JSON="$before_rows" \
SITES_FUNCTIONS_AFTER_JSON="$after_rows" node <<'NODE'
const before = JSON.parse(process.env.SITES_FUNCTIONS_BEFORE_JSON || "[]");
const after = JSON.parse(process.env.SITES_FUNCTIONS_AFTER_JSON || "[]");
const names = [
  "brand-site-control",
  "brand-site-cms-callback",
  "brand-site-runtime-resolve",
  "brand-site-attribution",
];
for (const name of names) {
  const previous = before.filter((row) => row.slug === name || row.name === name);
  const current = after.filter((row) => row.slug === name || row.name === name);
  if (previous.length > 1 || current.length !== 1) {
    throw new Error(`${name}: ambiguous deployment version readback`);
  }
  const previousVersion = previous.length === 0 ? 0 : previous[0].version;
  if (!Number.isSafeInteger(previousVersion) || previousVersion < 0 ||
      current[0].version <= previousVersion) {
    throw new Error(
      `${name}: deployment version did not advance from ${previousVersion}`,
    );
  }
}
NODE
echo "Sites Edge deployment PASS: only the four allowlisted functions were deployed."
