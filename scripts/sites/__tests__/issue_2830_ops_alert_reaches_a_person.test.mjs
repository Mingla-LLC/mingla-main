/**
 * Issue #2830 slice 2 — a Sites operations failure reaches a person (T-7.1),
 * and the housekeeping alert can no longer be silent (tester finding F-1).
 *
 * From 2026-10-07 to 2026-10-11 the pilot site was off the air. The workflow
 * said so fourteen times as bot comments on an issue. Nobody read one.
 *
 * What is pinned here:
 *   SC-7.1  one email and one comment per (kind, code, UTC day); a second call
 *           the same day sends neither;
 *   SC-7.2  a missing recipient, a missing key or a non-2xx from the provider
 *           posts SITES_OPS_PAGE_DELIVERY_FAILED and exits 1;
 *   privacy no recipient address, key or provider response body ever reaches
 *           stdout or a comment (the repository and its logs are public);
 *   wiring  the workflow has a paging job that runs the notifier, with the
 *           recipient threaded as a SECRET, in exclusion polarity;
 *   F-1     a retention job that succeeds without a readable outcome alerts.
 *
 * Nothing here touches the network: GitHub and the mail provider are one
 * injected `fetch`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PAGE_AUTHOR,
  SITES_OPS_PAGE_KINDS,
  buildSitesOpsPage,
  classifyRunForPage,
  notifySitesOps,
  pageMarker,
  parseRecipients,
  runNotifierCli,
} from "../notify-sites-ops.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const WORKFLOW = readFileSync(
  join(REPO, ".github/workflows/sites-backup-restore.yml"),
  "utf8",
);

// Reserved-domain fixtures only. No real address belongs in this repository.
const FIRST = "first.person@example.invalid";
const SECOND = "second.person@example.invalid";
const KEY = "re_test_0123456789abcdef";
const PROVIDER_BODY = `{"message":"rejected for ${FIRST}"}`;
const NOW = new Date("2026-10-12T09:30:00Z");

const ENV = Object.freeze({
  GITHUB_REPOSITORY: "owner/repo",
  GH_TOKEN: "ghs_testtoken_0123456789",
  GITHUB_RUN_ID: "42",
  GITHUB_SERVER_URL: "https://github.example",
  RESEND_API_KEY: KEY,
  MINGLA_SITES_OPS_ALERT_TO: `${FIRST}, ${SECOND}`,
});

/** One fake for both services, stateful so a second call sees the first. */
function world({ comments = [], resendStatus = 200, commentsReadable = true, postable = true } = {}) {
  const state = { comments: [...comments], emails: [], posts: [], reads: 0 };
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target === "https://api.resend.com/emails") {
      state.emails.push({ headers: init.headers, message: JSON.parse(init.body) });
      return {
        ok: resendStatus >= 200 && resendStatus < 300,
        status: resendStatus,
        text: async () => (resendStatus === 200 ? '{"id":"re_1"}' : PROVIDER_BODY),
      };
    }
    if (target.includes("/issues/2830/comments")) {
      if (init.method === "POST") {
        if (!postable) return { ok: false, status: 403, json: async () => ({}) };
        const body = JSON.parse(init.body).body;
        state.posts.push(body);
        state.comments.push({ body, user: { login: PAGE_AUTHOR } });
        return { ok: true, status: 201, json: async () => ({ id: state.comments.length }) };
      }
      state.reads += 1;
      if (!commentsReadable) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => state.comments };
    }
    throw new Error(`unexpected url ${target}`);
  };
  return { state, fetchImpl };
}

function sink() {
  const lines = [];
  return { lines, write: (value) => lines.push(value.trimEnd()), text: () => lines.join("\n") };
}

const PAGE = Object.freeze({
  kind: "RETENTION_FAILED",
  code: "RETENTION_SWEEP_FAILED",
  outcome: "PILOT_UNAFFECTED recovery_evidence_fresh",
});

function leaks(text) {
  return [FIRST, SECOND, KEY, "example.invalid", "rejected for"].filter((needle) =>
    text.includes(needle));
}

