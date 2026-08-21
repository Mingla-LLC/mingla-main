#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "::error::applied-migration verification requires snapshot and repository manifests" >&2
  exit 2
fi

applied=$1
repository=$2

if [ ! -s "$applied" ]; then
  echo "::warning::snapshot applied-migration manifest is missing or empty" >&2
  exit 1
fi
if [ ! -f "$repository" ]; then
  echo "::error::repository migration manifest is missing: $repository" >&2
  exit 2
fi

# The snapshot manifest is trustworthy only when its complete byte sequence is
# exactly the first N records of the canonical repository manifest. That one
# comparison rejects blank/trailing records, partial final records, duplicates,
# unsorted names, unknown names, and missing-middle histories.
applied_records=$(wc -l < "$applied" | tr -d ' ')
repository_records=$(wc -l < "$repository" | tr -d ' ')
if [ "$applied_records" -eq 0 ] || [ "$applied_records" -gt "$repository_records" ]; then
  echo "::warning::snapshot applied-migration manifest is not a non-empty repository prefix" >&2
  exit 1
fi

if ! cmp -s "$applied" <(head -n "$applied_records" "$repository"); then
  echo "::warning::snapshot applied-migration manifest is not an exact repository prefix" >&2
  exit 1
fi

echo "verified snapshot applied-migration manifest as an exact repository prefix"
