# #2591 — the parity-ledger command wrappers for the CONSOLIDATED side only.
#
# [U-6] This file used to say it was "sourced by BOTH sides" and that the origin
# lanes' use of it was shadow scaffolding. That describes a design that was
# SUPERSEDED and it is corrected here rather than left to mislead the next
# reader: the nine origin lanes are byte-identical to `main` and do NOT source
# this file. They are not instrumented at all.
#
# The reason they need not be: psql prints the server's command tag — the bare
# line `DO` for a completed anonymous block — with or without `-e`. MEASURED on
# PostgreSQL 17.10. An unmodified lane therefore already prints the witness, and
# the origin half of the ledger was READ BACK from the Actions job logs afterwards
# by parse-origin-log.mjs. Nothing was instrumented on the commit whose whole job
# was proving nothing changed.
#
# THAT PARAGRAPH IS HISTORY as of the #2591 cutover: the nine origin lanes are
# deleted, there is no origin half any more, and parse-origin-log.mjs was retired
# with its subject in the same commit. It is kept in the past tense rather than
# removed because it records how the parity that justified the deletion was
# obtained. What survives here is the consolidated side, which G-5 still reads.
#
# So the ONLY thing these wrappers add to a command is a tee into a durable
# per-command log. The psql invocation is byte-identical to the origin lanes'
# modulo `-d`, which is the property the ledger compares.
#
# CONTRACT
#   PARITY_CONTAINER   the docker container holding PostgreSQL (required)
#   PARITY_DIR         where logs and the row index live (default $RUNNER_TEMP/parity)
#
# PIPESTATUS[0] is read explicitly. Without it `tee` supplies the pipeline's exit
# status and a failing suite reports as a pass — the dark-gate shape this whole
# change exists to avoid.

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