// ---------------------------------------------------------------------------
// SC-7.1 — once per (kind, code, UTC day)
// ---------------------------------------------------------------------------

test("#2830 T-7.1 the first call sends one email and writes one marker comment", async () => {
  const { state, fetchImpl } = world();
  const stdout = sink();
  const result = await notifySitesOps(PAGE, { env: ENV, fetchImpl, now: NOW, stdout });
  assert.deepEqual(
    { emailed: result.emailed, posted: result.posted, reason: result.reason, exitCode: result.exitCode },
    { emailed: true, posted: true, reason: "REPORTED", exitCode: 0 },
  );
  assert.equal(state.emails.length, 1, "exactly one email");
  assert.equal(state.posts.length, 1, "exactly one comment");
  const { message, headers } = state.emails[0];
  assert.deepEqual(message.to, [FIRST, SECOND], "both recipients, in one email");
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  assert.equal(message.subject, "[Mingla Sites] Site is up, clean-up failed (RETENTION_SWEEP_FAILED)");
  assert.match(message.text, /gogi\.sites\.usemingla\.com is unaffected/);
  assert.match(message.text, /Run: https:\/\/github\.example\/owner\/repo\/actions\/runs\/42/);
  assert.ok(state.posts[0].startsWith(
    "SITES_OPS_PAGE kind=RETENTION_FAILED code=RETENTION_SWEEP_FAILED day=2026-10-12\n",
  ));
  assert.match(state.posts[0], /^email=sent$/m);
  assert.ok(stdout.lines.includes(
    "SITES_OPS_PAGE_DELIVERY posted=true emailed=true reason=REPORTED kind=RETENTION_FAILED code=RETENTION_SWEEP_FAILED day=2026-10-12",
  ));
});

test("#2830 T-7.1 a second call the same day sends neither an email nor a comment", async () => {
  const { state, fetchImpl } = world();
  await notifySitesOps(PAGE, { env: ENV, fetchImpl, now: NOW, stdout: sink() });
  const stdout = sink();
  const later = new Date("2026-10-12T21:30:00Z");
  const again = await notifySitesOps(PAGE, { env: ENV, fetchImpl, now: later, stdout });
  assert.equal(again.reason, "ALREADY_REPORTED");
  assert.equal(again.exitCode, 0);
  assert.equal(state.emails.length, 1, "still one email");
  assert.equal(state.posts.length, 1, "still one comment");
  assert.match(stdout.text(), /^SITES_OPS_PAGE_DELIVERY posted=false emailed=false reason=ALREADY_REPORTED /m);
});

test("#2830 T-7.1 the next UTC day, another code and another kind each page again", async () => {
  const { state, fetchImpl } = world();
  const options = { env: ENV, fetchImpl, stdout: sink() };
  await notifySitesOps(PAGE, { ...options, now: NOW });
  await notifySitesOps(PAGE, { ...options, now: new Date("2026-10-13T00:00:01Z") });
  assert.equal(state.emails.length, 2, "a failure that lasts into the next day is announced again");
  await notifySitesOps({ ...PAGE, code: "RETENTION_ITEM_STUCK" }, { ...options, now: NOW });
  assert.equal(state.emails.length, 3, "a different code is a different page");
  await notifySitesOps({ kind: "PILOT_DEACTIVATED", code: "RETENTION_SWEEP_FAILED" }, { ...options, now: NOW });
  assert.equal(state.emails.length, 4, "a different kind is a different page");
});

test("#2830 T-7.1 a marker pasted by anyone but the workflow does not switch the page off", async () => {
  // The repository is public: anyone can comment on the issue.
  const marker = pageMarker({ kind: PAGE.kind, code: PAGE.code, day: "2026-10-12" });
  for (const user of [{ login: "someone-else" }, { login: "github-actions" }, undefined]) {
    const { state, fetchImpl } = world({ comments: [{ body: `${marker}\nemail=sent`, user }] });
    const result = await notifySitesOps(PAGE, { env: ENV, fetchImpl, now: NOW, stdout: sink() });
    assert.equal(result.reason, "REPORTED", `author ${user?.login}`);
    assert.equal(state.emails.length, 1);
  }
  // Quoting the marker in the middle of a comment is not the marker either.
  const quoted = world({ comments: [{ body: `see ${marker}`, user: { login: PAGE_AUTHOR } }] });
  await notifySitesOps(PAGE, { env: ENV, fetchImpl: quoted.fetchImpl, now: NOW, stdout: sink() });
  assert.equal(quoted.state.emails.length, 1);
});

