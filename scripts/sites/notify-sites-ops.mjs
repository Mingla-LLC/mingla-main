#!/usr/bin/env node
/**
 * Issue #2830 — a Sites operations failure has to reach a person.
 *
 * From 2026-10-07 to 2026-10-11 the live pilot site was off the air. The
 * workflow said so fourteen times, as bot comments on an issue, and nobody read
 * one of them. A comment is a record. It is not a page.
 *
 * This is the one place a Sites operations failure becomes an email. It sends
 * through the Resend client the red-`main` alert already uses (there is one in
 * this repository, imported below, not a second copy) and keeps the issue
 * comment as the record and as the dedupe key:
 *
 *   one email and one comment per (kind, code, UTC day).
 *
 * Three rules, each learned the hard way somewhere in this repository:
 *
 *   1. A send that fails is LOUD. A missing recipient, a missing key or a
 *      non-2xx from the provider posts `SITES_OPS_PAGE_DELIVERY_FAILED` on the
 *      issue and exits non-zero. "Nobody is watching" must never look like
 *      "nothing happened".
 *   2. The email goes out BEFORE the dedupe marker is written. Written the
 *      other way round, one failed send would silence every later run that day.
 *   3. Only a marker written by the workflow's own token counts as "already
 *      reported". The repository is public: anyone can comment on the issue,
 *      and a pasted marker must not be able to switch the page off.
 *
 * NEVER PRINTED, NEVER POSTED: a recipient address, the API key, or the
 * provider's response body (it can echo the recipient back). The Actions log of
 * a public repository is public, and a secret holding two addresses is masked
 * only as a whole string, not address by address. Only a status code leaves.
 *
 * NAMING CONSTRAINT: this file never names a workflow file. The provider seal
 * treats any file naming a workflow as a reference file for it.
 */

import { fileURLToPath } from "node:url";

import { sendAlert } from "../ci/main-health.mjs";

export const DEFAULT_PAGE_ISSUE = "2830";
export const PILOT_PUBLIC_HOST = "gogi.sites.usemingla.com";
export const PAGE_AUTHOR = "github-actions[bot]";
export const RUNBOOK_PATH = "docs/runbooks/MINGLA_SITES_PILOT.md";

/** Every kind this notifier will page for. Anything else is refused. */
export const SITES_OPS_PAGE_KINDS = Object.freeze([
  "PILOT_DEACTIVATED",
  "PILOT_DEACTIVATION_FAILED",
  "BACKUP_FAILED_PILOT_HELD",
  "RETENTION_FAILED",
  "EVIDENCE_AGEING",
  "EVIDENCE_EXPIRED",
  "EVIDENCE_UNPROVEN",
  "PILOT_HOST_DOWN_EVIDENCE_FRESH",
  "CMS_DEPLOY_SMOKE_FAILED",
  "CMS_DEPLOY_NOT_OBSERVED",
]);

