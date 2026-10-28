#!/usr/bin/env bash
# #2829 W7b — private pixel-parity run (spec §7) of the local pilot site
# against the private baselines. Needs the local stack with the pilot site
# seeded (scripts/sites/local/seed-young-and-stamped.mjs) and the runtime
# running as a PRODUCTION build (`next build && next start`, e.g.
# scripts/sites/local/run-local-sites.sh --prod).
#
#   mingla-sites/e2e/ys-parity/run.sh [--pages a,b] [--first-visit]
#
#   YS_BASELINE_DIR  default ~/.mingla-private/2829/investigation/ys-shots-v2
#                    (W7c: re-captured from the live site with the same
#                    capture.mjs --baseline-capture procedure; v1 is kept)
#   YS_PARITY_ORIGIN default http://youngandstamped.sites.localhost:3100
#   YS_PARITY_OUT    default ~/.mingla-private/2829/parity-runs/<UTC timestamp>
#
# Baselines, screenshots, diffs and report.json stay outside the repository
# (the scripts refuse an output path inside it). Exit 0 only when every page
# passes checks 1–4, the computed-style check (5) and the semantics check
# (6) pass, and nothing was requested from another origin.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$(cd "${here}/../.." && pwd)"
baseline="${YS_BASELINE_DIR:-${HOME}/.mingla-private/2829/investigation/ys-shots-v2}"
origin="${YS_PARITY_ORIGIN:-http://youngandstamped.sites.localhost:3100}"
out="${YS_PARITY_OUT:-${HOME}/.mingla-private/2829/parity-runs/$(date -u +%Y%m%dT%H%M%SZ)}"

[[ -f "${baseline}/_meta.json" ]] || { echo "FAIL ys-parity: no baseline at ${baseline}" >&2; exit 2; }
mkdir -p "$out"
cd "$app"
node e2e/ys-parity/capture.mjs --origin "$origin" --baseline "$baseline" --out "$out" "$@"
node e2e/ys-parity/styles.mjs --origin "$origin" --baseline "$baseline" --out "$out"
node e2e/ys-parity/semantics.mjs --origin "$origin" --baseline "$baseline" --out "$out" || true
node e2e/ys-parity/compare.mjs --baseline "$baseline" --out "$out"
echo "report: ${out}/report.json"
node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pass ? 0 : 1)' "${out}/report.json"