test("#2830 T-7.1 an unreadable issue cannot be deduped against, so the page is still sent", async () => {
  // After #2830 a red operations run blocks nothing. An email is the only thing
  // that reaches a person, so "could not check" must not become "did not send".
  const { state, fetchImpl } = world({ commentsReadable: false });
  const result = await notifySitesOps(PAGE, { env: ENV, fetchImpl, now: NOW, stdout: sink() });
  assert.equal(state.emails.length, 1);
  assert.equal(result.emailed, true);
});

// ---------------------------------------------------------------------------
// SC-7.2 — a failed send is loud
// ---------------------------------------------------------------------------

test("#2830 T-7.1 a provider rejection posts the delivery-failed comment and exits 1", async () => {
  const { state, fetchImpl } = world({ resendStatus: 401 });
  const stdout = sink();
  const result = await notifySitesOps(PAGE, { env: ENV, fetchImpl, now: NOW, stdout });
  assert.equal(result.exitCode, 1);
  assert.equal(result.emailed, false);
  assert.equal(result.reason, "RESEND_HTTP_401");
  assert.equal(state.posts.length, 1);
  assert.ok(state.posts[0].startsWith(
    "SITES_OPS_PAGE_DELIVERY_FAILED kind=RETENTION_FAILED code=RETENTION_SWEEP_FAILED day=2026-10-12 reason=RESEND_HTTP_401\n",
  ));
  assert.match(stdout.text(), /^::error::SITES_OPS_PAGE_DELIVERY_FAILED reason=RESEND_HTTP_401 escalated=true /m);
  // No dedupe marker was written, so the next run today tries again.
  assert.equal(state.posts.some((body) => body.startsWith("SITES_OPS_PAGE kind=")), false);
  const retry = world({ comments: state.comments });
  const second = await notifySitesOps(PAGE, { env: ENV, fetchImpl: retry.fetchImpl, now: NOW, stdout: sink() });
  assert.equal(second.reason, "REPORTED", "a send that failed earlier today is retried");
  assert.equal(retry.state.emails.length, 1);
});

test("#2830 T-7.1 a missing recipient or a missing key is loud, not a quiet no-op", async () => {
  const cases = [
    ["RECIPIENT_MISSING", { ...ENV, MINGLA_SITES_OPS_ALERT_TO: "" }],
    ["RECIPIENT_MISSING", { ...ENV, MINGLA_SITES_OPS_ALERT_TO: "not an address" }],
    ["RESEND_KEY_MISSING", { ...ENV, RESEND_API_KEY: "" }],
  ];
  for (const [reason, env] of cases) {
    const { state, fetchImpl } = world();
    const result = await notifySitesOps(PAGE, { env, fetchImpl, now: NOW, stdout: sink() });
    assert.equal(result.reason, reason);
    assert.equal(result.exitCode, 1, reason);
    assert.equal(state.emails.length, 0, reason);
    assert.equal(state.posts.length, 1, reason);
    assert.match(state.posts[0], new RegExp(`^SITES_OPS_PAGE_DELIVERY_FAILED .* reason=${reason}$`, "m"));
  }
});

test("#2830 T-7.1 the delivery-failed comment is posted once a day, and every run still exits 1", async () => {
  const { state, fetchImpl } = world({ resendStatus: 500 });
  const options = { env: ENV, fetchImpl, now: NOW, stdout: sink() };
  const first = await notifySitesOps(PAGE, options);
  const second = await notifySitesOps(PAGE, options);
  assert.equal(first.exitCode, 1);
  assert.equal(second.exitCode, 1, "the hourly job stays red while nobody can be emailed");
  assert.equal(state.posts.length, 1, "one failure record a day, not one an hour");
  assert.equal(state.emails.length, 2, "and the send is attempted every time");
});

