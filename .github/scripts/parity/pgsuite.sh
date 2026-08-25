# shellcheck shell=bash
# #2591 — the parity-ledger command wrappers, sourced by BOTH sides.
#
# ONE definition, not two. The consolidated `postgres-contract-suites` job and
# the nine origin lanes run at the same commit and their records are compared
# row by row; if each side had its own copy of this logic, a divergence in the
# TOOLING would present as a parity failure in the SUITES. So both sides source
# this file, and the only difference between them is the `-d` argument.
#
# [TRANSITIONAL] The origin lanes' use of this file is #2591 shadow scaffolding.
# Exit condition: the #2591 cutover PR, which deletes the nine origin lanes.
#
# CONTRACT
#   PARITY_CONTAINER   the docker container holding PostgreSQL (required)
#   PARITY_DIR         where logs and the row index live (default $RUNNER_TEMP/parity)
#
# WHAT IS ADDED TO EVERY COMMAND, AND NOTHING ELSE: a tee into a durable
# per-command log. NOTHING ELSE — not even `-e`.
#
# An earlier draft added psql's `-e` on the premise that the bare `DO` command
# tag needed it. MEASURED on real PostgreSQL 17.10: it does not. psql prints the
# server's command tag — the bare line `DO` for a completed anonymous block —
# with or without `-e`; `-e` adds only the echoed query text. The per-block
# execution witness guard G-2 counts is therefore already present in an
# unmodified lane's output, which is what lets the origin side of the ledger be
# READ from the Actions job logs instead of instrumented.
#
# Both sides consequently execute a byte-identical psql invocation, differing
# only in `-d`. That is the property the ledger is comparing; an instrumentation
# flag on one side only would have put a difference into the very run whose job
# is proving there is none.
#
# PIPESTATUS[0] is read explicitly. Without it `tee` supplies the pipeline's
# exit status and a failing suite reports as a pass — the dark-gate shape this
# whole change exists to avoid.

PARITY_DIR="${PARITY_DIR:-${RUNNER_TEMP:-/tmp}/parity}"
PARITY_CONTAINER="${PARITY_CONTAINER:-${PG_CONTRACT_CONTAINER:-}}"
mkdir -p "$PARITY_DIR"

parity_record() { # id kind database file exit
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >> "$PARITY_DIR/index.tsv"
}

parity_inventory() { # id kind database
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$PARITY_DIR/inventory.tsv"
}

run_psql() { # id database file
  local id="$1" db="$2" file="$3" status=0
  if [ -z "$PARITY_CONTAINER" ]; then
    echo "::error::run_psql $id: PARITY_CONTAINER is unset. Refusing to guess a container."
    return 1
  fi
  set +e
  docker exec -i "$PARITY_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U postgres -d "$db" \
    < "$file" 2>&1 | tee "$PARITY_DIR/$id.log"
  status="${PIPESTATUS[0]}"
  set -e
  parity_record "$id" psql "$db" "$file" "$status"
  return "$status"
}

run_psql_background() { # id database file  — sets PARITY_BG_PID
  local id="$1" db="$2" file="$3"
  (
    set +e
    docker exec -i "$PARITY_CONTAINER" \
      psql -v ON_ERROR_STOP=1 -U postgres -d "$db" \
      < "$file" > "$PARITY_DIR/$id.log" 2>&1
    bg_status=$?
    # Written, then echoed once the process finishes, rather than teed: two
    # concurrent psql sessions writing to the same terminal interleave, and the
    # ledger has to be able to read each one's output on its own.
    cat "$PARITY_DIR/$id.log"
    printf '%s\t%s\t%s\t%s\t%s\n' "$id" psql "$db" "$file" "$bg_status" >> "$PARITY_DIR/index.tsv"
    exit "$bg_status"
  ) &
  PARITY_BG_PID=$!
}

run_logged() { # id kind database -- command...
  local id="$1" kind="$2" db="$3" status=0
  shift 3
  if [ "${1:-}" = "--" ]; then shift; fi
  set +e
  "$@" 2>&1 | tee "$PARITY_DIR/$id.log"
  status="${PIPESTATUS[0]}"
  set -e
  parity_record "$id" "$kind" "$db" "" "$status"
  return "$status"
}
