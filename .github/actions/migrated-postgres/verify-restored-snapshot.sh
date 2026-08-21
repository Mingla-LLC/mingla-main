#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo "::error::snapshot verification requires a manifest plus five catalog counts" >&2
  exit 2
fi

manifest=$1
shift

if [ ! -f "$manifest" ]; then
  echo "::error::snapshot count manifest is missing: $manifest" >&2
  exit 1
fi

# Accept exactly one five-integer record, with either the writer's single final
# LF or no final LF. Comparing the complete file to those two canonical byte
# sequences rejects every blank, trailing, additional, partial, CRLF, or binary
# record instead of trusting only the first line read by Bash.
manifest_record=""
IFS= read -r manifest_record < "$manifest" || true
if ! [[ "$manifest_record" =~ ^([0-9]+)\ ([0-9]+)\ ([0-9]+)\ ([0-9]+)\ ([0-9]+)$ ]]; then
  echo "::error::snapshot count manifest must contain exactly one record of five non-negative integers" >&2
  exit 1
fi
if ! cmp -s "$manifest" <(printf '%s' "$manifest_record") && \
   ! cmp -s "$manifest" <(printf '%s\n' "$manifest_record"); then
  echo "::error::snapshot count manifest contains trailing or additional bytes" >&2
  exit 1
fi

expected_policies=${BASH_REMATCH[1]}
expected_triggers=${BASH_REMATCH[2]}
expected_indexes=${BASH_REMATCH[3]}
expected_rls=${BASH_REMATCH[4]}
expected_tables=${BASH_REMATCH[5]}

for value in "$@"; do
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "::error::snapshot count manifest and restored counts must contain exactly five non-negative integers" >&2
    exit 1
  fi
done

expected=(
  "$expected_policies" "$expected_triggers" "$expected_indexes"
  "$expected_rls" "$expected_tables"
)
actual=("$@")
labels=(policies triggers indexes rls_tables tables)

for index in "${!labels[@]}"; do
  if [ "${actual[$index]}" != "${expected[$index]}" ]; then
    echo "::error::physical database restore does not match its snapshot manifest" >&2
    echo "::error::snapshot: policies=${expected[0]} triggers=${expected[1]} indexes=${expected[2]} rls_tables=${expected[3]} tables=${expected[4]}" >&2
    echo "::error::restored: policies=${actual[0]} triggers=${actual[1]} indexes=${actual[2]} rls_tables=${actual[3]} tables=${actual[4]}" >&2
    echo "::error::mismatch: ${labels[$index]} expected=${expected[$index]} actual=${actual[$index]}" >&2
    exit 1
  fi
done

echo "verified physical restore against snapshot manifest (policies=${actual[0]} triggers=${actual[1]} indexes=${actual[2]} rls_tables=${actual[3]} tables=${actual[4]})"
