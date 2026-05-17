#!/usr/bin/env node
/**
 * I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE strict-grep gate.
 *
 * Every tap-handler / navigation in `mingla-business/app/` +
 * `mingla-business/src/` that pushes a `/event/{id}` or `/trip/{id}` URL
 * MUST go through the canonical `routeForEventRow` helper at
 * `mingla-business/src/utils/routeForEventRow.ts`, OR carry an explicit
 * allowlist comment within 3 lines above explaining why a hardcoded
 * route is safe in that specific call site.
 *
 * Pattern banned: `router.push(\`/event/${...}\`)`,
 *                 `router.push(\`/trip/${...}\`)`,
 *                 `router.push("/event/" + ...)`,
 *                 `router.push("/trip/" + ...)`,
 *                 `router.push("/event/...")` literal strings,
 *                 `router.push("/trip/...")` literal strings.
 *
 * Pattern allowed:
 *   - Inside `src/utils/routeForEventRow.ts` itself (the helper IS the
 *     canonical owner of the route construction).
 *   - Inside route files under `app/event/[id]/*` or `app/trip/[id]/*`
 *     (internal navigation within an already-known-type screen — e.g.
 *     `/event/${id}/orders` from the event dashboard is fine because we
 *     already know it's an event).
 *   - With allowlist comment `// orch-strict-grep-allow route-by-event-type — <reason>`
 *     within 3 lines above the `router.push(...)` call.
 *   - Static no-id routes like `/event/create`, `/trip/create`,
 *     `/trip/coming-soon` (matched against the captured path; if the path
 *     after `/event/` or `/trip/` is purely static and doesn't contain
 *     `${`, allow).
 *
 * Why this exists: ORCH-0865 [trips-leak systemic + routeForEventRow
 *   helper] forensics found that tap-handlers in `home.tsx`, `hub/events`,
 *   `EventManageMenu`, `EventListCard` etc. constructed `/event/${id}` or
 *   `/trip/${id}` URLs inline without checking `event_type`. Even when
 *   upstream filters worked, any trip row that ever reached the handler
 *   landed on the wrong screen. Operator hit this at RETEST 5 smoke: trip
 *   in Home Upcoming list → tap routes to events tab.
 *
 * Established by: ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5. Invariant
 *   flips DRAFT → ACTIVE on REWORK 5 CLOSE.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "mingla-business", "app"),
  join(REPO_ROOT, "mingla-business", "src"),
];

const HELPER_FILE = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "utils",
  "routeForEventRow.ts",
);
const EVENT_ROUTE_PREFIX = join(REPO_ROOT, "mingla-business", "app", "event") + "/";
const TRIP_ROUTE_PREFIX = join(REPO_ROOT, "mingla-business", "app", "trip") + "/";

const ALLOWLIST_TAG = "orch-strict-grep-allow route-by-event-type";

// Match `router.push(...)` calls whose first arg contains a /event/ or /trip/ path.
const ROUTER_PUSH_DYNAMIC_RE =
  /router\.(?:push|replace)\(\s*[`'"](?:\/event\/|\/trip\/)/;
// For static no-id routes (no template literal), allow:
const STATIC_NO_ID_RE =
  /router\.(?:push|replace)\(\s*["'](?:\/event|\/trip)\/[a-z-]+["']\s*(?:as\s+never)?\s*\)/;

let violations = 0;
let filesScanned = 0;

function* walkTsTsx(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "__tests__" || entry === "node_modules" || entry.startsWith("."))
      continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkTsTsx(full);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.(tsx|ts)$/.test(entry)) {
      yield full;
    }
  }
}

function isCallerExempt(file) {
  if (file === HELPER_FILE) return true;
  if (file.startsWith(EVENT_ROUTE_PREFIX)) return true;
  if (file.startsWith(TRIP_ROUTE_PREFIX)) return true;
  return false;
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Skip comment-only lines
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    if (!ROUTER_PUSH_DYNAMIC_RE.test(line)) continue;
    // If the call is a static no-id route, allow.
    if (STATIC_NO_ID_RE.test(line)) continue;
    // Look up to 3 lines back for the allowlist comment.
    let allowlisted = false;
    for (let k = i - 1; k >= Math.max(0, i - 3); k -= 1) {
      if (lines[k].includes(ALLOWLIST_TAG)) {
        allowlisted = true;
        break;
      }
    }
    if (allowlisted) continue;
    violations += 1;
    const rel = relative(REPO_ROOT, file);
    console.error(
      `✗ ${rel}:${i + 1} — hardcoded /event/{id} or /trip/{id} router.push outside the canonical helper`,
    );
    console.error(`    > ${line.trim()}`);
    console.error(
      `    fix: replace with router.push(routeForEventRow(row) as never) — import from "src/utils/routeForEventRow"`,
    );
    console.error(
      `    OR add allowlist comment: // ${ALLOWLIST_TAG} — <reason>`,
    );
  }
}

for (const dir of SCAN_DIRS) {
  for (const file of walkTsTsx(dir)) {
    if (isCallerExempt(file)) continue;
    filesScanned += 1;
    checkFile(file);
  }
}

console.log(
  `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