const CODE_RE = /^[A-Z][A-Z0-9_]{2,95}$/;
const OUTCOME_RE = /^[A-Za-z0-9_][A-Za-z0-9_ =.:-]{0,159}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const EMAIL_RE = /^[^\s@<>,;"']{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,24}$/;
const MAX_RECIPIENTS = 5;
const MAX_COMMENT_PAGES = 3;

/** A code that is safe to print, post and put in a subject line. */
export function safeCode(value, fallback = "UNCLASSIFIED") {
  return typeof value === "string" && CODE_RE.test(value) ? value : fallback;
}

export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** The dedupe key, and the first line of the record comment. */
export function pageMarker({ kind, code, day }) {
  return `SITES_OPS_PAGE kind=${kind} code=${code} day=${day}`;
}

export function deliveryFailedMarker({ kind, code, day }) {
  return `SITES_OPS_PAGE_DELIVERY_FAILED kind=${kind} code=${code} day=${day}`;
}

/**
 * Recipients from one setting: one address, or several separated by commas,
 * semicolons or whitespace. Anything that is not plainly an address is dropped
 * rather than handed to the provider. The result is never logged.
 */
export function parseRecipients(raw) {
  if (typeof raw !== "string") return [];
  const seen = new Set();
  for (const part of raw.split(/[\s,;]+/)) {
    const address = part.trim();
    if (!address || !EMAIL_RE.test(address)) continue;
    seen.add(address.toLowerCase());
    if (seen.size === MAX_RECIPIENTS) break;
  }
  return [...seen];
}

function hours(value) {
  return Number.isFinite(value) ? (Math.round(value * 10) / 10).toFixed(1) : null;
}

/**
 * Subject and body. State first, in plain English: what the public site is
 * doing right now, then what happened, then the one thing to do.
 */
export function buildSitesOpsPage({
  kind,
  code,
  outcome = "",
  runUrl = "",
  headroomHours = null,
  host = PILOT_PUBLIC_HOST,
} = {}) {
  const left = hours(headroomHours);
  const runbook = `Runbook: ${RUNBOOK_PATH}`;
  const reactivate =
    `To bring it back, follow "Re-activating the pilot after a deactivation" in ${RUNBOOK_PATH}.`;
  const table = {
    PILOT_DEACTIVATED: {
      subject: `[Mingla Sites] ${host} is OFFLINE — backup readiness failed (${code})`,
      lines: [
        `The public site ${host} has been switched off and is returning 404 on every page.`,
        "A backup run could not prove that the site can be recovered, so it was deactivated on purpose.",
        `Nothing switches it back on automatically. ${reactivate}`,
      ],
    },
    PILOT_DEACTIVATION_FAILED: {
      subject: `[Mingla Sites] Deactivation FAILED after a backup failure — site state unknown (${code})`,
      lines: [
        `A backup run failed and the attempt to switch ${host} off also failed.`,
        "The site may still be serving on recovery evidence that is no longer proven. Check it now.",
        runbook,
      ],
    },
    BACKUP_FAILED_PILOT_HELD: {
      subject: `[Mingla Sites] Site is up, backup did not complete (${code})` +
        (left ? ` — evidence expires in ${left} h` : ""),
      lines: [
        `The public site ${host} is still up.`,
        "A backup run failed for a reason that does not prove the site is unrecoverable, so it was left on.",
        "The last good backup keeps it up for at most 26 hours from when it was taken. Run the backup again before then.",
        runbook,
      ],
    },
    RETENTION_FAILED: {
      subject: `[Mingla Sites] Site is up, clean-up failed (${code})`,
      lines: [
        `The public site ${host} is unaffected and the backup in this run was verified.`,
        "The clean-up sweep that removes expired uploads failed. Old files are not being removed until it is fixed.",
        runbook,
      ],
    },
    EVIDENCE_AGEING: {
      subject: `[Mingla Sites] Backup evidence expires in ${left ?? "a few"} h`,
      lines: [
        `The public site ${host} is still up, but the proof that it can be recovered is close to expiring.`,
        "When it expires every page returns 404. A successful backup run must land before then.",
        runbook,
      ],
    },
    EVIDENCE_EXPIRED: {
      subject: "[Mingla Sites] Backup evidence has EXPIRED — the site is returning 404",
      lines: [
        `The proof that ${host} can be recovered is older than 26 hours, so every page is returning 404.`,
        "A successful backup run brings it back by itself, unless the site was also deactivated.",
        runbook,
      ],
    },
    EVIDENCE_UNPROVEN: {
      subject: `[Mingla Sites] Backup freshness could not be proven (${code})`,
      lines: [
        `The hourly check could not prove that ${host} still has fresh recovery evidence.`,
        "That is not the same as the site being down. Open the run and read the verdict line.",
        runbook,
      ],
    },
    PILOT_HOST_DOWN_EVIDENCE_FRESH: {
      subject: "[Mingla Sites] Site is DOWN although backup evidence is fresh",
      lines: [
        `${host} is not answering 200, and the backup evidence is inside its budget.`,
        "That usually means the site was deactivated earlier and never switched back on.",
        reactivate,
        "This is sent once a day for as long as it stays true.",
      ],
    },
    CMS_DEPLOY_SMOKE_FAILED: {
      subject: `[Mingla Sites] Studio deploy check failed (${code})`,
      lines: [
        "The Studio deployment that just went live cannot read all of its data.",
        runbook,
      ],
    },
    CMS_DEPLOY_NOT_OBSERVED: {
      subject: `[Mingla Sites] Studio deploy was not observed (${code})`,
      lines: [
        "A Studio change was merged but the deployed build never became that commit.",
        runbook,
      ],
    },
  };
  const entry = table[kind];
  if (!entry) throw new Error("SITES_OPS_PAGE_KIND_INVALID");
  const text = [
    ...entry.lines,
    "",
    `Kind: ${kind}`,
    `Code: ${code}`,
    ...(outcome ? [`Outcome: ${outcome}`] : []),
    ...(runUrl ? [`Run: ${runUrl}`] : []),
  ].join("\n");
  return { subject: entry.subject, text };
}

/**
 * Which page, if any, one backup run calls for. Reads what actually HAPPENED
 * (the job results), not what a job intended: `PILOT_DEACTIVATED` is only ever
 * said when the deactivation job itself succeeded.
 */
export function classifyRunForPage({
  contracts = "",
  backup = "",
  deactivate = "",
  retention = "",
  retentionOutcome = "",
  retentionCode = "",
  failureCode = "",
} = {}) {
  const recoveryFailed = contracts !== "success" || backup !== "success" ||
    (deactivate !== "success" && deactivate !== "skipped");
  if (recoveryFailed) {
    const code = safeCode(
      failureCode,
      contracts !== "success" ? "SITES_CONTRACTS_FAILED" : "UNCLASSIFIED",
    );
    if (deactivate === "success") {
      return { kind: "PILOT_DEACTIVATED", code, outcome: "PILOT_DEACTIVATED" };
    }
    if (deactivate === "skipped") {
      return {
        kind: "BACKUP_FAILED_PILOT_HELD",
        code,
        outcome: "PILOT_HELD_UP recovery_evidence_ageing",
      };
    }
    // failure, cancelled, or a result this notifier does not recognise: the
    // site's state is unknown, and saying "offline" or "held" would be a guess.
    return {
      kind: "PILOT_DEACTIVATION_FAILED",
      code,
      outcome: "PILOT_STATE_UNKNOWN deactivation_did_not_complete",
    };
  }
  if (retention !== "skipped" && (retention !== "success" || retentionOutcome !== "success")) {
    return {
      kind: "RETENTION_FAILED",
      code: retentionOutcome === "failure"
        ? safeCode(retentionCode, "RETENTION_UNCLASSIFIED")
        // The retention job stopped before it could report. A fixed literal:
        // nothing that job may have half-written is trusted here.
        : "RETENTION_JOB_DID_NOT_REPORT",
      outcome: "PILOT_UNAFFECTED recovery_evidence_fresh",
    };
  }
  return null;
}

function apiHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "mingla-sites-ops-page",
    "x-github-api-version": "2022-11-28",
  };
}

