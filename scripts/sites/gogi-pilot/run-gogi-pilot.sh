#!/usr/bin/env bash
#
# #2830 — upload gögi's media, then seed their five pages. One command.
#
# Needs a short-lived Studio session in the environment:
#   export MINGLA_SITES_SEED_STUDIO_COOKIE='...'
#   export MINGLA_SITES_SEED_STUDIO_CSRF='...'
#
# Both steps are idempotent. The upload reuses anything already stored; the
# seed refuses to overwrite content it did not write. Re-running is safe.
#
# Without --apply both steps report what they WOULD do and write nothing.
set -euo pipefail

SITE_ID="90f19f28-42e2-4eb9-b88b-02829bfcb045"
BRAND_ID="733bc470-45e1-4684-8896-acd7e26074ff"
TENANT_ID="1e2c8df0-19a3-4da9-a879-1408c891efdc"
CONFIGURED_BY="1f3d2ddf-b741-4e2f-8884-d7222a660c7e"
SOURCE="gogi-ingest-brief-2026-08-27"

MEDIA_DIR="${GOGI_MEDIA_DIR:-/Users/sethogieva/Desktop/mingla-orchs/gogi-pilot-media}"
HERO="${MEDIA_DIR}/assets/img/food/coconut-rice-hero.jpg"
HERO_SHA256="134fc42cd5aefa96149cbcbf9790d18eabcb4f0c4e87edd7f0c8d757ed087d73"
MANIFEST="${GOGI_MEDIA_MANIFEST:-${MEDIA_DIR}/media-manifest.json}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY=""
if [ "${1:-}" = "--apply" ]; then APPLY="--apply"; fi

if [ ! -f "$HERO" ]; then
  echo "missing media at ${MEDIA_DIR} — set GOGI_MEDIA_DIR" >&2
  exit 1
fi

echo "==> 1/2  media upload ${APPLY:-(dry run)}"
node "${HERE}/upload-gogi-media.mjs" \
  --source-dir "$MEDIA_DIR" \
  --manifest-out "$MANIFEST" \
  --site-id "$SITE_ID" \
  --brand-id "$BRAND_ID" \
  --tenant-id "$TENANT_ID" \
  --configured-by "$CONFIGURED_BY" \
  --source "$SOURCE" \
  $APPLY

# The seed only gets a manifest if the upload actually produced one. Passing a
# stale or absent manifest would quietly seed a site with no pictures.
MANIFEST_ARG=()
if [ -n "$APPLY" ] && [ -f "$MANIFEST" ]; then
  MANIFEST_ARG=(--media-manifest "$MANIFEST")
fi

echo "==> 2/2  page seed ${APPLY:-(dry run)}"
node "${HERE}/seed-gogi-pilot.mjs" \
  --site-id "$SITE_ID" \
  --brand-id "$BRAND_ID" \
  --tenant-id "$TENANT_ID" \
  --configured-by "$CONFIGURED_BY" \
  --hero-image "$HERO" \
  --hero-sha256 "$HERO_SHA256" \
  --source "$SOURCE" \
  "${MANIFEST_ARG[@]}" \
  $APPLY

echo "==> done. Publish from the Website workspace to put it live."