test("#2830 T-7.1 an email that went with no marker written is a red step, never a silent repeat", async () => {
  const { state, fetchImpl } = world({ postable: false });
  const stdout = sink();
  const result = await notifySitesOps(PAGE, { env: ENV, fetchImpl, now: NOW, stdout });
  assert.equal(state.emails.length, 1);
  assert.deepEqual(
    { emailed: result.emailed, posted: result.posted, exitCode: result.exitCode },
    { emailed: true, posted: false, exitCode: 1 },
  );
  assert.match(stdout.text(), /reason=MARKER_COMMENT_FAILED/);
});

test("#2830 T-7.1 the fallback recipient is used only when the Sites inbox is unset", async () => {
  const fallback = world();
  await notifySitesOps(PAGE, {
    env: { ...ENV, MINGLA_SITES_OPS_ALERT_TO: "", MINGLA_MAIN_RED_ALERT_TO: SECOND },
    fetchImpl: fallback.fetchImpl,
    now: NOW,
    stdout: sink(),
  });
  assert.deepEqual(fallback.state.emails[0].message.to, [SECOND]);
  const primary = world();
  await notifySitesOps(PAGE, {
    env: { ...ENV, MINGLA_SITES_OPS_ALERT_TO: FIRST, MINGLA_MAIN_RED_ALERT_TO: SECOND },
    fetchImpl: primary.fetchImpl,
    now: NOW,
    stdout: sink(),
  });
  assert.deepEqual(primary.state.emails[0].message.to, [FIRST]);
});

// ---------------------------------------------------------------------------
// Privacy — the repository, its issue and its Actions log are public
// ---------------------------------------------------------------------------

test("#2830 T-7.1 no address, key or provider answer reaches stdout or a comment", async () => {
  for (const options of [{}, { resendStatus: 401 }, { resendStatus: 422 }, { postable: false }, { commentsReadable: false }]) {
    const { state, fetchImpl } = world(options);
    const stdout = sink();
    await notifySitesOps(PAGE, { env: ENV, fetchImpl, now: NOW, stdout });
    const label = JSON.stringify(options);
    assert.deepEqual(leaks(stdout.text()), [], `stdout ${label}`);
    assert.deepEqual(leaks(state.posts.join("\n")), [], `comments ${label}`);
  }
});

test("#2830 T-7.1 a hostile code or outcome cannot shape the comment, the subject or the log", async () => {
  const { state, fetchImpl } = world();
  const stdout = sink();
  await notifySitesOps({
    kind: "RETENTION_FAILED",
    code: "X\n::add-mask::oops $(id) `id`",
    outcome: "ok\nSITES_OPS_PAGE kind=PILOT_DEACTIVATED",
  }, { env: ENV, fetchImpl, now: NOW, stdout });
  assert.equal(state.emails[0].message.subject, "[Mingla Sites] Site is up, clean-up failed (UNCLASSIFIED)");
  assert.ok(state.posts[0].startsWith("SITES_OPS_PAGE kind=RETENTION_FAILED code=UNCLASSIFIED day=2026-10-12\n"));
  assert.equal(/outcome=/.test(state.posts[0]), false, "an outcome that is not one safe line is dropped");
  assert.equal(/add-mask|\$\(id\)/.test(`${stdout.text()}\n${state.posts[0]}`), false);
  const unknown = await notifySitesOps({ kind: "MADE_UP", code: "X_Y_Z" }, { env: ENV, fetchImpl, now: NOW, stdout: sink() });
  assert.equal(unknown.exitCode, 1, "an unknown kind is refused, loudly");
  assert.equal(state.emails.length, 1);
});