/** Today's comments on the issue, or `null` when they could not be read. */
async function readTodaysComments({ fetchImpl, apiUrl, repository, issue, token, day }) {
  const comments = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    let batch;
    try {
      const response = await fetchImpl(
        `${apiUrl}/repos/${repository}/issues/${issue}/comments` +
          `?per_page=100&page=${page}&since=${encodeURIComponent(`${day}T00:00:00Z`)}`,
        { headers: apiHeaders(token) },
      );
      if (!response?.ok) return null;
      batch = await response.json();
    } catch {
      return null;
    }
    if (!Array.isArray(batch)) return null;
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments;
}

function writtenByTheWorkflow(comment, marker) {
  return typeof comment?.body === "string" &&
    comment.body.startsWith(marker) &&
    comment?.user?.login === PAGE_AUTHOR;
}

async function postComment({ fetchImpl, apiUrl, repository, issue, token, body }) {
  try {
    const response = await fetchImpl(
      `${apiUrl}/repos/${repository}/issues/${issue}/comments`,
      {
        method: "POST",
        headers: { ...apiHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

/** The provider's status, and nothing else from its answer. */
function sendFailureReason(error) {
  const status = /resend responded (\d{3})/.exec(String(error?.message ?? ""))?.[1];
  return status ? `RESEND_HTTP_${status}` : "RESEND_REQUEST_FAILED";
}

/**
 * Sends one page, at most once per (kind, code, UTC day).
 *
 * Returns `{ emailed, posted, reason, exitCode }` and writes one
 * `SITES_OPS_PAGE_DELIVERY …` line. Never throws for a delivery problem: a
 * caller that has just found the site down must not lose that verdict to an
 * exception from the thing reporting it.
 */
export async function notifySitesOps({
  kind,
  code,
  outcome = "",
  headroomHours = null,
} = {}, {
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  send = sendAlert,
  stdout = process.stdout,
} = {}) {
  const say = (line) => stdout.write(`${line}\n`);
  if (!SITES_OPS_PAGE_KINDS.includes(kind)) {
    say("SITES_OPS_PAGE_DELIVERY posted=false emailed=false reason=KIND_INVALID");
    return { emailed: false, posted: false, reason: "KIND_INVALID", exitCode: 1 };
  }
  const safe = safeCode(code);
  const safeOutcome = typeof outcome === "string" && OUTCOME_RE.test(outcome) ? outcome : "";
  const day = utcDay(now);
  const key = { kind, code: safe, day };
  const marker = pageMarker(key);
  const suffix = `kind=${kind} code=${safe} day=${day}`;

  const apiUrl = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const issue = env.SITES_OPS_PAGE_ISSUE || DEFAULT_PAGE_ISSUE;
  const canComment = typeof repository === "string" && REPOSITORY_RE.test(repository) &&
    typeof token === "string" && token.length >= 8 && /^[1-9]\d*$/.test(String(issue));
  const github = { fetchImpl, apiUrl, repository, issue, token };
  const runId = /^\d+$/.test(String(env.GITHUB_RUN_ID ?? "")) ? env.GITHUB_RUN_ID : "";
  const runUrl = canComment && runId
    ? `${env.GITHUB_SERVER_URL || "https://github.com"}/${repository}/actions/runs/${runId}`
    : "";

  // When the comments cannot be read there is no dedupe, and the page is sent
  // anyway: after #2830 a red operations run no longer blocks anything, so an
  // email is the only thing that reaches a person. A repeat is the safe error.
  const comments = canComment ? await readTodaysComments({ ...github, day }) : null;
  if (comments?.some((comment) => writtenByTheWorkflow(comment, marker))) {
    say(`SITES_OPS_PAGE_DELIVERY posted=false emailed=false reason=ALREADY_REPORTED ${suffix}`);
    return { emailed: false, posted: false, reason: "ALREADY_REPORTED", exitCode: 0 };
  }

  const failLoudly = async (reason) => {
    const failedMarker = deliveryFailedMarker(key);
    let escalated = false;
    if (comments?.some((comment) => writtenByTheWorkflow(comment, failedMarker))) {
      escalated = true;
    } else if (canComment) {
      escalated = await postComment({
        ...github,
        body: [
          `${failedMarker} reason=${reason}`,
          "",
          "A Mingla Sites operations page could NOT be emailed. Nobody has been told by email.",
          ...(runUrl ? [`Run: ${runUrl}`] : []),
        ].join("\n"),
      });
    }
    say(`::error::SITES_OPS_PAGE_DELIVERY_FAILED reason=${reason} escalated=${escalated} ${suffix}`);
    say(`SITES_OPS_PAGE_DELIVERY posted=false emailed=false reason=${reason} ${suffix}`);
    return { emailed: false, posted: false, reason, exitCode: 1, escalated };
  };

  const recipients = parseRecipients(
    env.MINGLA_SITES_OPS_ALERT_TO || env.MINGLA_MAIN_RED_ALERT_TO || "",
  );
  const apiKey = typeof env.RESEND_API_KEY === "string" ? env.RESEND_API_KEY : "";
  if (recipients.length === 0) return failLoudly("RECIPIENT_MISSING");
  if (!apiKey) return failLoudly("RESEND_KEY_MISSING");

  const page = buildSitesOpsPage({
    kind,
    code: safe,
    outcome: safeOutcome,
    runUrl,
    headroomHours,
  });
  try {
    await send({
      from: env.MINGLA_SITES_OPS_ALERT_FROM || env.MINGLA_MAIN_RED_ALERT_FROM ||
        "Mingla CI <notifications@usemingla.com>",
      to: recipients,
      subject: page.subject,
      text: page.text,
    }, { apiKey, fetchImpl });
  } catch (error) {
    return failLoudly(sendFailureReason(error));
  }

  const posted = canComment && await postComment({
    ...github,
    body: [
      marker,
      "",
      page.subject,
      ...(safeOutcome ? [`outcome=${safeOutcome}`] : []),
      ...(runUrl ? [`run_url=${runUrl}`] : []),
      "email=sent",
    ].join("\n"),
  });
  if (!posted) {
    // The email went. Without the marker the next run today sends it again,
    // which is a repeat, not a silence; still a fault worth a red step.
    say(`::error::SITES_OPS_PAGE_MARKER_NOT_WRITTEN ${suffix}`);
    say(`SITES_OPS_PAGE_DELIVERY posted=false emailed=true reason=MARKER_COMMENT_FAILED ${suffix}`);
    return { emailed: true, posted: false, reason: "MARKER_COMMENT_FAILED", exitCode: 1 };
  }
  say(`SITES_OPS_PAGE_DELIVERY posted=true emailed=true reason=REPORTED ${suffix}`);
  return { emailed: true, posted: true, reason: "REPORTED", exitCode: 0 };
}

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 && typeof argv[at + 1] === "string" ? argv[at + 1] : "";
}

/**
 * `run`  — decide from one backup run's job results (the workflow's paging job).
 * `page` — send one named page: `page --kind K --code C [--outcome "…"]`.
 */
export async function runNotifierCli(argv, options = {}) {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const command = argv[0];
  if (command === "run") {
    const page = classifyRunForPage({
      contracts: env.SITES_RUN_CONTRACTS_RESULT,
      backup: env.SITES_RUN_BACKUP_RESULT,
      deactivate: env.SITES_RUN_DEACTIVATE_RESULT,
      retention: env.SITES_RUN_RETENTION_RESULT,
      retentionOutcome: env.SITES_RUN_RETENTION_OUTCOME,
      retentionCode: env.SITES_RUN_RETENTION_CODE,
      failureCode: env.SITES_RUN_FAILURE_CODE,
    });
    if (!page) {
      stdout.write("SITES_OPS_PAGE_DELIVERY posted=false emailed=false reason=NOTHING_TO_REPORT\n");
      return 0;
    }
    return (await notifySitesOps(page, options)).exitCode;
  }
  if (command === "page") {
    return (await notifySitesOps({
      kind: flag(argv, "--kind"),
      code: flag(argv, "--code"),
      outcome: flag(argv, "--outcome"),
    }, options)).exitCode;
  }
  stdout.write("usage: notify-sites-ops.mjs <run|page --kind K --code C [--outcome O]>\n");
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNotifierCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    // Nothing from the error is printed: it may carry a provider response.
    process.stderr.write("SITES_OPS_PAGE_DELIVERY posted=false emailed=false reason=NOTIFIER_CRASHED\n");
    process.exitCode = 1;
  });
}
