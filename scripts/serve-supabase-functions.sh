#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
config_file="${repo_root}/supabase/config.toml"
config_lock_dir="${config_file}.materialization.lock"
config_lock_held=false
function_name=""
config_backup=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --function)
      [[ "$#" -ge 2 && -n "$2" ]] || { echo "FAIL serve: --function requires a name" >&2; exit 2; }
      [[ -z "$function_name" ]] || { echo "FAIL serve: exactly one --function is allowed" >&2; exit 2; }
      function_name="$2"
      shift 2
      ;;
    *)
      echo "FAIL serve: unsupported argument $1" >&2
      exit 2
      ;;
  esac
done

[[ -n "$function_name" ]] || { echo "FAIL serve: explicit --function selection required" >&2; exit 2; }
[[ "$function_name" =~ ^[a-z0-9]+([_-][a-z0-9]+)*$ ]] || { echo "FAIL serve: invalid function name" >&2; exit 2; }

restore_config() {
  local status=$?
  if [[ -n "${config_backup:-}" && -f "$config_backup" ]]; then
    if cp "$config_backup" "$config_file"; then
      rm -f "$config_backup"
    else
      echo "WARN serve: could not restore ${config_file}; the original is at ${config_backup}" >&2
    fi
  fi
  if [[ "$config_lock_held" == true ]]; then
    rmdir "$config_lock_dir"
    config_lock_held=false
  fi
  return "$status"
}

acquire_config_lock() {
  local attempt
  for ((attempt = 0; attempt < 600; attempt += 1)); do
    if mkdir "$config_lock_dir" 2>/dev/null; then
      config_lock_held=true
      return 0
    fi
    sleep 0.1
  done
  echo "FAIL serve: timed out waiting for exclusive function config materialization; no action executed" >&2
  return 75
}

trap restore_config EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
acquire_config_lock
config_backup="$(mktemp "${TMPDIR:-/tmp}/mingla-function-config.XXXXXX")"
cp "$config_file" "$config_backup"

node "${repo_root}/.github/scripts/ci-discovery/function-policy.mjs" \
  --write-config "$config_file"
supabase functions serve "$function_name"
