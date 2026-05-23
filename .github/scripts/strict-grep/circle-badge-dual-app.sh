#!/usr/bin/env bash
# Enforces I-PROPOSED-YOUR-CIRCLE-BADGE-MEANS-DUAL-APP.
set -euo pipefail

SCOPE="app-mobile/src/components/profile/circle"

hits=$(grep -rn "briefcase" "$SCOPE" 2>/dev/null | grep -v "hasBusinessApp" || true)
if [ -n "$hits" ]; then
  echo "FAIL: briefcase badge must be gated by person.hasBusinessApp:"
  echo "$hits"
  exit 1
fi

if ! grep -rEn "person\\.hasBusinessApp \\? <BusinessBadge hasBusinessApp=\\{person\\.hasBusinessApp\\} /> : null" "$SCOPE" >/dev/null 2>&1; then
  echo "FAIL: CircleAvatarTile must render BusinessBadge only via person.hasBusinessApp."
  exit 1
fi

echo "PASS: G-CIRCLE-BADGE-DUAL-APP"
