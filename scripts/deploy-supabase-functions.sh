#!/usr/bin/env bash

set -euo pipefail

: "${SUPABASE_PROJECT_ID:?SUPABASE_PROJECT_ID is required}"

functions_root="${1:-supabase/functions}"

deploy_function() {
  local func_name="$1"
  local output
  local exit_code

  set +e
  output=$(supabase functions deploy "$func_name" \
    --project-ref "$SUPABASE_PROJECT_ID" \
    --use-api 2>&1)
  exit_code=$?
  set -e

  printf '%s\n' "$output"

  if [[ "$exit_code" -eq 0 ]]; then
    return 0
  fi

  if [[ "$output" == *'unexpected deploy status 409: {"message":"deployment already exists"}'* ]]; then
    printf 'Function %s is already current; continuing.\n' "$func_name"
    return 0
  fi

  return "$exit_code"
}

for dir in "$functions_root"/*/; do
  func_name=$(basename "$dir")
  if [[ "$func_name" == _* ]]; then
    continue
  fi
  if [[ ! -f "${dir}index.ts" ]]; then
    echo "Skipping $func_name (no index.ts entrypoint)"
    continue
  fi
  echo "Deploying $func_name..."
  deploy_function "$func_name"
done