test("#2830 T-7.1 recipients are parsed strictly and capped", () => {
  assert.deepEqual(parseRecipients(`${FIRST};${SECOND}  ${FIRST}`), [FIRST, SECOND]);
  assert.deepEqual(parseRecipients("a@b, <x@example.invalid>, \"q\"@example.invalid"), []);
  assert.deepEqual(parseRecipients(undefined), []);
  const many = Array.from({ length: 9 }, (_, index) => `p${index}@example.invalid`).join(",");
  assert.equal(parseRecipients(many).length, 5);
});

test("#2830 T-7.1 every kind has a subject that states what the public site is doing", () => {
  for (const kind of SITES_OPS_PAGE_KINDS) {
    const page = buildSitesOpsPage({ kind, code: "SOME_CODE", runUrl: "https://example.invalid/run", headroomHours: 6.24 });
    assert.ok(page.subject.startsWith("[Mingla Sites] "), kind);
    assert.match(page.text, /Run: https:\/\/example\.invalid\/run/, kind);
    assert.match(page.text, new RegExp(`^Kind: ${kind}$`, "m"));
  }
  assert.equal(
    buildSitesOpsPage({ kind: "PILOT_DEACTIVATED", code: "DATABASE_BACKUP_STALE" }).subject,
    "[Mingla Sites] gogi.sites.usemingla.com is OFFLINE — backup readiness failed (DATABASE_BACKUP_STALE)",
  );
  assert.equal(
    buildSitesOpsPage({ kind: "BACKUP_FAILED_PILOT_HELD", code: "S3_OBJECT_READ_FAILED", headroomHours: 19.44 }).subject,
    "[Mingla Sites] Site is up, backup did not complete (S3_OBJECT_READ_FAILED) — evidence expires in 19.4 h",
  );
  assert.equal(
    buildSitesOpsPage({ kind: "EVIDENCE_AGEING", code: "X_Y_Z", headroomHours: 6.2 }).subject,
    "[Mingla Sites] Backup evidence expires in 6.2 h",
  );
  assert.equal(
    buildSitesOpsPage({ kind: "PILOT_HOST_DOWN_EVIDENCE_FRESH", code: "X_Y_Z" }).subject,
    "[Mingla Sites] Site is DOWN although backup evidence is fresh",
  );
  assert.throws(() => buildSitesOpsPage({ kind: "MADE_UP", code: "X_Y_Z" }), /SITES_OPS_PAGE_KIND_INVALID/);
});

// ---------------------------------------------------------------------------
// Which page one backup run calls for
// ---------------------------------------------------------------------------

test("#2830 T-7.1 a run is paged for what happened, not for what a job intended", () => {
  const ok = { contracts: "success", backup: "success", deactivate: "skipped", retention: "success", retentionOutcome: "success" };
  assert.equal(classifyRunForPage(ok), null, "a clean run pages nobody");

  assert.deepEqual(
    classifyRunForPage({ ...ok, backup: "failure", deactivate: "success", retention: "skipped", retentionOutcome: "", failureCode: "DATABASE_BACKUP_STALE" }),
    { kind: "PILOT_DEACTIVATED", code: "DATABASE_BACKUP_STALE", outcome: "PILOT_DEACTIVATED" },
  );
  assert.equal(
    classifyRunForPage({ ...ok, backup: "failure", deactivate: "skipped", retention: "skipped", failureCode: "S3_OBJECT_READ_FAILED" }).kind,
    "BACKUP_FAILED_PILOT_HELD",
  );
  // "Offline" is only ever said when the deactivation itself succeeded.
  for (const deactivate of ["failure", "cancelled", "", "something-new"]) {
    assert.equal(
      classifyRunForPage({ ...ok, backup: "failure", deactivate, retention: "skipped" }).kind,
      "PILOT_DEACTIVATION_FAILED",
      `deactivate=${deactivate}`,
    );
  }
  // A red contract test is named as such, whichever way the gate went.
  assert.equal(
    classifyRunForPage({ ...ok, contracts: "failure", backup: "skipped", deactivate: "success", retention: "skipped" }).code,
    "SITES_CONTRACTS_FAILED",
  );
  assert.deepEqual(
    classifyRunForPage({ ...ok, contracts: "failure", backup: "skipped", deactivate: "skipped", retention: "skipped" }),
    { kind: "BACKUP_FAILED_PILOT_HELD", code: "SITES_CONTRACTS_FAILED", outcome: "PILOT_HELD_UP recovery_evidence_ageing" },
  );

  assert.deepEqual(
    classifyRunForPage({ ...ok, retentionOutcome: "failure", retentionCode: "RETENTION_SWEEP_FAILED" }),
    { kind: "RETENTION_FAILED", code: "RETENTION_SWEEP_FAILED", outcome: "PILOT_UNAFFECTED recovery_evidence_fresh" },
  );
  for (const state of [
    { retention: "failure", retentionOutcome: "" },
    { retention: "cancelled", retentionOutcome: "" },
    { retention: "success", retentionOutcome: "" },
    { retention: "success", retentionOutcome: "cancelled" },
  ]) {
    assert.equal(
      classifyRunForPage({ ...ok, ...state, retentionCode: "RETENTION_SWEEP_FAILED" }).code,
      "RETENTION_JOB_DID_NOT_REPORT",
      JSON.stringify(state),
    );
  }
});

