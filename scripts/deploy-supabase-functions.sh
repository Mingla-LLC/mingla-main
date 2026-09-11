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
    --sites-input)
      # #2830 — MINGLA_SITES_SECURITY_JSON was the only governed bundle with no
      # input flag. All four brand-site-* functions declare it in
      # required_bundle_fields, so the normal lane refuses them
      # (governed_bundle_lane_required) and the governed lane had no way to
      # supply them: they were deployable through NO sanctioned path, and every
      # change to them reddened main. This closes that, mirroring --ad-input
      # and --delivery-input rather than inventing a sites-only escape.
      [[ "$#" -ge 2 && -n "$2" ]] || { echo "FAIL deploy: $1 requires a secure input path" >&2; exit 2; }
      coordinator_args+=("$1" "$2")
      governed_bundle_deploy=true
      shift 2
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

# #3186 — bake the release attestation INTO the bundle before it is built.
#
# `MINGLA_RELEASE_SHA` was declared optional and set by nobody: the runbook told
# a human to "embed the SHA" and no caller ever did, so production served
# `release_sha: "unattested"`, the Business app rejected 100% of Ari responses,
# and Ari was dead on every production build for nine days (#3185). A runbook
# sentence is not a setter.
#
# A file, not a secret: the constant travels with the bundle it describes and so
# cannot name a different commit than the one deployed, and it spends no slot
# against the founder-approved 88-name capacity target. This runs for EVERY
# deploy because the module is shared — whichever functions are being shipped,
# the ones that bundle it get a stamp describing exactly themselves.
release_bake_file="${repo_root}/supabase/functions/_shared/releaseAttestationBake.ts"
# Exactly 40 lowercase hex. The client's `RELEASE_SHA_RE` is `^[0-9a-f]{40}$`
# while the edge pattern tolerates 40-64, so a longer digest would pass the
# server and be rejected by every app — #3185 again, from the other end.
if [[ ! "$merged_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "FAIL deploy: --merged-commit must be exactly 40 lowercase hex to bake MINGLA release attestation (got '${merged_commit}')" >&2
  exit 2
fi
if ! grep -q '^export const BAKED_RELEASE_SHA = ' "$release_bake_file"; then
  echo "FAIL deploy: release attestation bake target not found in ${release_bake_file}" >&2
  exit 2
fi
# The value is a validated 40-hex literal, so it cannot carry sed metacharacters.
perl -pi -e "s{^export const BAKED_RELEASE_SHA = .*\$}{export const BAKED_RELEASE_SHA = \"${merged_commit}\";}" \
  "$release_bake_file"
if ! grep -q "^export const BAKED_RELEASE_SHA = \"${merged_commit}\";\$" "$release_bake_file"; then
  echo "FAIL deploy: release attestation bake did not take effect" >&2
  exit 2
fi
echo "PASS baked release attestation ${merged_commit}"

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
