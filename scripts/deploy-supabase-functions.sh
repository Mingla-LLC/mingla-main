#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
project_ref="${SUPABASE_PROJECT_ID:-}"
merged_commit=""
remediation=false
governed_bundle_deploy=false
transition_inputs=false
functions=()
coordinator_args=()

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --function)
      [[ "$#" -ge 2 && -n "$2" ]] || { echo "FAIL deploy: --function requires a name" >&2; exit 2; }
      functions+=("$2")
      coordinator_args+=("--function" "$2")
      shift 2
      ;;
    --project-ref)
      [[ "$#" -ge 2 && -n "$2" ]] || { echo "FAIL deploy: --project-ref requires a value" >&2; exit 2; }
      project_ref="$2"
      shift 2
      ;;
    --merged-commit)
      [[ "$#" -ge 2 && -n "$2" ]] || { echo "FAIL deploy: --merged-commit requires a value" >&2; exit 2; }
      merged_commit="$2"
      coordinator_args+=("--merged-commit" "$2")
      shift 2
      ;;
    --issue-2241-remediation)
      remediation=true
      shift
      ;;
    --ad-input|--delivery-input)
      [[ "$#" -ge 2 && -n "$2" ]] || { echo "FAIL deploy: $1 requires a secure input path" >&2; exit 2; }
      coordinator_args+=("$1" "$2")
      governed_bundle_deploy=true
      shift 2
      ;;
    --delivery-v3-input|--delivery-v4-input)
      [[ "$#" -ge 2 && -n "$2" ]] || { echo "FAIL deploy: $1 requires a secure input path" >&2; exit 2; }
      coordinator_args+=("$1" "$2")
      transition_inputs=true
      shift 2
      ;;
    *)
      echo "FAIL deploy: unsupported argument $1" >&2
      exit 2
      ;;
  esac
done

[[ -n "$project_ref" ]] || { echo "FAIL deploy: explicit production project ref required" >&2; exit 2; }
[[ "${#functions[@]}" -gt 0 ]] || { echo "FAIL deploy: explicit --function selection required; deploy-all is forbidden" >&2; exit 2; }

node "${repo_root}/scripts/ops/verify-production-supabase-authority.mjs" \
  --mode=offline \
  --target-ref "$project_ref"

if [[ "$remediation" == true ]]; then
  exec node "${repo_root}/scripts/secrets/reconcile-governed-secrets.mjs" \
    --project-ref "$project_ref" \
    "${coordinator_args[@]}"
fi

if [[ "$transition_inputs" == true ]]; then
  echo "FAIL deploy: delivery v3/v4 transition inputs require --issue-2241-remediation" >&2
  exit 2
fi

[[ -n "$merged_commit" ]] || { echo "FAIL deploy: --merged-commit is required" >&2; exit 2; }

if [[ "$governed_bundle_deploy" == true ]]; then
  # Not `exec`: #2241 relaxed this route's NORMAL-mode live-name parity so a
  # deploy is no longer refused for the approved migration band, and the
  # post-deploy fallback watch below is that relaxation's replacement
  # observation. `exec` would replace this shell and make it unreachable.
  node "${repo_root}/scripts/secrets/reconcile-governed-secrets.mjs" \
    --normal-governed-deploy \
    --project-ref "$project_ref" \
    "${coordinator_args[@]}"
  node "${repo_root}/scripts/secrets/postdeploy-governed-fallback-watch.mjs" \
    --project-ref "$project_ref"
  exit 0
fi

preflight_args=(
  --project-ref "$project_ref"
  --merged-commit "$merged_commit"
)
for function_name in "${functions[@]}"; do
  preflight_args+=(--function "$function_name")
done
node "${repo_root}/scripts/secrets/preflight-function-secret-readiness.mjs" \
  "${preflight_args[@]}"

for function_name in "${functions[@]}"; do
  set +e
  deploy_output=$(supabase functions deploy "$function_name" \
    --project-ref "$project_ref" \
    --use-api 2>&1)
  deploy_status=$?
  set -e
  if [[ "$deploy_status" -ne 0 && "$deploy_output" != *'unexpected deploy status 409: {"message":"deployment already exists"}'* ]]; then
    echo "FAIL deploy: function deployment failed for ${function_name}" >&2
    exit "$deploy_status"
  fi
  echo "PASS deployed ${function_name}"
done

# #2241 replacement observation. Normal-mode live-name parity now ACCEPTS the
# approved two-name migration band instead of refusing the deploy, so the risk
# that strictness was holding — a function passing while it silently reads the
# OLD standalone copy — is watched rather than assumed away. The resolver emits
# `governed_ad_legacy_fallback` / `governed_ad_bundle_invalid` exactly when that
# happens; observing either fails this deploy job. It fails closed: no
# credential, no traffic, or an unreadable response is a failure, not a skip.
node "${repo_root}/scripts/secrets/postdeploy-governed-fallback-watch.mjs" \
  --project-ref "$project_ref"
