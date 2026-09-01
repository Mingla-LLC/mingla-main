#!/usr/bin/env bash
set -euo pipefail

# #2893: GitHub-hosted runners do not promise a PostgreSQL 17 client. The
# production workflow exposes this file through pg_dump/pg_restore/psql
# symlinks and runs the exact client inside an ephemeral pinned PG17 image.
command_name="$(basename "$0")"
case "$command_name" in
  pg_dump|pg_restore|psql) ;;
  *)
    printf '%s\n' 'SITES_PG17_ERROR code=UNSUPPORTED_COMMAND' >&2
    exit 64
    ;;
esac

mount_root="${SITES_PG17_MOUNT_ROOT:-}"
case "$mount_root" in
  /*) ;;
  *)
    printf '%s\n' 'SITES_PG17_ERROR code=INVALID_MOUNT_ROOT' >&2
    exit 65
    ;;
esac
if [[ "$mount_root" == "/" || "$mount_root" == "$HOME" || ! -d "$mount_root" ]]; then
  printf '%s\n' 'SITES_PG17_ERROR code=INVALID_MOUNT_ROOT' >&2
  exit 65
fi

runner_uid="$(id -u)"
runner_gid="$(id -g)"
if [[ ! "$runner_uid" =~ ^[1-9][0-9]*$ || ! "$runner_gid" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'SITES_PG17_ERROR code=INVALID_RUNNER_IDENTITY' >&2
  exit 66
fi

exec docker run --rm --network host \
  --user "$runner_uid:$runner_gid" \
  --volume "$mount_root:$mount_root" \
  --workdir "$PWD" \
  --env PGHOST \
  --env PGPORT \
  --env PGDATABASE \
  --env PGUSER \
  --env PGPASSWORD \
  --env PGSSLMODE \
  --env PGAPPNAME \
  postgres:17.10-alpine \
  "$command_name" "$@"