test("#2830 T-7.1 the `run` command pages from the job results and stays quiet on a clean run", async () => {
  const clean = world();
  const stdout = sink();
  const quiet = await runNotifierCli(["run"], {
    env: {
      ...ENV,
      SITES_RUN_CONTRACTS_RESULT: "success",
      SITES_RUN_BACKUP_RESULT: "success",
      SITES_RUN_DEACTIVATE_RESULT: "skipped",
      SITES_RUN_RETENTION_RESULT: "success",
      SITES_RUN_RETENTION_OUTCOME: "success",
    },
    fetchImpl: clean.fetchImpl,
    now: NOW,
    stdout,
  });
  assert.equal(quiet, 0);
  assert.equal(clean.state.emails.length, 0);
  assert.match(stdout.text(), /reason=NOTHING_TO_REPORT/);

  const failed = world();
  const exit = await runNotifierCli(["run"], {
    env: {
      ...ENV,
      SITES_RUN_CONTRACTS_RESULT: "success",
      SITES_RUN_BACKUP_RESULT: "failure",
      SITES_RUN_DEACTIVATE_RESULT: "success",
      SITES_RUN_RETENTION_RESULT: "skipped",
      SITES_RUN_FAILURE_CODE: "DATABASE_BACKUP_MISSING",
    },
    fetchImpl: failed.fetchImpl,
    now: NOW,
    stdout: sink(),
  });
  assert.equal(exit, 0);
  assert.match(failed.state.emails[0].message.subject, /is OFFLINE — backup readiness failed \(DATABASE_BACKUP_MISSING\)/);
  // With no result threaded at all, the run is treated as failed, not as clean.
  const unset = world();
  await runNotifierCli(["run"], { env: ENV, fetchImpl: unset.fetchImpl, now: NOW, stdout: sink() });
  assert.equal(unset.state.emails.length, 1, "an unthreaded environment pages rather than passing quietly");
  assert.equal(await runNotifierCli(["nonsense"], { env: ENV, stdout: sink() }), 2);
});

// ---------------------------------------------------------------------------
// Wiring — the workflow actually runs the notifier
// ---------------------------------------------------------------------------

function jobBlock(name) {
  const at = WORKFLOW.indexOf(`\n  ${name}:\n`);
  assert.ok(at >= 0, `job ${name} exists`);
  const rest = WORKFLOW.slice(at + 1);
  const end = rest.search(/\n {2}[a-z_]+:\n/);
  return end === -1 ? rest : rest.slice(0, end);
}

function jobIf(name) {
  const folded = /\n {4}if: >-\n((?: {6}.*\n)+)/.exec(jobBlock(name));
  assert.ok(folded, `${name} has a folded if:`);
  return folded[1].split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
}

/**
 * GitHub's `if:` rules for the grammar this workflow uses. A missing value is
 * the empty string; `always()` is true. This is a model, read from the file.
 */
