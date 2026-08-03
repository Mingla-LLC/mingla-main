#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// #1293 [sprint-rollover] — nightly runner: sweep unfinished board items onto the
// current sprint, stamp a rollover count, and flag chronic stragglers.
//
// This is the ONLY file that talks to GitHub. It reads the board (GraphQL), builds
// the pure inputs, delegates the decision to selectMoves(), and — in LIVE mode only —
// applies each move. It ships DARK: inert until a repo variable flips it on.
//
// Node >= 20, ESM, node built-ins + global fetch only. No npm deps.
//
// ENV
//   GH_PROJECT_TOKEN     board-write PAT (from secrets.SPRINT_ROLLOVER_TOKEN)
//   ROLLOVER_ENABLED     'true' arms live writes (from vars.SPRINT_ROLLOVER_ENABLED)
//   ROLLOVER_TZ          IANA operating timezone for "today" (from vars.SPRINT_ROLLOVER_TZ;
//                        default America/New_York). The board is run in US Eastern, so
//                        "today" MUST be the Eastern calendar date, not the UTC date (#1293).
//   DRY_RUN              'true' forces read-only
//   GITHUB_TOKEN         fallback READ token in dry-run when no PAT is present
//
//   Effective dry-run = DRY_RUN === 'true' || ROLLOVER_ENABLED !== 'true'
//   In dry-run: reads + compute + report, ZERO writes. A merge without the secret/var
//   is therefore a safe no-op.
// ─────────────────────────────────────────────────────────────────────────────

// --- Verified board constants (do not edit without re-verifying against the API) ---
const PROJECT_ID = "PVT_kwDOD8Prls4BdV8K";
const SPRINT_FIELD_ID = "PVTIF_lADOD8Prls4BdV8KzhX4N54"; // iteration field
const STATUS_FIELD_ID = "PVTSSF_lADOD8Prls4BdV8KzhX4JE8"; // single-select
const DONE_OPTION_ID = "98236657"; // Status = Done option (informational)
const ROLLOVERS_FIELD_ID = "PVTF_lADOD8Prls4BdV8KzhZBwFc"; // number field
const REPO_OWNER = "Mingla-LLC";
const REPO_NAME = "mingla-main";
const CHRONIC_LABEL = "chronic-carryover";
const CHRONIC_THRESHOLD = 3; // newRollovers >= this => flag the issue

const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_BASE = "https://api.github.com";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UA = "mingla-sprint-rollover/1293";

import { selectMoves } from "./selectMoves.mjs";
// #1293: "today" is resolved in the operating timezone (default America/New_York),
// NOT from UTC. The extracted helper is unit-tested in today.test.mjs.
import { DEFAULT_ROLLOVER_TZ, todayISO } from "./today.mjs";

// ── tiny helpers ─────────────────────────────────────────────────────────────

/** startDate + duration days -> "YYYY-MM-DD" (exclusive end). */
function computeEndISO(startDate, duration) {
  const [y, m, d] = String(startDate).slice(0, 10).split("-").map(Number);
  const end = Date.UTC(y, m - 1, d) + Number(duration) * MS_PER_DAY;
  return new Date(end).toISOString().slice(0, 10);
}

async function gql(query, variables, token) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const msg = json.errors ? JSON.stringify(json.errors) : `HTTP ${res.status}`;
    throw new Error(`GraphQL error: ${msg}`);
  }
  return json.data;
}

