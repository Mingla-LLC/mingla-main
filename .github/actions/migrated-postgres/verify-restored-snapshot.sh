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

# `read` can return 1 at EOF after assigning every field when the final newline
# is missing. The manifest writer includes one, but accepting the assignments
# here keeps verification fail-closed on content instead of shell trivia.
read -r expected_policies expected_triggers expected_indexes \
  expected_rls expected_tables extra < "$manifest" || true

values=(
  "$expected_policies" "$expected_triggers" "$expected_indexes"
  "$expected_rls" "$expected_tables" "$@"
)
for value in "${values[@]}"; do
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "::error::snapshot count manifest and restored counts must contain exactly five non-negative integers" >&2
    exit 1
  fi
done
if [ -n "${extra:-}" ]; then
  echo "::error::snapshot count manifest contains unexpected fields" >&2
  exit 1
fi

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