function evaluate(expression, context) {
  const tokens = expression.match(/&&|\|\||==|!=|\(|\)|'[^']*'|[A-Za-z_][A-Za-z0-9_.-]*/g);
  let at = 0;
  const lookup = (path) => {
    let value = context;
    for (const part of path.split(".")) value = value?.[part];
    return value ?? "";
  };
  const operand = () => {
    const token = tokens[at++];
    if (token === "(") {
      const value = or();
      assert.equal(tokens[at++], ")");
      return value;
    }
    if (token.startsWith("'")) return token.slice(1, -1);
    if (token === "always") {
      at += 2;
      return true;
    }
    return lookup(token);
  };
  const comparison = () => {
    const left = operand();
    if (tokens[at] === "==" || tokens[at] === "!=") {
      const operator = tokens[at++];
      const right = operand();
      return operator === "==" ? left === right : left !== right;
    }
    return Boolean(left);
  };
  const and = () => {
    let value = comparison();
    while (tokens[at] === "&&") {
      at += 1;
      const right = comparison();
      value = value && right;
    }
    return value;
  };
  function or() {
    let value = and();
    while (tokens[at] === "||") {
      at += 1;
      const right = and();
      value = value || right;
    }
    return value;
  }
  const value = or();
  assert.equal(at, tokens.length, `expression fully consumed: ${expression}`);
  return value;
}

const BACKUP_RUN = { event_name: "schedule", ref: "refs/heads/main", event: { schedule: "23 7 * * *" } };
const need = (result, outputs = {}) => ({ result, outputs });

test("#2830 F-1 a retention job that succeeds without a readable outcome is announced", () => {
  const condition = jobIf("housekeeping_alert");
  const on = (retention) => evaluate(condition, { github: BACKUP_RUN, needs: { retention } });
  // The row the first version let through in silence.
  assert.equal(on(need("success", {})), true, "succeeded, published nothing");
  for (const outcome of ["cancelled", "skipped", "", "anything-else"]) {
    assert.equal(on(need("success", { retention_outcome: outcome })), true, `outcome=${outcome}`);
  }
  // Everything it already announced, it still announces.
  assert.equal(on(need("success", { retention_outcome: "failure" })), true);
  assert.equal(on(need("failure")), true);
  assert.equal(on(need("cancelled")), true);
  // Only a positively reported clean sweep is quiet, and a sweep that never
  // started (the backup failed) is the backup alert's story.
  assert.equal(on(need("success", { retention_outcome: "success" })), false);
  assert.equal(on(need("skipped")), false);
  // Exclusion polarity, in the file's own words.
  assert.ok(condition.includes("needs.retention.result != 'skipped'"));
  assert.ok(condition.includes("needs.retention.outputs.retention_outcome != 'success'"));
});

test("#2830 T-7.1 the workflow has a paging job that runs the notifier", () => {
  const job = jobBlock("ops_page");
  assert.match(job, /^ {4}needs: \[contracts, backup_restore, deactivate, retention\]$/m);
  assert.match(job, /^ {8}run: node scripts\/sites\/notify-sites-ops\.mjs run$/m);
  assert.equal(/^ {4}environment:/m.test(job), false, "the paging job holds no production environment");
  assert.match(job, /^ {6}issues: write$/m);
  // The recipient is a secret, never a literal and never a plain variable.
  assert.match(job, /^ {10}MINGLA_SITES_OPS_ALERT_TO: \$\{\{ secrets\.MINGLA_SITES_OPS_ALERT_TO \}\}$/m);
  assert.match(job, /^ {10}MINGLA_MAIN_RED_ALERT_TO: \$\{\{ vars\.MINGLA_MAIN_RED_ALERT_TO \}\}$/m);
  assert.match(job, /^ {10}RESEND_API_KEY: \$\{\{ secrets\.RESEND_API_KEY \}\}$/m);
  const secrets = [...job.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]).sort();
  assert.deepEqual(secrets, ["MINGLA_SITES_OPS_ALERT_TO", "RESEND_API_KEY"], "and it holds no production secret");
  for (const [name, source] of [
    ["SITES_RUN_CONTRACTS_RESULT", "needs.contracts.result"],
    ["SITES_RUN_BACKUP_RESULT", "needs.backup_restore.result"],
    ["SITES_RUN_DEACTIVATE_RESULT", "needs.deactivate.result"],
    ["SITES_RUN_RETENTION_RESULT", "needs.retention.result"],
    ["SITES_RUN_RETENTION_OUTCOME", "needs.retention.outputs.retention_outcome"],
    ["SITES_RUN_RETENTION_CODE", "needs.retention.outputs.retention_code"],
    ["SITES_RUN_FAILURE_CODE", "needs.backup_restore.outputs.recovery_failure_code"],
  ]) assert.ok(job.includes(`${name}: \${{ ${source} }}`), `${name} is threaded from ${source}`);
  // No address anywhere in the workflow: only names.
  assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(WORKFLOW.replace(/@[0-9a-f]{40}/g, "")), false);
});

