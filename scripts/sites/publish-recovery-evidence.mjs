#!/usr/bin/env node
/**
 * Issue #2830 — publishes the recovery evidence Core accepted, where the
 * freshness watchdog can read it.
 *
 * The watchdog used to judge a backup by the colour of a job. From 2026-10-07 a
 * clean-up step failed at the end of that job on every run, so the job was red
 * and the watchdog said no backup had succeeded, for four days, while Core held
 * fresh verified evidence from every one of those runs.
 *
 * This writes the receipt down: ONE comment on the issue, edited in place (no
 * notification, no growth), whose body is the five instants Core accepted plus
 * the run that produced them. Timestamps, a run id and a commit SHA. Nothing
 * else: no site id, no digest, no key, no bucket path.
 *
 * It holds no production credential and no environment. Its inputs are job
 * outputs of the backup job, and every one is validated here again before it
 * is written, because a ledger is only worth reading if it cannot be made to
 * say something the backup did not.
 *
 * Why a comment and not an artifact: an existing contract forbids artifact and
 * cache actions in the Sites backup workflow. Why not a Core read: Core has no
 * read route for readiness, and adding one means changing a governed edge
 * function. Why not the database: that is a new credential on an hourly job.
 */

import { fileURLToPath } from "node:url";

import {
  DEFAULT_ALERT_ISSUE,
  LEDGER_AUTHOR,
  LEDGER_MARKER,
  LEDGER_TIMESTAMP_FIELDS,
  LEDGER_WINDOW_HOURS,
  formatLedger,
  parseLedger,
} from "./check-recovery-freshness.mjs";
import { fail, safeCliFailure } from "./lib/sites-ops.mjs";

const HOUR_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The ledger fields, from the publishing job's environment. Strict. */
export function ledgerFieldsFromEnv(env, { now = new Date() } = {}) {
  const fields = {};
  for (const name of LEDGER_TIMESTAMP_FIELDS) {
    const raw = env[name.toUpperCase()];
    const instant = typeof raw === "string" && raw.length > 0 ? Date.parse(raw) : Number.NaN;
    if (!Number.isFinite(instant)) fail("EVIDENCE_LEDGER_INPUT_INVALID");
    if (instant > now.getTime() + CLOCK_SKEW_MS) fail("EVIDENCE_LEDGER_INPUT_IN_THE_FUTURE");
    fields[name] = new Date(instant).toISOString();
  }
  const runId = String(env.GITHUB_RUN_ID ?? "");
  const headSha = String(env.GITHUB_SHA ?? "");
  if (!/^[1-9]\d{0,19}$/.test(runId) || !/^[0-9a-f]{40}$/.test(headSha)) {
    fail("EVIDENCE_LEDGER_RUN_IDENTITY_INVALID");
  }
  return { ...fields, run_id: runId, head_sha: headSha };
}

function apiHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "mingla-sites-recovery-evidence",
    "x-github-api-version": "2022-11-28",
  };
}

async function request(fetchImpl, url, init, code) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    fail(code);
  }
  if (!response?.ok) fail(code);
  try {
    return await response.json();
  } catch {
    fail(code);
  }
  return undefined;
}

/** Creates the ledger comment, or edits the workflow's own newest one in place. */
export async function publishRecoveryEvidence({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  stdout = process.stdout,
} = {}) {
  const apiUrl = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const issue = env.SITES_RECOVERY_ALERT_ISSUE || DEFAULT_ALERT_ISSUE;
  if (typeof repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    fail("GITHUB_REPOSITORY_INVALID");
  }
  if (typeof token !== "string" || token.length < 8) fail("GITHUB_TOKEN_MISSING");
  if (!/^[1-9]\d*$/.test(String(issue))) fail("ALERT_ISSUE_INVALID");

  const fields = ledgerFieldsFromEnv(env, { now });
  const body = formatLedger(fields);
  // What is about to be published must read back as exactly what was meant.
  const check = parseLedger(body);
  if (check.unproven || LEDGER_TIMESTAMP_FIELDS.some((name) => check.fields[name] !== fields[name])) {
    fail("EVIDENCE_LEDGER_SELF_CHECK_FAILED");
  }

  const since = new Date(now.getTime() - LEDGER_WINDOW_HOURS * HOUR_MS).toISOString();
  const comments = await request(
    fetchImpl,
    `${apiUrl}/repos/${repository}/issues/${issue}/comments` +
      `?per_page=100&since=${encodeURIComponent(since)}`,
    { headers: apiHeaders(token) },
    "EVIDENCE_LEDGER_READ_FAILED",
  );
  if (!Array.isArray(comments)) fail("EVIDENCE_LEDGER_READ_FAILED");
  // The workflow's own newest ledger comment is edited in place. One that can
  // no longer be parsed is still that comment, and replacing its body is the
  // repair it needs, so only authorship and the marker are asked of it here. A
  // comment from anyone else that carries the marker is never touched.
  let commentId = null;
  let newest = -Infinity;
  for (const comment of comments) {
    if (
      typeof comment?.body !== "string" || !comment.body.startsWith(LEDGER_MARKER) ||
      comment?.user?.login !== LEDGER_AUTHOR ||
      !Number.isSafeInteger(comment.id) || comment.id <= 0
    ) continue;
    const updated = Date.parse(comment.updated_at);
    const rank = Number.isFinite(updated) ? updated : 0;
    if (rank > newest) {
      newest = rank;
      commentId = comment.id;
    }
  }
  const edit = commentId !== null;
  await request(
    fetchImpl,
    edit
      ? `${apiUrl}/repos/${repository}/issues/comments/${commentId}`
      : `${apiUrl}/repos/${repository}/issues/${issue}/comments`,
    {
      method: edit ? "PATCH" : "POST",
      headers: apiHeaders(token),
      body: JSON.stringify({ body }),
    },
    "EVIDENCE_LEDGER_WRITE_FAILED",
  );
  const evidenceAt = [fields.evidence_object_manifest_at, fields.evidence_entitlement_at].sort()[0];
  stdout.write(
    `SITES_RECOVERY_EVIDENCE_LEDGER_OK action=${edit ? "updated" : "created"} evidence_at=${evidenceAt}\n`,
  );
  return { action: edit ? "updated" : "created", fields, body };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publishRecoveryEvidence().catch(safeCliFailure);
}