async function rest(method, path, token, body) {
  const res = await fetch(`${REST_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": UA,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

// ── read the board ───────────────────────────────────────────────────────────

const FIELDS_QUERY = `
query($project: ID!) {
  node(id: $project) {
    ... on ProjectV2 {
      title
      fields(first: 50) {
        nodes {
          ... on ProjectV2IterationField {
            id
            name
            configuration {
              iterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}`;

const ITEMS_QUERY = `
query($project: ID!, $cursor: String) {
  node(id: $project) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          type
          content {
            ... on Issue { number }
          }
          fieldValues(first: 30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2FieldCommon { id } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                iterationId
                startDate
                duration
                field { ... on ProjectV2FieldCommon { id } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2FieldCommon { id } }
              }
            }
          }
        }
      }
    }
  }
}`;

/** Fetch the active iteration list off the Sprint field. */
async function fetchIterations(token) {
  const data = await gql(FIELDS_QUERY, { project: PROJECT_ID }, token);
  const fields = data?.node?.fields?.nodes || [];
  const sprintField = fields.find((f) => f && f.id === SPRINT_FIELD_ID);
  if (!sprintField) {
    throw new Error(`Sprint field ${SPRINT_FIELD_ID} not found on project ${PROJECT_ID}`);
  }
  const iterations = (sprintField.configuration?.iterations || []).map((it) => ({
    id: it.id,
    title: it.title,
    startDate: it.startDate,
    duration: it.duration,
  }));
  return { projectTitle: data?.node?.title || "(project)", iterations };
}

/** Fetch all items, projected to the shape selectMoves() expects. */
async function fetchItems(token) {
  const items = [];
  let cursor = null;
  do {
    const data = await gql(ITEMS_QUERY, { project: PROJECT_ID, cursor }, token);
    const conn = data?.node?.items;
    const nodes = conn?.nodes || [];
    for (const node of nodes) {
      const fvs = node.fieldValues?.nodes || [];
      let statusName = null;
      let sprintIterationId = null;
      let sprintEndISO = null;
      let rollovers = 0;

      for (const fv of fvs) {
        const fid = fv?.field?.id;
        if (!fid) continue;
        if (fid === STATUS_FIELD_ID && fv.__typename === "ProjectV2ItemFieldSingleSelectValue") {
          statusName = fv.name ?? null;
        } else if (fid === SPRINT_FIELD_ID && fv.__typename === "ProjectV2ItemFieldIterationValue") {
          sprintIterationId = fv.iterationId ?? null;
          if (fv.startDate != null && fv.duration != null) {
            sprintEndISO = computeEndISO(fv.startDate, fv.duration);
          }
        } else if (fid === ROLLOVERS_FIELD_ID && fv.__typename === "ProjectV2ItemFieldNumberValue") {
          rollovers = Number(fv.number) || 0;
        }
      }

      items.push({
        itemId: node.id,
        contentType: normalizeType(node.type),
        issueNumber: node.content?.number ?? null,
        statusName,
        sprintIterationId,
        sprintEndISO,
        rollovers,
      });
    }
    cursor = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return items;
}

function normalizeType(t) {
  if (t === "ISSUE") return "Issue";
  if (t === "DRAFT_ISSUE") return "DraftIssue";
  if (t === "PULL_REQUEST") return "PullRequest";
  return t || "Unknown";
}

// ── apply a move (LIVE only) ─────────────────────────────────────────────────

const SET_ITERATION_MUT = `
mutation($project: ID!, $item: ID!, $field: ID!, $iterationId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: { iterationId: $iterationId }
  }) { projectV2Item { id } }
}`;

const SET_NUMBER_MUT = `
mutation($project: ID!, $item: ID!, $field: ID!, $number: Float!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: { number: $number }
  }) { projectV2Item { id } }
}`;

/** Ensure the chronic-carryover label exists, then add it to the issue. */
async function flagChronic(issueNumber, token) {
  // Create the label if it is missing (GET 404 => POST create).
  const existing = await rest("GET", `/repos/${REPO_OWNER}/${REPO_NAME}/labels/${CHRONIC_LABEL}`, token);
  if (existing.status === 404) {
    await rest("POST", `/repos/${REPO_OWNER}/${REPO_NAME}/labels`, token, {
      name: CHRONIC_LABEL,
      color: "b60205",
      description: "Rolled over 3+ sprints — chronic straggler (auto #1293)",
    });
  }
  // Add the label (idempotent — GitHub ignores an already-present label).
  await rest("POST", `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}/labels`, token, {
    labels: [CHRONIC_LABEL],
  });
}

async function applyMove(move, token) {
  // 1) Sprint -> current iteration
  await gql(SET_ITERATION_MUT, {
    project: PROJECT_ID,
    item: move.itemId,
    field: SPRINT_FIELD_ID,
    iterationId: move.toIterationId,
  }, token);
  // 2) Rollovers -> newRollovers
  await gql(SET_NUMBER_MUT, {
    project: PROJECT_ID,
    item: move.itemId,
    field: ROLLOVERS_FIELD_ID,
    number: move.newRollovers,
  }, token);
  // 3) Chronic flag (Issues only)
  let flagged = false;
  if (move.newRollovers >= CHRONIC_THRESHOLD && move.contentType === "Issue" && move.issueNumber) {
    await flagChronic(move.issueNumber, token);
    flagged = true;
  }
  return flagged;
}

// ── reporting ────────────────────────────────────────────────────────────────

function printSummary(moves, applied, effectiveDryRun) {
  const cols = ["itemId", "type", "issue", "from -> to", "rollovers", "chronic", "action"];
  const rows = moves.map((m, i) => {
    const chronic = m.newRollovers >= CHRONIC_THRESHOLD && m.contentType === "Issue";
    const action = effectiveDryRun ? "WOULD MOVE" : (applied[i]?.ok ? "MOVED" : "FAILED");
    return [
      String(m.itemId).slice(0, 22),
      m.contentType,
      m.issueNumber == null ? "—" : `#${m.issueNumber}`,
      `${String(m.fromIterationId).slice(-6)} -> ${String(m.toIterationId).slice(-6)}`,
      String(m.newRollovers),
      chronic ? (effectiveDryRun ? "would-flag" : (applied[i]?.flagged ? "flagged" : "—")) : "—",
      action,
    ];
  });
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length), 3));
  const fmt = (r) => r.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  console.log("");
  console.log(fmt(cols));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  if (rows.length === 0) console.log("(no items to roll over)");
  for (const r of rows) console.log(fmt(r));
  console.log("");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const DRY_RUN = process.env.DRY_RUN;
  const ROLLOVER_ENABLED = process.env.ROLLOVER_ENABLED;
  const projectToken = process.env.GH_PROJECT_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;

  const effectiveDryRun = DRY_RUN === "true" || ROLLOVER_ENABLED !== "true";

  console.log("── #1293 sprint-rollover ─────────────────────────────────────────");
  console.log(`DRY_RUN=${DRY_RUN ?? "(unset)"}  ROLLOVER_ENABLED=${ROLLOVER_ENABLED ?? "(unset)"}`);
  console.log(`effective mode: ${effectiveDryRun ? "DRY-RUN (zero writes)" : "LIVE (will apply moves)"}`);

  // Token resolution.
  let readToken = projectToken;
  if (!projectToken) {
    if (effectiveDryRun) {
      if (!githubToken) {
        throw new Error("Dry-run needs a read token: neither GH_PROJECT_TOKEN nor GITHUB_TOKEN is set.");
      }
      console.warn("WARNING: GH_PROJECT_TOKEN not set — dry-run reading with GITHUB_TOKEN (read-only).");
      readToken = githubToken;
    } else {
      // Live mode without the board PAT cannot write — fail loud rather than silently no-op.
      throw new Error("LIVE mode requires GH_PROJECT_TOKEN (secrets.SPRINT_ROLLOVER_TOKEN). Aborting.");
    }
  }

  // #1293: resolve "today" in the operating timezone (default America/New_York), so a
  // still-active Eastern sprint is never treated as ended at UTC-midnight.
  const rolloverTz = process.env.ROLLOVER_TZ || DEFAULT_ROLLOVER_TZ;
  const today = todayISO(rolloverTz);
  const { projectTitle, iterations } = await fetchIterations(readToken);
  const items = await fetchItems(readToken);

  console.log(`project: ${projectTitle}`);
  console.log(`operating timezone (ROLLOVER_TZ): ${rolloverTz}`);
  console.log(`today (${rolloverTz}): ${today}`);
  console.log(`active iterations: ${iterations.length}`);
  console.log(`board items scanned: ${items.length}`);

  const moves = selectMoves({ items, iterations, todayISO: today });

  if (moves.length === 0) {
    // Distinguish "no current sprint" (a warn-worthy condition) from "nothing due".
    const hasCurrent = iterations.some((it) => {
      const [sy, sm, sd] = String(it.startDate).slice(0, 10).split("-").map(Number);
      const start = Date.UTC(sy, sm - 1, sd);
      const end = start + Number(it.duration) * MS_PER_DAY;
      // #1293: derive the comparison day from the SAME tz-aware `today` string above —
      // bare-date UTC-epoch arithmetic on it is timezone-independent and stays consistent
      // with selectMoves(). Never re-derive "today" from a fresh UTC clock here.
      const [ty, tm, td] = today.split("-").map(Number);
      const t = Date.UTC(ty, tm - 1, td);
      return start <= t && t < end;
    });
    if (!hasCurrent) {
      console.warn("WARNING: no current sprint iteration contains today — nothing moved (never guess a target).");
    } else {
      console.log("Nothing to roll over: no non-Done items sit on an ended sprint.");
    }
  }

  const applied = new Array(moves.length).fill(null);
  if (!effectiveDryRun) {
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      try {
        const flagged = await applyMove(m, projectToken);
        applied[i] = { ok: true, flagged };
        console.log(
          `MOVED ${m.itemId} (${m.contentType}${m.issueNumber ? " #" + m.issueNumber : ""}) ` +
            `-> ${m.toIterationId}  rollovers=${m.newRollovers}${flagged ? "  [chronic-carryover]" : ""}`,
        );
      } catch (err) {
        applied[i] = { ok: false, flagged: false };
        console.error(`FAILED ${m.itemId}: ${err.message}`);
      }
    }
  } else {
    for (const m of moves) {
      console.log(
        `WOULD MOVE ${m.itemId} (${m.contentType}${m.issueNumber ? " #" + m.issueNumber : ""}) ` +
          `-> ${m.toIterationId}  rollovers=${m.newRollovers}` +
          `${m.newRollovers >= CHRONIC_THRESHOLD && m.contentType === "Issue" ? "  [would-flag chronic-carryover]" : ""}`,
      );
    }
  }

  printSummary(moves, applied, effectiveDryRun);

  const failures = applied.filter((a) => a && a.ok === false).length;
  console.log(
    `Summary: ${moves.length} selected, ` +
      `${effectiveDryRun ? 0 : moves.length - failures} applied, ` +
      `${failures} failed${effectiveDryRun ? " (dry-run — no writes)" : ""}.`,
  );

  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`sprint-rollover FATAL: ${err.message}`);
  process.exit(1);
});