test("#2830 T-7.1 the paging job runs for every failure the run can have, and never for the watchdog", () => {
  const condition = jobIf("ops_page");
  const clean = {
    contracts: need("success"),
    backup_restore: need("success"),
    deactivate: need("skipped"),
    retention: need("success", { retention_outcome: "success" }),
  };
  const on = (needs, github = BACKUP_RUN) => evaluate(condition, { github, needs: { ...clean, ...needs } });
  assert.equal(on({}), false, "a clean run pages nobody");
  assert.equal(on({ deactivate: need("success") }), false, "a deactivation only ever follows a failure named below");
  const failures = {
    "contracts failed": { contracts: need("failure"), backup_restore: need("skipped"), retention: need("skipped") },
    "backup failed, held": { backup_restore: need("failure"), retention: need("skipped") },
    "backup failed, deactivated": { backup_restore: need("failure"), deactivate: need("success"), retention: need("skipped") },
    "backup cancelled": { backup_restore: need("cancelled"), retention: need("skipped") },
    "deactivation failed": { backup_restore: need("failure"), deactivate: need("failure"), retention: need("skipped") },
    "deactivation cancelled": { backup_restore: need("failure"), deactivate: need("cancelled"), retention: need("skipped") },
    "sweep failed": { retention: need("success", { retention_outcome: "failure" }) },
    "sweep job died": { retention: need("failure") },
    "sweep job cancelled": { retention: need("cancelled") },
    "sweep job silent": { retention: need("success", {}) },
  };
  for (const [label, needs] of Object.entries(failures)) {
    assert.equal(on(needs), true, label);
    for (const github of [
      { event_name: "schedule", ref: "refs/heads/main", event: { schedule: "37 * * * *" } },
      { event_name: "workflow_dispatch", ref: "refs/heads/main", event: { inputs: { mode: "freshness-check" } } },
      { event_name: "pull_request", ref: "refs/pull/1/merge", event: {} },
      { event_name: "workflow_dispatch", ref: "refs/heads/elsewhere", event: { inputs: { mode: "backup" } } },
    ]) assert.equal(on(needs, github), false, `${label} on ${github.event_name} ${github.ref}`);
  }
  // Agreement between the gate and the notifier: whenever the job runs, the
  // notifier has something to say, and whenever it stays quiet, it has not.
  const flat = (needs) => ({
    contracts: needs.contracts.result,
    backup: needs.backup_restore.result,
    deactivate: needs.deactivate.result,
    retention: needs.retention.result,
    retentionOutcome: needs.retention.outputs.retention_outcome ?? "",
  });
  for (const needs of Object.values(failures)) {
    assert.notEqual(classifyRunForPage(flat({ ...clean, ...needs })), null);
  }
  assert.equal(classifyRunForPage(flat(clean)), null);
});

test("#2830 T-7.1 the contract lane runs this suite", () => {
  assert.match(jobBlock("contracts"), /issue_2830_ops_alert_reaches_a_person\.test\.mjs/);
});
